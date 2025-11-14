import got from 'got';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';
import Datastore from 'nedb-promises';
import { format as FormatDate } from 'date-fns';

// 定数のインポート
import {
  PROG_DATE_AREA_URL,
  PROG_NOW_AREA_URL,
  PROG_TODAY_AREA_URL,
  PROG_DAILY_STATION_URL,
  PROG_WEEKLY_STATION_URL
} from '@/constants/radiko-urls.constants';

// Modelのインポート
import type { RadikoProgramData } from '@/models/radiko-program.model';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';
import { DBUtil } from '@/utils/db.util';
import { RadikoXmlUtil } from '@/utils/radiko-xml.util';
import { DateOnly, DateTime } from '@/types/date-time.types';

/**
 * 空の番組データ（初期値・エラー時のフォールバック用）
 */
export const EMPTY_PROGRAM: Readonly<RadikoProgramData> = Object.freeze({
  stationId: '',
  progId: '',
  ft: broadcastTimeConverter.parseStringToDateTime('19700101000000'),
  to: broadcastTimeConverter.parseStringToDateTime('19700101000000'),
  /** 再生時間(秒) */
  dur: 0,
  title: '',
  info: '',
  pfm: '',
  img: ''
});

/**
 * 空の番組データのコピーを作成
 * （定数を直接変更しないため）
 */
export function createEmptyProgram(): RadikoProgramData {
  return { ...EMPTY_PROGRAM };
}

export default class RdkProg {
  // LoggerEx はプロジェクト全体のグローバルから取得
  private readonly logger: LoggerEx = (globalThis as any).JP_RADIO_LOGGER;

  private readonly db = Datastore.create({ inMemoryOnly: true });
  private readonly dbUtil: DBUtil<RadikoProgramData>;
  private readonly xmlUtil: RadikoXmlUtil;

  // 局IDのキャッシュ用変数
  private lastStationId: string = '';
  // staticなDateTime初期値は1970年1月1日00:00:00
  private lastTime: DateTime = broadcastTimeConverter.parseStringToDateTime('19700101000000');
  // RadikoProgramData型のキャッシュ用変数
  private cachedProgram: RadikoProgramData = {} as RadikoProgramData;

  constructor() {
    this.dbUtil = new DBUtil<RadikoProgramData>();
    this.xmlUtil = new RadikoXmlUtil();

    this.initDBIndexes();
  }

  /**
   * DBから現在放送中の番組データ取得
   */
  public async getDbCurProgramData(stationId: string): Promise<RadikoProgramData> {
    // 現在時刻取得
    const searchDateTime: DateTime = broadcastTimeConverter.getCurrentDateTime();

    /**
     * DB検索
     * 放送開始 <= 指定日の05:00:00 かつ 放送終了 > 指定日の翌日の05:00:00
     */
    let radikoProgramData: RadikoProgramData | null = await this.dbUtil.findOne({
      stationId,
      // 放送開始日時以下(現在日時 <= 放送開始)
      ft: { $lte: searchDateTime },
    });

    return radikoProgramData;
  }

  /**
   * DBから指定局の1日分の番組データ取得
   */
  public async getDbRadikoProgramData(stationId: string, dateOnly: DateOnly): Promise<RadikoProgramData[]> {
    // 日本時間の05:00:00に設定するため、UTCでは前日の20:00:00となる（JST = UTC+9）
    const startDateTime: DateTime = broadcastTimeConverter.parseDateOnlyToDateTime(dateOnly);
    startDateTime.setUTCHours(20, 0, 0, 0);

    // 日本時間の翌日の05:00:00に設定するため、UTCでは当日の20:00:00となる（JST = UTC+9）
    const endDateTime: DateTime = broadcastTimeConverter.parseDateOnlyToDateTime(dateOnly);
    endDateTime.setUTCHours(20, 0, 0, 0);
    // 翌日の05:00:00(JST)にするため1日加算
    endDateTime.setUTCDate(endDateTime.getUTCDate() + 1);

    /**
     * DB検索
     *
     * 引数の検索日の朝5時から翌朝5時までの番組を取得する
     * ※DBのDateTimeはUTCなので考慮する必要あり
     */
    let radikoProgramDataArray: RadikoProgramData[] = await this.dbUtil.find({
      stationId,
      // 放送開始が終了時刻より前
      ft: { $lt: endDateTime },
      // 放送終了が開始時刻より後
      to: { $gt: startDateTime },
    });

    // 開始時刻 → 終了時刻でソート（localeCompareより明示的）
    radikoProgramDataArray.sort((a, b) => {
      if (a.ft === b.ft) {
        if (a.to === b.to) return 0;
        return a.to < b.to ? -1 : 1;
      }
      return a.ft < b.ft ? -1 : 1;
    });

    return radikoProgramDataArray;
  }

