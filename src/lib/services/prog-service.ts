import { httpClient } from '@/utils/http-client';
import Datastore from 'nedb-promises';
import { XMLParser } from 'fast-xml-parser';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';

import { PROG_DATE_AREA_URL, PROG_DAILY_STATION_URL } from '@/consts/radiko-urls';
import type { RadikoProgramData } from '@/models/radiko-program-model';
import type { RadikoXMLData } from '@/models/radiko-xml-station-model';
import type { StationInfo } from '@/models/station-model';

import { getCurrentDate, getCurrentRadioTime, getCurrentRadioDate, cnvRadioTime, parseRadioTime, addDaysToDateOnly, toMinutePrecision } from '@/utils/radio-time';
import { toArray } from '@/utils/xml';
import { isStationRelevantForArea, isDuplicateAreaFreeStation } from '@/logic/station-filter';
import type { LoggerEx } from '@/utils/logger';

const EMPTY_PROGRAM: RadikoProgramData = {
  station: '',
  id: '',
  ft: '',
  tt: '',
  title: '',
  pfm: '',
  img: '',
};

/**
 * 番組表データを管理するModel層。取得したXMLをパースし、nedbのインメモリDBに保存・検索する。
 * 現在放送中の番組を高速に引けるよう、直近の検索結果を`cachedProgram`にキャッシュする。
 */
export default class RdkProg {
  private readonly logger: LoggerEx;
  private readonly db = Datastore.create({ inMemoryOnly: true });
  private readonly xmlParser = new XMLParser({
    attributeNamePrefix: '@',
    ignoreAttributes: false,
    allowBooleanAttributes: true,
  });

  private lastStation = '';
  private lastTime = '';
  private cachedProgram: RadikoProgramData = { ...EMPTY_PROGRAM };

  /**
   * @param logger ログ出力先。
   */
  constructor(logger: LoggerEx) {
    this.logger = logger;
    this.initDBIndexes();
  }

  /**
   * 指定局の現在放送中の番組を返す。直前と同じ局・同じ分であればキャッシュを返す。
   * @param station 局ID。
   */
  async getCurProgram(station: string): Promise<RadikoProgramData | undefined> {
    const currentTime = toMinutePrecision(getCurrentRadioTime());

    if (station !== this.lastStation || currentTime !== this.lastTime) {
      try {
        // TODO: TBS,YFM,MBS,NORTHWAVE,etcでヒットしない問題
        //       (常にってわけじゃなく時々なのが非常に厄介)
        const result: RadikoProgramData | null = await this.db.findOne({
          station,
          ft: { $lt: currentTime + '01' },
          tt: { $gt: currentTime + '01' },
        });

        if (result !== null) {
          this.cachedProgram = result;
        } else {
          this.logger.warn('PRG_W001', station, currentTime);
          this.cachedProgram = { ...EMPTY_PROGRAM };
        }

        this.lastStation = station;
        this.lastTime = currentTime;
      } catch (error: any) {
        this.logger.error('PRG_E002', station, error);
      }
    }

    if (this.cachedProgram.id !== '') {
      return this.cachedProgram;
    }
    return undefined;
  }

  /**
   * 指定局・指定放送開始時刻(`ft`)に一致する番組をDBから検索する。
   * タイムフリー再生時に、URIで指定された`ft`から番組のタイトル等を引くために使う。
   * @param station 局ID。
   * @param ft 放送開始時刻(ラジオ時間、`'yyyyMMddHHmmss'`)。
   */
  async findProgram(station: string, ft: string): Promise<RadikoProgramData | undefined> {
    try {
      const result: RadikoProgramData | null = await this.db.findOne({ station, ft });
      if (result !== null) {
        return result;
      }
      return undefined;
    } catch (error: any) {
      this.logger.error('PRG_E003', station, ft, error);
      return undefined;
    }
  }

  /**
   * 番組データを1件DBへ挿入する。重複挿入(`uniqueViolated`)はエラーログを出さず無視する。
   * @param prog 挿入する番組データ。
   */
  async putProgram(prog: RadikoProgramData): Promise<void> {
    try {
      await this.db.insert(prog);
    } catch (error: any) {
      if (error?.errorType !== 'uniqueViolated') {
        this.logger.error('PRG_E004', error);
      }
    }
  }

