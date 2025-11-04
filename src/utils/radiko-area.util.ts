import { RADIKO_AREA, RegionKey, PrefKey, PrefName } from "@/constants/radiko-area.const";

/**
 * console.log(getPrefName("JP14")); // 神奈川
 * console.log(getRegionByPref("JP14")); // ≪ 関東 ≫
 * console.log(getJPListByRegion("REGION2")); // ["JP8"... "JP14"]
 * console.log(getJPByPrefName("大阪")); // JP27
 */


// JPコード → 都道府県名
export const getPrefName = (jp: PrefKey): PrefName | undefined => {
  for (const region of Object.values(RADIKO_AREA)) {
    if (jp in region.prefectures) {
      return region.prefectures[jp as PrefKey];
    }
  }
};

// JPコード → 地域名
export const getRegionByPref = (jp: PrefKey): string => {
  for (const region of Object.values(RADIKO_AREA)) {
    if (jp in region.prefectures) {
      return region.name;
    }
  }
  return '';
};

// REGION → JPリスト
export const getJPListByRegion = (region: RegionKey): PrefKey[] => {
  return Object.keys(RADIKO_AREA[region].prefectures) as PrefKey[];
};

// 都道府県名 → JPコード（逆引き）
export const getJPByPrefName = (name: PrefName): PrefKey | undefined => {
  for (const region of Object.values(RADIKO_AREA)) {
    const entry = Object.entries(region.prefectures).find(([, n]) => n === name);
    if (entry) {
      return entry[0] as PrefKey;
    }
  }
};
