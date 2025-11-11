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
import { DateTime } from '@/types/date-time.types';

/**
 * 空の番組データ（初期値・エラー時のフォールバック用）
 */
export const EMPTY_PROGRAM: Readonly<RadikoProgramData> = Object.freeze({
  stationId: '',
  progId: '',
  ft: broadcastTimeConverter.parseStringToDateTime('19700101000000'),
  to: broadcastTimeConverter.parseStringToDateTime('19700101000000'),
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

  private lastStationId: string = '';
  private lastTime: string = '';
  private cachedProgram: RadikoProgramData = { ...EMPTY_PROGRAM };

  constructor() {
    this.dbUtil = new DBUtil<RadikoProgramData>();
    this.xmlUtil = new RadikoXmlUtil();

    this.initDBIndexes();
  }

  /** DBから指定局の1日分の番組データ取得 */
  public async getDbRadikoProgramData(stationId: string, date: Date): Promise<RadikoProgramData[]> {
    const startDate: Date = date;
    startDate.setHours(5, 0, 0, 0);

    const endDate: Date = new Date(startDate);
    // 翌日の05:00:01
    endDate.setDate(endDate.getDate() + 1);
    endDate.setSeconds(endDate.getSeconds() + 1); // 05:00:01

    // Radikoの日付区切りは05:00なので、05:00以前は前日扱い
    const startDateTime: string = FormatDate(startDate, 'yyyyMMddhhmmss');
    const endDateTime: string = FormatDate(endDate, 'yyyyMMddhhmmss');

    // all programs that intersect the day [start, end)
    let radikoProgramDataArray: RadikoProgramData[] = await this.dbUtil.find({
      stationId,
      // 未満
      ft: { $lt: endDateTime },
      // 以上
      to: { $gte: startDateTime },
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
    const radikoTime: DateTime = broadcastTimeConverter.getCurrentRadioTime();
    return await this.getProgramData(stationId, radikoTime, retry);
  }

  /** 指定局・時間の番組取得 */
  public async getProgramData(stationId: string, dateTime: DateTime, retry: boolean): Promise<RadikoProgramData> {
    let radikoProgramData: RadikoProgramData = await this.findProgramData(stationId, dateTime);

    if (radikoProgramData && retry === true) {
      const stations: Set<string> = await this.getDailyStationPrograms(stationId, dateTime);

      if (stations.has(stationId) === true) {
        return await this.findProgramData(stationId, dateTime);
      }
    }

    return radikoProgramData
  }

  /** DB検索＋キャッシュ */
  private async findProgramData(stationId: string, timeFull: DateTime): Promise<RadikoProgramData> {
    // 'yyyyMMddHHmmss'形式に変換
    const time: string = broadcastTimeConverter.parseDateTimeToStringDateTime(timeFull);

    if (stationId !== this.lastStationId || time !== this.lastTime) {
      try {
        const result: RadikoProgramData | null = await this.dbUtil.findOne({
          stationId,
          ft: { $lt: `${time}01` },
          to: { $gt: `${time}01` },
        });

        if (result !== undefined && result !== null) {
          this.cachedProgram = result;
          this.lastStationId = stationId;
          this.lastTime = time;
        } else {
          this.logger.error('JRADI02SE0001', stationId, time);
          this.cachedProgram = { ...EMPTY_PROGRAM };
        }

      } catch (error: any) {
        this.logger.error('JRADI02SE0002', stationId);
        this.cachedProgram = { ...EMPTY_PROGRAM };
      }
    }

    if (this.cachedProgram.progId !== '') {
      return this.cachedProgram;
    }

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
      this.dbUtil.remove({ to: { $lt: broadcastTimeConverter.getCurrentRadioTime() } }, { multi: true })
        .then(n => this.logger.info('JRADI02SI0001', n));
    } catch (error: any) {
      this.logger.error('JRADI02SE0004', error);
    }
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

  /** 局ごと1日分 */
  public async getDailyStationPrograms(stationId: string, dateTime: DateTime): Promise<Set<string>> {
    // 'yyyyMMdd'形式に変換
    const date: string = broadcastTimeConverter.parseDateTimeToStringDate(dateTime);
    return await this.getPrograms(utilFormat(PROG_DAILY_STATION_URL, date, stationId));
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

      // await を忘れずに
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
    this.dbUtil.ensureIndex({ fieldName: 'progId', unique: true });
    this.dbUtil.ensureIndex({ fieldName: 'stationId' });
    this.dbUtil.ensureIndex({ fieldName: 'ft' });
    this.dbUtil.ensureIndex({ fieldName: 'to' });
  }
}
