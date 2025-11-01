// src/utils/radiko-xml-util.ts
import { XMLParser } from 'fast-xml-parser';
import { RadikoXMLData, RadikoXMLStation, RadikoXMLProg } from '../models/radiko-xml-station.model';
import { RADIKO_XML_PARSER_OPTIONS } from '../constants/radiko-xml.constants';
import { RadikoProgramData } from '../models/radiko-program.model';
import { broadcastTimeConverter } from './broadcast-time-converter.util';
import { DBUtil } from './db.util';

export class RadikoXmlUtil {
  private readonly dbUtil: DBUtil<RadikoProgramData>;
  private readonly xmlParser: XMLParser;

  constructor(dbUtil: DBUtil<RadikoProgramData>) {
    this.dbUtil = dbUtil;
    this.xmlParser = new XMLParser(RADIKO_XML_PARSER_OPTIONS);
  }

  /**
   * XML文字列を解析し、DBに保存。
   * @param xmlString XML文字列
   * @param skipStations 既取得局IDのSet
   * @returns 保存された局IDのSet
   */
  public async parseAndSavePrograms(xmlString: string, skipStations: Set<string> = new Set()): Promise<Set<string>> {
    const doneStations = new Set<string>();

    try {
      const xmlData: RadikoXMLData = this.xmlParser.parse(xmlString);
      const stationRaw = xmlData?.radiko?.stations?.station ?? [];
      const stations: RadikoXMLStation[] = Array.isArray(stationRaw) ? stationRaw : [stationRaw];

      for (const s of stations) {
        const stationId = s['@id'];
        if (!stationId || skipStations.has(stationId)) continue;

        const progSetsRaw = s.progs ?? [];
        const progSets: any[] = Array.isArray(progSetsRaw) ? progSetsRaw : [progSetsRaw];

        for (const ps of progSets) {
          const progsRaw: RadikoXMLProg[] = ps.prog ?? [];
          const progs: RadikoXMLProg[] = Array.isArray(progsRaw) ? progsRaw : [progsRaw];

          let prevTo = '';

          for (const p of progs) {
            const ft = broadcastTimeConverter.convertRadioTime(p['@ft'], '05');
            const to = broadcastTimeConverter.convertRadioTime(p['@to'], '29');
            const progId = `${stationId}${p['@id']}${ft.slice(8, 12)}`;

            // 番組の隙間補完
            if (prevTo && prevTo < ft) {
              await this.dbUtil.insert({
                stationId,
                progId: `${stationId}_${prevTo}`,
                ft: prevTo,
                to: ft,
                title: '',
                info: '',
                pfm: '',
                img: ''
              });
            }

            const program: RadikoProgramData = {
              stationId,
              progId,
              ft,
              to,
              title: p.title,
              info: p.info ?? '',
              pfm: p.pfm ?? '',
              img: p.img ?? ''
            };

            await this.dbUtil.insert(program);
            prevTo = to;
          }

          // 29時まで補完
          if (prevTo.slice(8) < '290000') {
            await this.dbUtil.insert({
              stationId,
              progId: `${stationId}_${prevTo}`,
              ft: prevTo,
              to: `${prevTo.slice(0, 8)}290000`,
              title: '',
              info: '',
              pfm: '',
              img: ''
            });
          }
        }

        doneStations.add(stationId);
      }
    } catch (error) {
      // エラーを呼び出し元にスロー
      throw error;
    }

    return doneStations;
  }
}