  /**
   * 終了時刻が現在時刻より前の古い番組データをDBから削除する。
   */
  async clearOldProgram(): Promise<void> {
    try {
      // TODO: TBS,MBS消しすぎてない??
      const currentTime = toMinutePrecision(getCurrentRadioTime());
      await this.db.remove({ tt: { $lt: currentTime } }, { multi: true });
    } catch (error: any) {
      this.logger.error('PRG_E005', error);
    }
  }

  /**
   * 指定エリア群の番組表XML(`PROG_DATE_AREA_URL`)を並列(最大5並列)で取得し、DBへ格納する。
   * 全国広域局(RN1/RN2/JOAK-FM)は`JP13`のみで処理し、NHK地方局(JO**)はエリアフリー局と
   * 重複しないよう1度だけ処理することで、同一番組の多重登録を防いでいる。
   * @param areaIdArray 取得対象のエリアID一覧(例: `['JP13', 'JP14']`)。
   * @param stationsMap 局IDから{@link StationInfo}を引くためのマップ(所属エリア判定に使用)。
   * @param whenBoot trueの場合は起動時取得としてラジオ時間(`getCurrentRadioDate`)基準の日付を使う。
   */
  async updatePrograms(areaIdArray: Array<string>, stationsMap: Map<string, StationInfo> , whenBoot: boolean): Promise<void> {
    // boot時はラジオ時間で，cron時は実時間で取得
    let currentDate: string;
    let bootOrCron: string;
    if (whenBoot === true) {
      currentDate = getCurrentRadioDate();
      bootOrCron = 'boot';
    } else {
      currentDate = getCurrentDate();
      bootOrCron = 'cron';
    }
    this.logger.info('PRG_I001', bootOrCron, currentDate);

    const limit = pLimit(5);
    const doneAreaFree = new Set<string>();

    const tasks = areaIdArray.map((areaId) =>
      limit(async () => {
        const url = utilFormat(PROG_DATE_AREA_URL, currentDate, areaId);
        try {
          const response = await httpClient.get(url);
          const xmlData: RadikoXMLData = this.xmlParser.parse(response.body);
          const stations = toArray(xmlData?.radiko?.stations?.station);

          for (const stationData of stations) {
            // FM802対策
            const stationId = String(stationData['@id']);
            // 広域局の多重処理をスキップ
            const station = stationsMap?.get(stationId);

            if (station === undefined) {
              // 情報がなければスキップ(nonAreaFreeでエリア外)
              continue;
            }

            if (isStationRelevantForArea(station, areaId) === false) {
              continue;
            }

            // NHK地方局(JO**)
            if (isDuplicateAreaFreeStation(station, stationId, doneAreaFree) === true) {
              continue;
            } else {
              doneAreaFree.add(stationId);
            }

            const progRaw = stationData.progs?.prog;
            if (progRaw === undefined) {
              continue;
            }

            const progs = toArray(progRaw);
            const today = parseRadioTime(progs[0]['@ft']).date;
            for (const prog of progs) {
              let pfm = prog['pfm'];
              if (pfm === undefined) {
                pfm = '';
              }
              const ft = cnvRadioTime(prog['@ft'], today);
              const program: RadikoProgramData = {
                // FM802対策
                station: String(stationId),
                // 同一progId対策(TBS等の長時間番組は1時間ごとに区切られるが@idが同一のため、放送開始時刻(HHmm)を付加して一意にする)
                id: stationId + prog['@id'] + ft.slice(8, 12),
                ft,
                tt: cnvRadioTime(prog['@to'], today),
                title: prog['title'],
                pfm,
                img: prog['img'],
              };
              await this.putProgram(program);
            }
          }
        } catch (error: any) {
          this.logger.error('PRG_E006', areaId, error);
        }
      })
    );

    await Promise.all(tasks);
  }

