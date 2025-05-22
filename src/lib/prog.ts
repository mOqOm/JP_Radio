import { format } from 'date-fns';
import got from 'got';
import Datastore from 'nedb-promises';
import { XMLParser } from 'fast-xml-parser';
import { format as utilFormat } from 'util';

import { PROG_URL } from './consts/radikoUrls';
import type { RadikoProgramData } from './models/RadikoProgramData';
import type { RadikoXMLData } from './models/RadikoXMLStation';

export default class RdkProg {
  private logger: Console;
  private db = Datastore.create({ inMemoryOnly: true });
  private station: string | null = null;
  private lastdt: string | null = null;
  private radikoProgData: RadikoProgramData | null = null;

  constructor(logger: Console) {
    this.logger = logger;
    this.#initDBIndexes();
  }

  #initDBIndexes() {
    this.db.ensureIndex({ fieldName: 'id', unique: true });
    this.db.ensureIndex({ fieldName: 'station' });
    this.db.ensureIndex({ fieldName: 'ft' });
    this.db.ensureIndex({ fieldName: 'tt' });
  }

  async getCurProgram(station: string): Promise<RadikoProgramData | null> {
    const curdt = this.#getCurrentTime();

    if (station !== this.station || curdt !== this.lastdt) {
      try {
        const results = await this.db.find({
          station,
          ft: { $lte: curdt },
          tt: { $gte: curdt }
        });

        const first = results[0];
        this.radikoProgData = isRadikoProgramData(first) ? first : null;
      } catch (error) {
        this.logger.error(`JP_Radio::DB Find Error for station ${station}`, error);
      }

      this.station = station;
      this.lastdt = curdt;
    }

    return this.radikoProgData;
  }

  async putProgram(prog: RadikoProgramData): Promise<void> {
    try {
      await this.db.insert(prog);
    } catch (error: any) {
      if (error?.errorType !== 'uniqueViolated') {
        this.logger.error('JP_Radio::DB Insert Error', error);
      }
    }
  }

  async clearOldProgram(): Promise<void> {
    const curdt = this.#getCurrentTime();
    try {
      await this.db.remove({ tt: { $lt: curdt } }, { multi: true });
    } catch (error) {
      this.logger.error('JP_Radio::DB Delete Error', error);
    }
  }

  async updatePrograms(): Promise<void> {
    const curDate = this.#getCurrentDate();
    const xmlParser = new XMLParser({
      attributeNamePrefix: '@',
      ignoreAttributes: false,
      allowBooleanAttributes: true
    });

    for (let i = 1; i <= 47; i++) {
      const areaID = `JP${i}`;
      const url = utilFormat(PROG_URL, curDate, areaID);

      try {
        const response = await got(url);
        const data: RadikoXMLData = xmlParser.parse(response.body);

        for (const stationData of data.radiko.stations.station) {
          const stationName = stationData['@id'];
          if (stationName === 'MAJAL') continue;

          for (const prog of stationData.progs.prog) {
            await this.putProgram({
              station: stationName,
              id: stationName + prog['@id'],
              ft: prog['@ft'],
              tt: prog['@to'],
              title: prog['title'],
              pfm: prog['pfm'] || ''
            });
          }
        }
      } catch (error) {
        this.logger.error(`JP_Radio::Failed to update program for ${areaID}`, error);
      }
    }
  }

  async dbClose(): Promise<void> {
    this.logger.info('JP_Radio::DB Compacting');
    await this.db.persistence.compactDatafile();
  }

  async allData(): Promise<string> {
    const data = await this.db.find({});
    return JSON.stringify(data, null, 2);
  }

  /**
   * "yyyyMMddHHmm" 形式の現在時刻文字列を返す
   */
  #getCurrentTime(): string {
    return format(new Date(), 'yyyyMMddHHmm');
  }

  /**
   * "yyyyMMdd" 形式の現在日付文字列を返す
   */
  #getCurrentDate(): string {
    return format(new Date(), 'yyyyMMdd');
  }
}

/**
 * 型チェックユーティリティ
 */
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
