import got from 'got';
import Datastore from 'nedb-promises';
import { XMLParser } from 'fast-xml-parser';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';

import { PROG_DATE_AREA_URL, PROG_NOW_AREA_URL, PROG_TODAY_AREA_URL, PROG_DAILY_STATION_URL, PROG_WEEKLY_STATION_URL } from '../constants/radiko-urls.constants';
import type { RadikoProgramData } from '../models/radiko-program.model';
import type { RadikoXMLData } from '../models/radiko-xml-station.model';
import { RadioTime } from './radio-time';
import { LoggerEx } from '../utils/logger';

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
  private readonly logger: LoggerEx;
  private readonly db = Datastore.create({ inMemoryOnly: true });
  private readonly xmlParser = new XMLParser({
      attributeNamePrefix   : '@',
      ignoreAttributes      : false,
      allowBooleanAttributes: true,
    });

  private lastStationId = '';
  private lastTime = '';
  private cachedProgram: RadikoProgramData = { ...EMPTY_PROGRAM };

  constructor(logger: LoggerEx) {
    this.logger = logger;
    this.initDBIndexes();
  }

  public async getCurProgramData(stationId: string, retry: boolean): Promise<RadikoProgramData | undefined> {
    //this.logger.info(`JP_Radio::RdkProg.getCurProgramData: station=${stationId}`);
    return await this.getProgramData(stationId, RadioTime.getCurrentRadioTime(), retry);
  }

  public async getProgramData(stationId: string, time: string, retry: boolean): Promise<RadikoProgramData | undefined> {
    //this.logger.info(`JP_Radio::RdkProg.getProgramData: station=${stationId}, time=${time}, retry=${retry}`);
    var progData = await this.findProgramData(stationId, time);
    if (!progData && retry) {
      const result = await this.getDailyStationPrograms(stationId, time);
      progData = result.has(stationId) ? await this.findProgramData(stationId, time) : undefined;
    }
    return progData;
  }

  private async findProgramData(stationId: string, timeFull: string): Promise<RadikoProgramData | undefined> {
    //this.logger.info(`JP_Radio::RdkProg.findProgramData: station=${stationId}, time=${timeFull}`);
    const time = timeFull.slice(0, 12); // yyyyMMddHHmm
    if (stationId !== this.lastStationId || time !== this.lastTime) {
      try {
        const result: RadikoProgramData | null = await this.db.findOne({
          stationId,
          ft: { $lt: `${time}01` }, // yyyyMMddHHmmss
          to: { $gt: `${time}01` },
        });
        if (result) {
          this.cachedProgram = result;
          this.lastStationId = stationId;
          this.lastTime = time;
        } else {
          this.logger.error(`JP_Radio::RdkProg.findProgram: ## ${stationId},${time} cannot find. ##`);
          this.cachedProgram = { ...EMPTY_PROGRAM };
        }

      } catch (error) {
        this.logger.error(`JP_Radio::DB find error for station ${stationId}`);
        this.cachedProgram = { ...EMPTY_PROGRAM };
      }
    }
    return this.cachedProgram.progId ? this.cachedProgram : undefined;
  }