  /** 現在の番組取得 */
  public async getCurProgramData(stationId: string, retry: boolean): Promise<RadikoProgramData> {
    // 現在時刻取得
    const radikoTime: DateTime = broadcastTimeConverter.getCurrentRadioTime();
    // 指定局・現在時刻の番組取得
    return await this.getProgramData(stationId, radikoTime, retry);
  }

  /**
   * 指定局・時間の番組取得
   * @param stationId
   * @param dateTime
   * @param retry
   * @returns
   */
  public async getProgramData(stationId: string, dateTime: DateTime, retry: boolean): Promise<RadikoProgramData> {
    // DB検索＋キャッシュから番組データ取得
    let radikoProgramData: RadikoProgramData = await this.findProgramData(stationId, dateTime);

    // 番組データが空の場合、1日分の番組データを取得して再検索（retry=trueの場合のみ）
    if (Object.keys(radikoProgramData).length === 0 && retry === true) {
      // DateTime型 を DateOnly型 に変換
      const dateOnly: DateOnly = broadcastTimeConverter.parseDateTimeToDateOnly(dateTime);
      // 指定された放送局IDの1日分の番組データを取得
      const stations: Set<string> = await this.getDailyStationPrograms(stationId, dateOnly);

      if (stations.has(stationId) === true) {
        // 再度DB検索＋キャッシュから番組データ取得
        return await this.findProgramData(stationId, dateTime);
      }
    }

    return radikoProgramData
  }

  /** DB検索＋キャッシュ */
  private async findProgramData(stationId: string, searchDateTime: DateTime): Promise<RadikoProgramData> {
    // キャッシュしている局・時間と異なる場合はDB検索
    if (stationId !== this.lastStationId || searchDateTime !== this.lastTime) {
      try {
        /**
         * DB検索
         * 指定日時 >= 放送開始
         * 指定日時 < 放送終了
         */
        const result: RadikoProgramData = await this.dbUtil.findOne({
          stationId,
          ft: { $lte: searchDateTime },
          to: { $gt: searchDateTime },
        });

        // 結果が存在する場合はキャッシュ更新
        if (result !== undefined && result !== null && Object.keys(result).length > 0) {
          // キャッシュ更新
          this.cachedProgram = result;
          // 局IDの更新
          this.lastStationId = stationId;
          // 時間の更新
          this.lastTime = searchDateTime;
        } else {
          // 番組データが見つからない場合はエラーログに局ID・日時(yyyyMMddHHmmss形式)を出力
          this.logger.error('JRADI02SE0001', stationId, broadcastTimeConverter.parseDateTimeToStringDateTime(searchDateTime));
          throw new Error('Program data not found');
        }

      } catch (error: any) {
        // DB検索エラー時はエラーログに局IDを出力
        this.logger.error('JRADI02SE0002', stationId);
        throw error;
      }
    }

    // キャッシュしているRadikoProgramDataModelが空でない場合はキャッシュを返す
    if (Object.keys(this.cachedProgram).length > 0) {
      return this.cachedProgram;
    }

    // それ以外は空の番組データを返す
    return {} as RadikoProgramData;
  }

  /** DB登録（unique違反は無視） */
  private async putProgram(prog: RadikoProgramData): Promise<void> {
    try {
      await this.dbUtil.insert(prog);
    } catch (error: any) {
      if (error?.errorType !== 'uniqueViolated') {
        this.logger.error('JRADI02SE0003', error);
      }
    }
  }