  /**
   * 指定局・指定日付範囲(`'yyyyMMdd'`、両端含む)に該当する番組をDBから検索する。サーバーへは問い合わせない。
   * タイムフリー番組表の表示時、まずDBキャッシュを優先して参照することで、閲覧のたびに毎回サーバーへ
   * 問い合わせていた従来の挙動(表示が遅い原因)を避けるために使う。DBにない日付は`getStationProgramsForDates`
   * で個別に補う。
   * @param station 局ID。
   * @param fromDateOnly 範囲開始日(`'yyyyMMdd'`)。
   * @param toDateOnly 範囲終了日(`'yyyyMMdd'`、この日を含む)。
   */
  async findProgramsInRange(station: string, fromDateOnly: string, toDateOnly: string): Promise<RadikoProgramData[]> {
    try {
      const exclusiveEnd = addDaysToDateOnly(toDateOnly, 1);
      return await this.db.find({
        station,
        ft: { $gte: fromDateOnly + '000000', $lt: exclusiveEnd + '000000' },
      });
    } catch (error: any) {
      this.logger.error('PRG_E007', station, fromDateOnly, toDateOnly, error);
      return [];
    }
  }

  /**
   * 指定局・指定日の番組表XML(`PROG_DAILY_STATION_URL`)を取得し、DBへ保存した上で配列として返す。
   * `findProgramsInRange`でDBに見つからなかった日付を個別に補うために使う。
   * @param stationId 局ID。
   * @param date 対象日(`'yyyyMMdd'`)。
   */
  async getStationProgramsForDate(stationId: string, date: string): Promise<RadikoProgramData[]> {
    const url = utilFormat(PROG_DAILY_STATION_URL, date, stationId);
    const programs: RadikoProgramData[] = [];
    try {
      const response = await httpClient.get(url);
      const xmlData: RadikoXMLData = this.xmlParser.parse(response.body);
      const stations = toArray(xmlData?.radiko?.stations?.station);

      for (const stationData of stations) {
        const progsBlocks = toArray(stationData.progs);
        for (const block of progsBlocks) {
          const progs = toArray(block?.prog);
          if (progs.length === 0) {
            continue;
          }
          const today = parseRadioTime(progs[0]['@ft']).date;
          for (const prog of progs) {
            let pfm = prog['pfm'];
            if (pfm === undefined) {
              pfm = '';
            }
            const ft = cnvRadioTime(prog['@ft'], today);
            const program: RadikoProgramData = {
              station: String(stationId),
              // 同一progId対策(TBS等の長時間番組は1時間ごとに区切られるが@idが同一のため、放送開始時刻(HHmm)を付加して一意にする)
              id: stationId + prog['@id'] + ft.slice(8, 12),
              ft,
              tt: cnvRadioTime(prog['@to'], today),
              title: prog['title'],
              pfm,
              img: prog['img'],
            };
            programs.push(program);
            await this.putProgram(program);
          }
        }
      }
    } catch (error: any) {
      this.logger.error('PRG_E008', stationId, date, error);
    }
    return programs;
  }

  /**
   * 指定局について、複数日分の番組表(`getStationProgramsForDate`)を並列(最大5並列)で取得する。
   * @param stationId 局ID。
   * @param dates 対象日(`'yyyyMMdd'`)の配列。
   */
  async getStationProgramsForDates(stationId: string, dates: string[]): Promise<RadikoProgramData[]> {
    const limit = pLimit(5);
    const results = await Promise.all(
      dates.map((date) => limit(() => this.getStationProgramsForDate(stationId, date)))
    );
    return results.flat();
  }

  /**
   * DBファイルをコンパクションして終了する(プラグイン停止時に呼ばれる)。
   */
  async dbClose(): Promise<void> {
    this.logger.info('PRG_I002');
    await this.db.persistence.compactDatafile();
  }

  /**
   * DB内の全番組データを返す(デバッグ/確認用エンドポイント`/radiko/all/stations`向け)。
   */
  async allData(): Promise<any[]> {
    return await this.db.find({});
  }

  /**
   * 検索頻度の高いフィールド(id/station/ft/tt)にインデックスを張る。idはユニーク制約。
   */
  private initDBIndexes(): void {
    this.db.ensureIndex({ fieldName: 'id', unique: true });
    this.db.ensureIndex({ fieldName: 'station' });
    this.db.ensureIndex({ fieldName: 'ft' });
    this.db.ensureIndex({ fieldName: 'tt' });
  }

}