//-----------------------------------------------------------------------

  private async putProgram(prog: RadikoProgramData): Promise<void> {
    try {
      await this.db.insert(prog);
    } catch (error: any) {
      if (error?.errorType !== 'uniqueViolated') {
        this.logger.error('JP_Radio::DB insert error', error);
      }
    }
  }

  public async clearOldProgram(): Promise<void> {
    try {
      this.db.remove({ to: { $lt: RadioTime.getCurrentRadioTime() } }, { multi: true })
      .then((numRemoved) => {
        this.logger.info(`JP_Radio::RdkProg.clearOldProgram: Removed ${numRemoved} documents from DB`);
      });
    } catch (error) {
      this.logger.error('JP_Radio::DB delete error');
    }
    await this.dbCount();
  }

  public async updatePrograms(areaIdArray: string[], whenBoot: boolean): Promise<number> {
    this.logger.info(`JP_Radio::RdkProg.updatePrograms: [${whenBoot ? 'boot' : 'cron'}]`);
    const limit = pLimit(5);
    var doneStations = new Set();
    const tasks = areaIdArray.map((areaId) =>
      limit(async () => {
        // boot時はラジオ時間で，cron時は実時間で取得
        const url = whenBoot ? utilFormat(PROG_TODAY_AREA_URL, areaId) : utilFormat(PROG_DATE_AREA_URL, RadioTime.getCurrentDate(), areaId);
        const stations = await this.getPrograms(url, doneStations);
        stations.forEach((s) => doneStations.add(s) );
      })
    );
    await Promise.all(tasks);
    return doneStations.size;
  }

  public async getDateAreaPrograms(areaId: string, time: string): Promise<Set<string>> {
    this.logger.info(`JP_Radio::RdkProg.getDateAreaPrograms`);
    const date = time.slice(0, 8); // yyyyMMdd
    const url = utilFormat(PROG_DATE_AREA_URL, date, areaId);
    return await this.getPrograms(url);
  }

  public async getNowAreaPrograms(areaId: string): Promise<Set<string>> {
    this.logger.info(`JP_Radio::RdkProg.getNowAreaPrograms`);
    const url = utilFormat(PROG_NOW_AREA_URL, areaId);
    return await this.getPrograms(url);
  }

  public async getTodayAreaPrograms(areaId: string): Promise<Set<string>> {
    this.logger.info(`JP_Radio::RdkProg.getTodayAreaPrograms`);
    const url = utilFormat(PROG_TODAY_AREA_URL, areaId);
    return await this.getPrograms(url);
  }

  public async getDailyStationPrograms(stationId: string, time: string): Promise<Set<string>> {
    this.logger.info(`JP_Radio::RdkProg.getDailyStationPrograms`);
    const date = time.slice(0, 8); // yyyyMMdd
    const url = utilFormat(PROG_DAILY_STATION_URL, date, stationId);
    return await this.getPrograms(url);
  }

  public async getWeeklyStationPrograms(stationId: string): Promise<Set<string>> {
    this.logger.info(`JP_Radio::RdkProg.getWeeklyStationPrograms`);
    const url = utilFormat(PROG_WEEKLY_STATION_URL, stationId);
    return await this.getPrograms(url);
  }

  private async getPrograms(url: string, skipStations: Set<any> = new Set()): Promise<Set<any>> {
    this.logger.info(`JP_Radio::RdkProg.getPrograms: ${url}`);
    var doneStations = new Set();
    try {
      const response = await got(url);
      const xmlData: RadikoXMLData = this.xmlParser.parse(response.body);
      const stationRaw = xmlData?.radiko?.stations?.station ?? [];
      const stations = Array.isArray(stationRaw) ? stationRaw : [stationRaw];

      for (const stationData of stations) {
        const stationId: string = stationData['@id'];
        // 広域局の多重処理をスキップ
        if (skipStations.has(stationId)) continue;

        const stationProgs = Array.isArray(stationData.progs) ? stationData.progs : [stationData.progs];
        for (const i in stationProgs) {
          const progRaw = stationProgs[i].prog;
          if (!progRaw) continue;
          var prevTo = '';
          const progs = Array.isArray(progRaw) ? progRaw : [progRaw];
          for (const prog of progs) {
            const ft = RadioTime.convertRadioTime(prog['@ft'], '05');
            if (prevTo && prevTo < ft) {
              // 途切れた番組表をダミーで埋める
              await this.putProgram({ stationId, progId:`${stationId}_${prevTo}`, ft:prevTo, to:ft, title:'' });
            }
            const to = RadioTime.convertRadioTime(prog['@to'], '29');
            const progId = `${stationId}${prog['@id']}${ft.slice(8,12)}`; // 同一progId対策(HHmmを付加)
            const program: RadikoProgramData = {
              stationId, progId, ft, to,
              title : prog['title'],
              info  : prog['info'] ?? '',
              pfm   : prog['pfm'] ?? '',
              img   : prog['img'] ?? ''
            };
            await this.putProgram(program);
            prevTo = to;
            //if (stationId == 'TBS')
            //  this.logger.info(`JP_Radio::RdkProg.getPrograms: ${Object.entries(program)}`);
          }
          if (prevTo.slice(8) < '290000') {
            // 29:00までダミーで埋める
            await this.putProgram({ stationId, progId:`${stationId}_${prevTo}`, ft:prevTo, to:`${prevTo.slice(0,8)}290000`, title:'' });
          }
        }
        doneStations.add(stationId);
      }
    } catch (error) {
      this.logger.error(`JP_Radio::Failed to update program for ${url}`);
    }
    await this.dbCount();
    return doneStations;
  }

  public async dbClose(): Promise<void> {
    //this.logger.info('JP_Radio::DB compacting');
    //await this.db.persistence.compactDatafile();
    await this.db.remove({}, { multi: true })
    .then((numRemoved) => {
      this.logger.info(`JP_Radio::RdkProg.dbClose: Removed ${numRemoved} documents from DB`);
    });
  }

  public async allData(): Promise<any[]> {
    return await this.db.find({});
  }

  public async dbCount(): Promise<number> {
    const count = await this.db.count({});
    this.logger.info(`JP_Radio::RdkProg.dbCount: ${count}`);
    return count;
  }

  private initDBIndexes(): void {
    this.db.ensureIndex({ fieldName: 'progId', unique: true });
    this.db.ensureIndex({ fieldName: 'stationId' });
    this.db.ensureIndex({ fieldName: 'ft' });
    this.db.ensureIndex({ fieldName: 'to' });
  }
}
