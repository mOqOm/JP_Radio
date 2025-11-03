import { XMLParser } from 'fast-xml-parser';

// 定数のインポート
import { RADIKO_XML_PARSER_OPTIONS } from '@/constants/radiko-xml.constants';

// Modelのインポート
import { RegionDataParsed, StationParsed, LogoInfo } from '@/models/radiko-xml-full-station.model';

/**
 * Radiko XML パーサ設定
 */
const xmlParser = new XMLParser(RADIKO_XML_PARSER_OPTIONS);

/**
 * フル局XML文字列を RegionDataParsed[] に変換
 * @param xml XML文字列
 */
export function parseFullStationXML(xml: string): RegionDataParsed[] {
  const parsed = xmlParser.parse(xml);

  // region単位に変換
  const regions: RegionDataParsed[] = parsed.region.stations.map((region: any) => {
    const stations: StationParsed[] = region.station.map((s: any) => {
      // logo は配列で複数ある場合があるため統一
      const logos: LogoInfo[] = Array.isArray(s.logo)
        ? s.logo.map((l: any) => ({
            width: Number(l['@width']),
            height: Number(l['@height']),
            align: l['@align'],
            url: l['#text'],
          }))
        : [{
            width: Number(s.logo['@width']),
            height: Number(s.logo['@height']),
            align: s.logo['@align'],
            url: s.logo['#text'],
          }];

      return {
        id: String(s.id),
        name: s.name,
        ascii_name: s.ascii_name,
        ruby: s.ruby,
        areafree: Number(s.areafree),
        timefree: Number(s.timefree),
        logos,
        banner: s.banner,
        area_id: s.area_id,
        href: s.href,
        tf_max_delay: s.tf_max_delay ? Number(s.tf_max_delay) : undefined,
        simul_max_delay: s.simul_max_delay ? Number(s.simul_max_delay) : undefined,
      };
    });

    return {
      region_name: region['@region_name'],
      region_id: region['@region_id'],
      ascii_name: region['@ascii_name'],
      stations,
    };
  });

  return regions;
}
