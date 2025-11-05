import { RADIKO_AREA, RegionKey, PrefKey } from "@/constants/radiko-area.const";

/**
 * console.log(getPrefKanji("JP27")); // 大阪
 * console.log(getPrefRomaji("JP27")); // OSAKA
 * console.log(getRegionByPref("JP27")); // ≪ 近畿 ≫
 * console.log(getJPListByRegion("REGION2")); // ["JP8"... "JP14"]
 * console.log(getJPByKanji("大阪")); // JP27
 * console.log(getJPByRomaji("OSAKA")); // JP27
 */


// --- JP → 表記（kanji or romaji） ---
export const getPrefKanji = (jp: PrefKey): string | undefined => {
  for (const region of Object.values(RADIKO_AREA)) {
    if (jp in region.prefectures) {
      return region.prefectures[jp].kanji;
    }
  }
};

export const getPrefRomaji = (jp: PrefKey): string | undefined => {
  for (const region of Object.values(RADIKO_AREA)) {
    if (jp in region.prefectures) {
      return region.prefectures[jp].romaji;
    }
  }
};

// --- JP → 地域名 ---
export const getRegionByPref = (jp: PrefKey): string => {
  for (const region of Object.values(RADIKO_AREA)) {
    if (jp in region.prefectures) {
      return region.name;
    }
  }
  return '';
};

// --- REGION → JPリスト ---
export const getJPListByRegion = (region: RegionKey): PrefKey[] => {
  return Object.keys(RADIKO_AREA[region].prefectures) as PrefKey[];
};

// --- 表記（kanji or romaji）→ JP ---
export const getJPByKanji = (kanji: string): PrefKey | undefined => {
  for (const region of Object.values(RADIKO_AREA)) {
    const entry = Object.entries(region.prefectures)
      .find(([, info]) => info.kanji === kanji);
    if (entry) return entry[0] as PrefKey;
  }
};

export const getJPByRomaji = (romaji: string): PrefKey | undefined => {
  const target = romaji.toUpperCase();
  for (const region of Object.values(RADIKO_AREA)) {
    const entry = Object.entries(region.prefectures)
      .find(([, info]) => info.romaji === target);
    if (entry) return entry[0] as PrefKey;
  }
};
