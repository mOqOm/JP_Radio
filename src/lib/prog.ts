import { format } from 'date-fns';
import got from 'got';
import Datastore from 'nedb-promises';
import { XMLParser } from 'fast-xml-parser';
import { format as utilFormat } from 'util';
import pLimit from 'p-limit';

import { PROG_URL } from './consts/radikoUrls';
import type { RadikoProgramData } from './models/RadikoProgramData';
import type { RadikoXMLData } from './models/RadikoXMLStation';

export default class RdkProg {
  private logger: Console;
  private db = Datastore.create({ inMemoryOnly: true });
  private lastStation: string | null = null;
  private lastTime: string | null = null;
  private cachedProgram: RadikoProgramData | null = null;

  constructor(logger: Console) {
    this.logger = logger;
    this.initDBIndexes();
  }

  private initDBIndexes(): void {
    this.db.ensureIndex({ fieldName: 'id', unique: true });
    this.db.ensureIndex({ fieldName: 'station' });
    this.db.ensureIndex({ fieldName: 'ft' });
    this.db.ensureIndex({ fieldName: 'tt' });
  }

  async getCurProgram(station: string): Promise<RadikoProgramData | null> {
    const currentTime = this.getCurrentTime();

    if (station !== this.lastStation || currentTime !== this.lastTime) {
      try {
        const result = await this.db.findOne({
          station,
          ft: { $lte: currentTime },
          tt: { $gte: currentTime },
        });

        this.cachedProgram = isRadikoProgramData(result) ? result : null;
      } catch (error) {
        this.logger.error(`JP_Radio::DB find error for station ${station}`, error);
      }

      this.lastStation = station;
      this.lastTime = currentTime;
    }

    return this.cachedProgram;
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
    const currentTime = this.getCurrentTime();
    try {
      await this.db.remove({ tt: { $lt: currentTime } }, { multi: true });
    } catch (error) {
      this.logger.error('JP_Radio::DB delete error', error);
    }
  }

  async updatePrograms(): Promise<void> {
    const currentDate = this.getCurrentDate();
    const parser = new XMLParser({
      attributeNamePrefix: '@',
      ignoreAttributes: false,
      allowBooleanAttributes: true,
    });

    const areaIDs = Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
    // 並列数5に制限
    const limit = pLimit(5);

    const tasks = areaIDs.map((areaID) =>
      limit(async () => {
        const url = utilFormat(PROG_URL, currentDate, areaID);
        try {
          const response = await got(url);
          const xmlData: RadikoXMLData = parser.parse(response.body);

          for (const stationData of xmlData.radiko.stations.station) {
            const stationId = stationData['@id'];
            const progRaw = stationData.progs?.prog;
            const progs = Array.isArray(progRaw) ? progRaw : [progRaw];

            for (const prog of progs) {
              const program: RadikoProgramData = {
                station: stationId,
                id: stationId + prog['@id'],
                ft: prog['@ft'],
                tt: prog['@to'],
                title: prog['title'],
                pfm: prog['pfm'] || '',
              };
              await this.putProgram(program);
            }
          }
        } catch (error) {
          this.logger.error(`JP_Radio::Failed to update program for ${areaID}`, error);
        }
      })
    );

    await Promise.all(tasks);
  }

  async dbClose(): Promise<void> {
    this.logger.info('JP_Radio::DB compacting');
    await this.db.persistence.compactDatafile();
  }

  async allData(): Promise<string> {
    const data = await this.db.find({});
    return JSON.stringify(data, null, 2);
  }

  private getCurrentTime(): string {
    return format(new Date(), 'yyyyMMddHHmm');
  }

  private getCurrentDate(): string {
    return format(new Date(), 'yyyyMMdd');
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
