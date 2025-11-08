import got from 'got';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';
import Datastore from 'nedb-promises';

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

// TODO: 定数から呼出し可能であればそれを用いる
const EMPTY_PROGRAM: RadikoProgramData = {
  stationId: '',
  progId: '',
  ft: '',
  to: '',
  title: '',
  info: '',
  pfm: '',
  img: ''
};

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
    this.xmlUtil = new RadikoXmlUtil(this.dbUtil);

    this.initDBIndexes();
  }

  /** 現在の番組取得 */
  public async getCurProgramData(stationId: string, retry: boolean): Promise<RadikoProgramData | undefined> {
    return await this.getProgramData(stationId, broadcastTimeConverter.getCurrentRadioTime(), retry);
  }

  /** 指定局・時間の番組取得 */
  public async getProgramData(stationId: string, time: string, retry: boolean): Promise<RadikoProgramData | undefined> {
    let progData = await this.findProgramData(stationId, time);

    if (!progData && retry) {
      const stations: Set<string> = await this.getDailyStationPrograms(stationId, time);
      progData = stations.has(stationId) ? await this.findProgramData(stationId, time) : undefined;
    }

    return progData;
  }

  /** DB検索＋キャッシュ */
  private async findProgramData(stationId: string, timeFull: string): Promise<RadikoProgramData | undefined> {
    const time: string = timeFull.slice(0, 12);

    if (stationId !== this.lastStationId || time !== this.lastTime) {
      try {
        const result = await this.dbUtil.findOne({
          stationId,
          ft: { $lt: `${time}01` },
          to: { $gt: `${time}01` },
        });

        if (result) {
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

    return this.cachedProgram.progId ? this.cachedProgram : undefined;
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
  public async getDailyStationPrograms(stationId: string, time: string): Promise<Set<string>> {
    const date: string = time.slice(0, 8);
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
      const stationsSet: Set<string> = await this.xmlUtil.parseAndSavePrograms(response.body, skipStations);

      // Set<string> は値のみなので for...of でループ
      for (const stationId of stationsSet as Set<string>) {
        doneStations.add(stationId);
      }

    } catch (error: any) {
      this.logger.error('JRADI02SE0005', url, error);
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
