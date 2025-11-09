import { XMLParser } from 'fast-xml-parser';

// 定数のインポート
import { RADIKO_XML_PARSER_OPTIONS } from '../constants/radiko-xml.constants';

// Modelのインポート
import { RadikoXMLData, RadikoXMLStation, RadikoXMLProg } from '../models/radiko-xml-station.model';
import { RadikoProgramData } from '../models/radiko-program.model';

// Utilsのインポート
import { broadcastTimeConverter } from './broadcast-time-converter.util';

export class RadikoXmlUtil {
  private readonly xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser(RADIKO_XML_PARSER_OPTIONS);
  }

  /**
   * XML文字列を解析し、RadikoProgramDataの配列を返す
   * @param xmlString XML文字列
   * @param skipStations 既取得局IDのSet
   * @returns RadikoProgramDataの配列
   */
  public parsePrograms(xmlString: string, skipStations: Set<string> = new Set()): RadikoProgramData[] {
    try {
      const xmlData: RadikoXMLData = this.xmlParser.parse(xmlString);

      if (!xmlData?.radiko) {
        // RadikoのXMLの形式でなければエラーとする
        throw new Error('Invalid XML format: radiko root not found');
      }

      const stationRaw = xmlData.radiko.stations?.station ?? [];
      const stations: RadikoXMLStation[] = Array.isArray(stationRaw) ? stationRaw : [stationRaw];

      // 全プログラムを ft順に格納
      const allProgs: RadikoProgramData[] = [];

      for (const s of stations) {
        const stationId = s['@id'];

        if (!stationId || skipStations.has(stationId)) {
          continue;
        }

        const progSetsRaw = s.progs ?? [];
        const progSets: any[] = Array.isArray(progSetsRaw) ? progSetsRaw : [progSetsRaw];

        // まず元番組を flat にして sorted に
        let rawProgs: RadikoXMLProg[] = [];
        for (const ps of progSets) {
          const progsRaw: RadikoXMLProg[] = ps.prog ?? [];
          rawProgs = rawProgs.concat(Array.isArray(progsRaw) ? progsRaw : [progsRaw]);
        }

        rawProgs.sort((a, b) => a['@ft'].localeCompare(b['@ft']));

        let prevTo = '';

        for (const p of rawProgs) {
          // 第2引数を削除
          const ft = broadcastTimeConverter.convertRadioTime(p['@ft']);
          const to = broadcastTimeConverter.convertRadioTime(p['@to']);

          const progId = `${stationId}${p['@id']}${ft.slice(8, 12)}`;

          // ギャップ補完
          if (prevTo && prevTo < ft) {
            allProgs.push({
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

          allProgs.push({
            stationId,
            progId,
            ft,
            to,
            title: p.title,
            info: p.info ?? '',
            pfm: p.pfm ?? '',
            img: p.img ?? ''
          });

          prevTo = to;
        }

        // 最終29時まで補完
        if (prevTo && Number(prevTo.slice(8, 12)) < 2900) {
          allProgs.push({
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
      return allProgs;
    } catch (error: any) {
      // エラーを呼び出し元にスロー
      throw error;
    }
  }
}
