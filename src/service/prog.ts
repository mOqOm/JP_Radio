// HTTPリクエスト用
import got from 'got';
// XML→JSオブジェクト変換用
import { XMLParser } from 'fast-xml-parser';
// util.format()と同じ（%s 置換用）
import { format as utilFormat } from 'util';
// Promise 同時実行数制御
import pLimit from 'p-limit';

// インメモリDB（テスト用途として使用）
import Datastore from 'nedb-promises';

// 独自ログラッパー
import { LoggerEx } from '../utils/logger';
// メッセージヘルパー（メッセージテンプレート → 動的置換）
import { MessageHelper } from '../utils/message-helper';
// radiko独自時刻変換（放送基準）
import { broadcastTimeConverter } from '../utils/broadcast-time-converter';
// DB Utility（Nedbラッパー）
import { DBUtil } from '../utils/db-util';

// radiko API URL定数
import {
  PROG_DATE_AREA_URL,
  PROG_NOW_AREA_URL,
  PROG_TODAY_AREA_URL,
  PROG_DAILY_STATION_URL,
  PROG_WEEKLY_STATION_URL
} from '../constants/radiko-urls.constants';

// 型定義
import type { RadikoProgramData } from '../models/radiko-program.model';
import type { RadikoXMLData } from '../models/radiko-xml-station.model';

