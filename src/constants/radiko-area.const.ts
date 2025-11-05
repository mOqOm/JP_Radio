// 都道府県情報
export interface PrefectureInfo {
  kanji: string;
  romaji: string;
}

// 地域グループ
export interface RadikoAreaGroup {
  name: string;
  prefectures: Record<string, PrefectureInfo>;
}

// radikoエリア定義
export const RADIKO_AREA: Record<string, RadikoAreaGroup> = {
  REGION1: {
    name: "≪ 北海道・東北 ≫",
    prefectures: {
      JP1: { kanji: "北海道", romaji: "HOKKAIDO" },
      JP2: { kanji: "青森", romaji: "AOMORI" },
      JP3: { kanji: "岩手", romaji: "IWATE" },
      JP4: { kanji: "宮城", romaji: "MIYAGI" },
      JP5: { kanji: "秋田", romaji: "AKITA" },
      JP6: { kanji: "山形", romaji: "YAMAGATA" },
      JP7: { kanji: "福島", romaji: "FUKUSHIMA" },
    },
  },
  REGION2: {
    name: "≪ 関東 ≫",
    prefectures: {
      JP8: { kanji: "茨城", romaji: "IBARAKI" },
      JP9: { kanji: "栃木", romaji: "TOCHIGI" },
      JP10: { kanji: "群馬", romaji: "GUNMA" },
      JP11: { kanji: "埼玉", romaji: "SAITAMA" },
      JP12: { kanji: "千葉", romaji: "CHIBA" },
      JP13: { kanji: "東京", romaji: "TOKYO" },
      JP14: { kanji: "神奈川", romaji: "KANAGAWA" },
    },
  },
  REGION3: {
    name: "≪ 北陸・甲信越 ≫",
    prefectures: {
      JP15: { kanji: "新潟", romaji: "NIIGATA" },
      JP16: { kanji: "富山", romaji: "TOYAMA" },
      JP17: { kanji: "石川", romaji: "ISHIKAWA" },
      JP18: { kanji: "福井", romaji: "FUKUI" },
      JP19: { kanji: "山梨", romaji: "YAMANASHI" },
      JP20: { kanji: "長野", romaji: "NAGANO" },
    },
  },
  REGION4: {
    name: "≪ 中部 ≫",
    prefectures: {
      JP21: { kanji: "岐阜", romaji: "GIFU" },
      JP22: { kanji: "静岡", romaji: "SHIZUOKA" },
      JP23: { kanji: "愛知", romaji: "AICHI" },
      JP24: { kanji: "三重", romaji: "MIE" },
    },
  },
  REGION5: {
    name: "≪ 近畿 ≫",
    prefectures: {
      JP25: { kanji: "滋賀", romaji: "SHIGA" },
      JP26: { kanji: "京都", romaji: "KYOTO" },
      JP27: { kanji: "大阪", romaji: "OSAKA" },
      JP28: { kanji: "兵庫", romaji: "HYOGO" },
      JP29: { kanji: "奈良", romaji: "NARA" },
      JP30: { kanji: "和歌山", romaji: "WAKAYAMA" },
    },
  },
  REGION6: {
    name: "≪ 中国・四国 ≫",
    prefectures: {
      JP31: { kanji: "鳥取", romaji: "TOTTORI" },
      JP32: { kanji: "島根", romaji: "SHIMANE" },
      JP33: { kanji: "岡山", romaji: "OKAYAMA" },
      JP34: { kanji: "広島", romaji: "HIROSHIMA" },
      JP35: { kanji: "山口", romaji: "YAMAGUCHI" },
      JP36: { kanji: "徳島", romaji: "TOKUSHIMA" },
      JP37: { kanji: "香川", romaji: "KAGAWA" },
      JP38: { kanji: "愛媛", romaji: "EHIME" },
      JP39: { kanji: "高知", romaji: "KOCHI" },
    },
  },
  REGION7: {
    name: "≪ 九州・沖縄 ≫",
    prefectures: {
      JP40: { kanji: "福岡", romaji: "FUKUOKA" },
      JP41: { kanji: "佐賀", romaji: "SAGA" },
      JP42: { kanji: "長崎", romaji: "NAGASAKI" },
      JP43: { kanji: "熊本", romaji: "KUMAMOTO" },
      JP44: { kanji: "大分", romaji: "OITA" },
      JP45: { kanji: "宮崎", romaji: "MIYAZAKI" },
      JP46: { kanji: "鹿児島", romaji: "KAGOSHIMA" },
      JP47: { kanji: "沖縄", romaji: "OKINAWA" },
    },
  },
} as const;

// --- Types ---
export type RegionKey = keyof typeof RADIKO_AREA;
export type PrefKey = keyof typeof RADIKO_AREA[RegionKey]["prefectures"];
export type PrefInfo = typeof RADIKO_AREA[RegionKey]["prefectures"][PrefKey];
