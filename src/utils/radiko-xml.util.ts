import { XMLParser } from 'fast-xml-parser';

// 定数のインポート
import { RADIKO_XML_PARSER_OPTIONS } from '../constants/radiko-xml.constants';

// Modelのインポート
import { RadikoXMLData, RadikoXMLStation, RadikoXMLProg, RadikoXMLProgSet } from '../models/radiko-xml-station.model';
import { RadikoProgramData } from '../models/radiko-program.model';

import type { DateOnly, DateTime, DateTimeString } from '@/types/date-time.types';

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
      const radikoXMLStationArray: RadikoXMLStation[] = Array.isArray(stationRaw) ? stationRaw : [stationRaw];

      // 全番組表を格納する配列(ft/to は DateTime型 で管理)
      const allRadikoProgramData: RadikoProgramData[] = [];

      for (const radikoXMLStation of radikoXMLStationArray) {
        // 放送局ID取得
        const stationId: string = radikoXMLStation['@id'];

        // スキップ対象の局IDは処理しない
        if (stationId === undefined || stationId === null || stationId === '' || skipStations.has(stationId)) {
          continue;
        }

        // 番組セットが存在する場合のみ処理
        if (radikoXMLStation.progs !== undefined && radikoXMLStation.progs !== null) {

          // 配列でない場合は配列に変換
          const progSetsRaw = radikoXMLStation.progs;
          const progSetsArray: RadikoXMLProgSet[] = Array.isArray(progSetsRaw) ? progSetsRaw : [progSetsRaw];

          for (const progSets of progSetsArray) {
            if (progSets.prog !== undefined && progSets.prog !== null) {
              // 配列でない場合は配列に変換
              const progRaw = progSets.prog;
              const radikoXMLProgArray: RadikoXMLProg[] = Array.isArray(progRaw) ? progRaw : [progRaw];

              for (const radikoXMLProg of radikoXMLProgArray) {

                // ft/to は yyyyMMddHHmmss 形式の文字列のため DateTime に変換
                const ftDateTime: DateTime = broadcastTimeConverter.convertRadioDateTime(String(radikoXMLProg['@ft']) as DateTimeString);
                const toDateTime: DateTime = broadcastTimeConverter.convertRadioDateTime(String(radikoXMLProg['@to']) as DateTimeString);

                // DateTime からHHmm形式の時間文字列を取得
                const time: string = broadcastTimeConverter.revConvertRadioTime(ftDateTime);
                const progId: string = `${stationId}${radikoXMLProg['@id']}${time}`;

                const radikoProgramData: RadikoProgramData = {
                  // 番組情報
                  stationId: stationId,
                  // 番組IDは局ID＋番組ID＋開始時間(HHmm形式)
                  progId: progId,
                  // 開始日時
                  ft: ftDateTime,
                  // 終了日時
                  to: toDateTime,
                  // 番組タイトル
                  title: radikoXMLProg.title,
                  // 番組情報
                  info: radikoXMLProg.info ?? '',
                  // パーソナリティ
                  pfm: radikoXMLProg.pfm ?? '',
                  // 画像URL
                  img: radikoXMLProg.img ?? ''
                };
                allRadikoProgramData.push(radikoProgramData);
              }
            }
          }
        }
      }
      return allRadikoProgramData;
    } catch (error: any) {
      // エラーを呼び出し元にスロー
      throw error;
    }
  }
}