// 空データ定義（キャッシュ初期化用）
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
  // 依存オブジェクト
  private readonly logger: LoggerEx;
  private readonly messageHelper: MessageHelper;

  // インメモリDB（※ただしDBUtilも使うので注意）
  private readonly db = Datastore.create({ inMemoryOnly: true });

  // Nedbラッパー（こちらが実質のDB）
  private readonly dbUtil: DBUtil<RadikoProgramData>;

  // XMLパーサ設定
  private readonly xmlParser = new XMLParser({
    attributeNamePrefix   : '@',   // XML属性に @ を付与
    ignoreAttributes      : false, // 属性もパース
    allowBooleanAttributes: true,  // boolean属性許可
  });

  // キャッシュ
  private lastStationId = '';
  private lastTime = '';
  private cachedProgram: RadikoProgramData = { ...EMPTY_PROGRAM };

  constructor(logger: LoggerEx, messageHelper: MessageHelper) {
    this.logger = logger;
    this.messageHelper = messageHelper;

    // DBユーティリティ初期化
    this.dbUtil = new DBUtil<RadikoProgramData>(logger);

    // インデックス設定（高速検索 & 一意制約）
    this.initDBIndexes();
  }

  /** 指定局の現時刻番組データ取得 */
  public async getCurProgramData(stationId: string, retry: boolean): Promise<RadikoProgramData | undefined> {
    return await this.getProgramData(stationId, broadcastTimeConverter.getCurrentRadioTime(), retry);
  }

  /**
   * 時刻・局から番組データを取得
   * retry = true の場合、見つからなければAPI呼んで再取得
   */
  public async getProgramData(stationId: string, time: string, retry: boolean): Promise<RadikoProgramData | undefined> {
    // DB検索
    let progData = await this.findProgramData(stationId, time);

    // 見つからず retry=true → radikoから取得
    if (!progData && retry) {
      const result = await this.getDailyStationPrograms(stationId, time);
      progData = result.has(stationId) ? await this.findProgramData(stationId, time) : undefined;
    }
    return progData;
  }

  /** DBから番組検索（キャッシュ利用・時間丸め） */
  private async findProgramData(stationId: string, timeFull: string): Promise<RadikoProgramData | undefined> {
    const time = timeFull.slice(0, 12); // YYYYMMDDHHMM までに切る

    // 局 or 時刻が変わった時のみ検索
    if (stationId !== this.lastStationId || time !== this.lastTime) {
      try {
        // ft < now < to の番組を検索
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
          this.logger.error(`RdkProg.findProgram: NOT FOUND ${stationId},${time}`);
          this.cachedProgram = { ...EMPTY_PROGRAM };
        }
      } catch {
        this.logger.error(`RdkProg.DB find error for station ${stationId}`);
        this.cachedProgram = { ...EMPTY_PROGRAM };
      }
    }

    return this.cachedProgram.progId ? this.cachedProgram : undefined;
  }

  /** DBへ番組保存（unique違反は無視） */
  private async putProgram(prog: RadikoProgramData): Promise<void> {
    try {
      await this.dbUtil.insert(prog);
    } catch (error: any) {
      if (error?.errorType !== 'uniqueViolated') {
        this.logger.error('RdkProg.DB insert error', error);
      }
    }
  }

  /** 古い番組削除 */
  public async clearOldProgram(): Promise<void> {
    try {
      this.dbUtil.remove({ to: { $lt: broadcastTimeConverter.getCurrentRadioTime() } }, { multi: true })
      .then(n => this.logger.info(`RdkProg.clearOldProgram: Removed ${n}`));
    } catch {
      this.logger.error('RdkProg.DB delete error');
    }
    await this.dbCount();
  }

  /** ★起動時 or Cron で全エリア更新 */
  public async updatePrograms(areaIdArray: string[], whenBoot: boolean): Promise<number> {
    this.logger.info(`RdkProg.updatePrograms: [${whenBoot ? 'boot' : 'cron'}]`);

    const limit = pLimit(5); // 同時5エリア処理
    const doneStations = new Set();

    await Promise.all(
      areaIdArray.map(areaId =>
        limit(async () => {
          const url = whenBoot
            ? utilFormat(PROG_TODAY_AREA_URL, areaId)
            : utilFormat(PROG_DATE_AREA_URL, broadcastTimeConverter.getCurrentDate(), areaId);

          const stations = await this.getPrograms(url, doneStations);
          stations.forEach(s => doneStations.add(s));
        })
      )
    );
    return doneStations.size;
  }

  /** 日付×エリア */
  public async getDateAreaPrograms(areaId: string, time: string) {
    const date = time.slice(0, 8);
    return await this.getPrograms(utilFormat(PROG_DATE_AREA_URL, date, areaId));
  }

  /** 現在×エリア */
  public async getNowAreaPrograms(areaId: string) {
    return await this.getPrograms(utilFormat(PROG_NOW_AREA_URL, areaId));
  }

  /** 今日×エリア */
  public async getTodayAreaPrograms(areaId: string) {
    return await this.getPrograms(utilFormat(PROG_TODAY_AREA_URL, areaId));
  }

  /** 局ごと1日分 */
  public async getDailyStationPrograms(stationId: string, time: string) {
    const date = time.slice(0, 8);
    return await this.getPrograms(utilFormat(PROG_DAILY_STATION_URL, date, stationId));
  }

  /** 局ごと1週間分 */
  public async getWeeklyStationPrograms(stationId: string) {
    return await this.getPrograms(utilFormat(PROG_WEEKLY_STATION_URL, stationId));
  }

  /**
   * radiko API → XML → 番組抽出 → DB保存
   * skipStations: 既に取得済み局スキップ用
   */
  private async getPrograms(url: string, skipStations: Set<any> = new Set()) {
    this.logger.info(`RdkProg.getPrograms: ${url}`);
    const doneStations = new Set();

    try {
      // ▼ radiko XML取得
      const response = await got(url);
      const xmlData: RadikoXMLData = this.xmlParser.parse(response.body);

      // stationノード抽出
      const stationRaw = xmlData?.radiko?.stations?.station ?? [];
      const stations = Array.isArray(stationRaw) ? stationRaw : [stationRaw];

      for (const s of stations) {
        const id = s['@id'];
        if (skipStations.has(id)) continue; // 二重取得回避

        const progSets = Array.isArray(s.progs) ? s.progs : [s.progs];

        for (const ps of progSets) {
          const progsRaw = ps.prog;
          if (!progsRaw) continue;

          let prevTo = '';
          const progs = Array.isArray(progsRaw) ? progsRaw : [progsRaw];

          for (const p of progs) {
            // radiko独自時刻 → 通常時刻
            const ft = broadcastTimeConverter.convertRadioTime(p['@ft'], '05');

            // 番組の隙間があれば補完
            if (prevTo && prevTo < ft) {
              await this.putProgram({ stationId: id, progId:`${id}_${prevTo}`, ft:prevTo, to:ft, title:'' });
            }

            const to = broadcastTimeConverter.convertRadioTime(p['@to'], '29');
            const progId = `${id}${p['@id']}${ft.slice(8,12)}`;

            // DB登録データ
            const program: RadikoProgramData = {
              stationId: id,
              progId,
              ft,
              to,
              title: p['title'],
              info: p['info'] ?? '',
              pfm: p['pfm'] ?? '',
              img: p['img'] ?? ''
            };

            await this.putProgram(program);
            prevTo = to;
          }

          // 29時まで足りない場合、埋める
          if (prevTo.slice(8) < '290000') {
            await this.putProgram({
              stationId: id,
              progId:`${id}_${prevTo}`,
              ft:prevTo,
              to:`${prevTo.slice(0,8)}290000`,
              title:''
            });
          }
        }
        doneStations.add(id);
      }
    } catch {
      this.logger.error(`RdkProg: Failed to update for URL ${url}`);
    }

    await this.dbCount();
    return doneStations;
  }

  /** DBクリア */
  public async dbClose() {
    await this.db.remove({}, { multi: true })
      .then(n => this.logger.info(`RdkProg.dbClose: Removed ${n}`));
  }

  /** 全件取得（デバッグ用） */
  public async allData() {
    return await this.db.find({});
  }

  /** 件数ログ出力 */
  public async dbCount() {
    const count = await this.dbUtil.count({});
    this.logger.info(`RdkProg.dbCount: ${count}`);
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
