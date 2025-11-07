import { XMLParser } from 'fast-xml-parser';

// 定数のインポート
import { RADIKO_XML_PARSER_OPTIONS } from '@/constants/radiko-xml.constants';

// Modelのインポート
import { RadikoXMLData, RadikoXMLStation, RadikoXMLProg } from '@/models/radiko-xml-station.model';
import { RadikoProgramData } from '@/models/radiko-program.model';

// Utilsのインポート
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';
import { DBUtil } from '@/utils/db.util';

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
          const ft = broadcastTimeConverter.convertRadioTime(p['@ft'], '05');
          const to = broadcastTimeConverter.convertRadioTime(p['@to'], '29');
          // ft.slice(8, 12) で時刻部分（HHMM）を抽出し、progIdの一意性を確保
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
        if (Number(prevTo.slice(8)) < 290000) {
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

      // DBに並列で insert（順序保証不要の場合のみ推奨）
      await Promise.all(allProgs.map(prog => this.dbUtil.insert(prog)));

      // DB保存が完了した局IDを収集
      for (const prog of allProgs) {
        doneStations.add(prog.stationId);
      }

      return doneStations;
    } catch (error: any) {
      // エラーを呼び出し元にスロー
      throw error;
    }
  }
}