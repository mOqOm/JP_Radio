import got from 'got';
import Datastore from 'nedb-promises';
import { XMLParser } from 'fast-xml-parser';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';

import { PROG_DATE_AREA_URL } from './consts/radiko-urls';
import type { RadikoProgramData } from './models/radiko-program-model';
import type { RadikoXMLData } from './models/radiko-xml-station-model';
import type { StationInfo } from './models/station-model';

import { getCurrentDate, getCurrentRadioTime, getCurrentRadioDate, cnvRadioTime } from './radio-time';

const EMPTY_PROGRAM: RadikoProgramData = {
  station: '',
  id: '',
  ft: '',
  tt: '',
  title: '',
  pfm: '',
  img: '',
};

export default class RdkProg {
  private readonly logger: Console;
  private readonly db = Datastore.create({ inMemoryOnly: true });

  private lastStation = '';
  private lastTime = '';
  private cachedProgram: RadikoProgramData = { ...EMPTY_PROGRAM };

  constructor(logger: Console) {
    this.logger = logger;
    this.initDBIndexes();
  }

  async getCurProgram(station: string): Promise<RadikoProgramData | undefined> {
    // yyyyMMddHHmm
    const currentTime = getCurrentRadioTime().substring(0, 12);

    if (station !== this.lastStation || currentTime !== this.lastTime) {
      try {
        // TODO: TBS,YFM,MBS,NORTHWAVE,etcでヒットしない問題
        //       (常にってわけじゃなく時々なのが非常に厄介)
        const result: RadikoProgramData | null = await this.db.findOne({
          station,
          ft: { $lt: currentTime + '01' },
          tt: { $gt: currentTime + '01' },
        });

        if (result) {
          this.cachedProgram = result;
        } else {
          this.logger.error(`JP_Radio::RdkProg.getCurProgram: ## ${station}:${currentTime} cannot find. ##`);
          this.cachedProgram = { ...EMPTY_PROGRAM };
        }

        this.lastStation = station;
        this.lastTime = currentTime;
      } catch (error) {
        this.logger.error(`JP_Radio::DB find error for station ${station}`, error);
      }
    }

    return this.cachedProgram.id ? this.cachedProgram : undefined;
  }

  async putProgram(prog: RadikoProgramData): Promise<void> {
    try {
      await this.db.insert(prog);
    } catch (error: any) {
      if (error?.errorType !== 'uniqueViolated') {
        this.logger.error('JP_Radio::DB insert error', error);
      }
    }
  }

  async clearOldProgram(): Promise<void> {
    try {
      // TODO: TBS,MBS消しすぎてない??
      // yyyyMMddHHmm
      const currentTime = getCurrentRadioTime().substring(0, 12);
      await this.db.remove({ tt: { $lt: currentTime } }, { multi: true });
    } catch (error) {
      this.logger.error('JP_Radio::DB delete error', error);
    }
  }

  async updatePrograms(areaIdArray: Array<string>, stationsMap: Map<string, StationInfo> , whenBoot: boolean): Promise<void> {
    // boot時はラジオ時間で，cron時は実時間で取得
    const currentDate = whenBoot ? getCurrentRadioDate() : getCurrentDate();
    this.logger.info(`JP_Radio::RdkProg.updatePrograms: [${whenBoot ? 'boot' : 'cron'}] ${currentDate}`);

    const parser = new XMLParser({
      attributeNamePrefix: '@',
      ignoreAttributes: false,
      allowBooleanAttributes: true,
    });

    const limit = pLimit(5);
    const doneAreaFree = new Set<string>();

    const tasks = areaIdArray.map((areaId) =>
      limit(async () => {
        const url = utilFormat(PROG_DATE_AREA_URL, currentDate, areaId);
        try {
          const response = await got(url);
          const xmlData: RadikoXMLData = parser.parse(response.body);
          const stations = xmlData?.radiko?.stations?.station ?? [];

          for (const stationData of stations) {
            const stationId = String(stationData['@id']);  // FM802対策
            // 広域局の多重処理をスキップ
            const station = stationsMap?.get(stationId);

            if (!station) {
              continue; // 情報がなければスキップ(nonAreaFreeでエリア外)
            }

            // 一般局，全国広域(RN1,RN2,JOAK-FM)
            if(station.AreaId !== areaId && station.AreaFree !== '0'
              || station.RegionName === '全国' && areaId !== 'JP13'){
              continue;
            }

            // NHK地方局(JO**)
            if(station.AreaFree === '0' && doneAreaFree.has(stationId)) {
              continue;
            } else {
              doneAreaFree.add(stationId);
            }

            const progRaw = stationData.progs?.prog;
            if (!progRaw) continue;

            const progs = Array.isArray(progRaw) ? progRaw : [progRaw];
            const today = progs[0]['@ft'].substring(0, 8);  // yyyyMMdd
            for (const prog of progs) {
              const program: RadikoProgramData = {
                station: String(stationId),   // FM802対策
                id: stationId + prog['@id'],
                ft: cnvRadioTime(prog['@ft'], today),
                tt: cnvRadioTime(prog['@to'], today),
                title: prog['title'],
                pfm: prog['pfm'] ?? '',
                img: prog['img'],
              };
              await this.putProgram(program);
            }
          }
        } catch (error) {
          this.logger.error(`JP_Radio::Failed to update program for ${areaId}`, error);
        }
      })
    );

    await Promise.all(tasks);
  }

  async dbClose(): Promise<void> {
    this.logger.info('JP_Radio::DB compacting');
    await this.db.persistence.compactDatafile();
  }

  async allData(): Promise<any[]> {
    return await this.db.find({});
  }

  private initDBIndexes(): void {
    this.db.ensureIndex({ fieldName: 'id', unique: true });
    this.db.ensureIndex({ fieldName: 'station' });
    this.db.ensureIndex({ fieldName: 'ft' });
    this.db.ensureIndex({ fieldName: 'tt' });
  }

}