  /** 古い番組削除 */
  public async clearOldProgram(): Promise<void> {
    try {
      // 現在時刻より前の番組データを削除
      const result: number = await this.dbUtil.remove({ to: { $lt: broadcastTimeConverter.getCurrentRadioTime() } }, { multi: true });
      // 削除件数ログ出力
      this.logger.info('JRADI02SI0001', result);
    } catch (error: any) {
      this.logger.error('JRADI02SE0004', error);
    }
    // 現在持っているDB件数のログ出力
    await this.dbCount();
  }

  /** 全エリア更新（boot / cron） */
  public async updatePrograms(areaIdArray: string[], whenBoot: boolean): Promise<number> {
    this.logger.info('JRADI02SI0002', (whenBoot ? 'boot' : 'cron'));

    // 並列処理数
    const limit = pLimit(5);
    const doneStations = new Set<string>();

    await Promise.all(
      areaIdArray.map(areaId =>
        limit(async () => {
          const url = whenBoot ? utilFormat(PROG_TODAY_AREA_URL, areaId) :
            utilFormat(PROG_DATE_AREA_URL, broadcastTimeConverter.getCurrentDate(), areaId);

          const stations = await this.getPrograms(url, doneStations);
          stations.forEach(s =>
            doneStations.add(s)
          );
        })
      )
    );

    return doneStations.size;
  }

  /** 日付×エリア取得 */
  public async getDateAreaPrograms(areaId: string, time: string): Promise<Set<string>> {
    const date: string = time.slice(0, 8);
    return await this.getPrograms(utilFormat(PROG_DATE_AREA_URL, date, areaId));
  }

  /** 現在×エリア取得 */
  public async getNowAreaPrograms(areaId: string): Promise<Set<string>> {
    return await this.getPrograms(utilFormat(PROG_NOW_AREA_URL, areaId));
  }

  /** 今日×エリア取得 */
  public async getTodayAreaPrograms(areaId: string): Promise<Set<string>> {
    return await this.getPrograms(utilFormat(PROG_TODAY_AREA_URL, areaId));
  }

  /** 指定された放送局IDに基づくの1日分の番組表を取得してDBに登録する */
  public async getDailyStationPrograms(stationId: string, dateOnly: DateOnly): Promise<Set<string>> {
    // 'yyyyMMdd'形式に変換
    const dateStr: string = broadcastTimeConverter.parseDateOnlyToStringDate(dateOnly);
    // Url生成
    const url: string = utilFormat(PROG_DAILY_STATION_URL, dateStr, stationId);
    return await this.getPrograms(url);
  }

  /** 局ごと1週間分 */
  public async getWeeklyStationPrograms(stationId: string): Promise<Set<string>> {
    return await this.getPrograms(utilFormat(PROG_WEEKLY_STATION_URL, stationId));
  }

  /** URLからXML取得 → XML解析 → DB登録 */
  private async getPrograms(url: string, skipStations: Set<string> = new Set()): Promise<Set<string>> {
    this.logger.info('JRADI02SI0003', url);
    const doneStations = new Set<string>();

    try {
      const response = await got(url);

      // XML解析してRadikoProgramDataの配列に変換(ソートなどはしていない)
      const radikoProgramDataArray: RadikoProgramData[] = await this.xmlUtil.parsePrograms(response.body, skipStations);

      for (const radikoProgramData of radikoProgramDataArray) {
        doneStations.add(radikoProgramData.stationId);
        // DBに登録
        await this.putProgram(radikoProgramData);
      }

    } catch (error: any) {
      this.logger.error('JRADI02SE0005', url, error);
      throw error;
    }

    await this.dbCount();
    return doneStations;
  }

  /** DBクリア */
  public async dbClose(): Promise<void> {
    await this.db.remove({}, { multi: true })
      .then(n => this.logger.info('JRADI02SI0004', n));
  }

  /** 全件取得（デバッグ用） */
  public async allData(): Promise<RadikoProgramData[]> {
    return await this.db.find({});
  }

  /** 件数ログ出力 */
  public async dbCount(): Promise<number> {
    const count: number = await this.dbUtil.count({});

    this.logger.info('JRADI02SI0005', count);

    return count;
  }

  /** DBインデックス作成 */
  private initDBIndexes(): void {
    // progIdはユニーク
    this.dbUtil.ensureIndex({ fieldName: 'progId', unique: true });
  }
}
