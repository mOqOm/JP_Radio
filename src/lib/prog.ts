import got from 'got';
import Datastore from 'nedb-promises';
import { XMLParser } from 'fast-xml-parser';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';
import { formatInTimeZone } from 'date-fns-tz';
import { subHours } from 'date-fns';

import { PROG_URL } from './consts/radikoUrls';
import type { RadikoProgramData } from './models/RadikoProgramModel';
import type { RadikoXMLData } from './models/RadikoXMLStationModel';
import type { StationInfo } from './models/StationModel';

import { getCurrentDate, getCurrentRadioTime, getCurrentRadioDate, cnvRadioTime } from './radioTime';

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
        // TODO: TBS,YFM,MBS,NORTHWAVE,etcで時々ヒットしない問題 ⇒ 解決！
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
    const RETRY_COUNT = 5;
    for (var i=0; i<RETRY_COUNT; i++) {
      try {
        //this.logger.info(`JP_Radio::RdkProg.putProgram: ${prog.id}/${prog.ft} ${prog.title}`);
        await this.db.insert(prog);
        break ;

      } catch (error: any) {
        this.logger.error('JP_Radio::DB insert error', error);
        if (error?.errorType !== 'uniqueViolated') {
          break ;
        } else {
          // TBS等の同一prog.id対策，sufixを追加してリトライ
          const ids = `${prog.id}_0`.split('_');
          prog.id = `${ids[0]}_${Number(ids[1])+1}`;
          //this.logger.info(`JP_Radio::RdkProg.putProgram: Retrying new id ${prog.id}`);
        }
      }
    }
  }

  async clearOldProgram(): Promise<void> {
    try {
      // yyyyMMddHHmm
      const currentTime = getCurrentRadioTime().substring(0, 12);
      await this.db.remove({ tt: { $lt: currentTime } }, { multi: true });
    } catch (error) {
      this.logger.error('JP_Radio::DB delete error', error);
    }
  }

  async updatePrograms(areaIdArray: Array<string>, stationsMap: Map<string, StationInfo> , whenBoot: boolean): Promise<[number, number]> {
    // boot時はラジオ時間で，cron時は実時間で取得
    const currentDate = whenBoot ? getCurrentRadioDate() : getCurrentDate();
    this.logger.info(`JP_Radio::RdkProg.updatePrograms: [${whenBoot ? 'boot' : 'cron'}] ${currentDate}`);

    const parser = new XMLParser({
      attributeNamePrefix: '@',
      ignoreAttributes: false,
      allowBooleanAttributes: true,
    });

    const limit = pLimit(5);
    var doneAreaFree = new Set();
    var cntStation = 0;
    var cntProgram = 0;

    const tasks = areaIdArray.map((areaId) =>
      limit(async () => {
        const url = utilFormat(PROG_URL, currentDate, areaId);
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
            if(station.AreaId != areaId && station.AreaFree != '0'
              || station.RegionName == '全国' && areaId != 'JP13'){
              continue;
            }

             // NHK地方局(JO**)
            if(station.AreaFree == '0' && doneAreaFree.has(stationId)) {
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
              cntProgram++;
            }
            cntStation++;
          }
        } catch (error) {
          this.logger.error(`JP_Radio::Failed to update program for ${areaId}`, error);
        }
      })
    );

    await Promise.all(tasks);
    return [cntStation, cntProgram];
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

  private getCurrentTime(): string {
    return formatInTimeZone(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmm');
  }

  private getCurrentDate(): string {
    const now = new Date();
    // 現在時刻から5時間引いた日時を取得
    const dateForSwitch = subHours(now, 5);
    return formatInTimeZone(dateForSwitch, 'Asia/Tokyo', 'yyyyMMdd');
  }
}

function isRadikoProgramData(data: any): data is RadikoProgramData {
  return (
    typeof data?.station === 'string' &&
    typeof data?.id === 'string' &&
    typeof data?.ft === 'string' &&
    typeof data?.tt === 'string' &&
    typeof data?.title === 'string' &&
    typeof data?.pfm === 'string'
  );
}
