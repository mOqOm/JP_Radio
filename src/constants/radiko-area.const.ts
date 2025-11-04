export interface RadikoAreaGroup {
  name: string;
  prefectures: Record<string, string>;
}

export const RADIKO_AREA: Record<string, RadikoAreaGroup> = {
  REGION1: {
    name: "≪ 北海道・東北 ≫",
    prefectures: {
      JP1: "北海道",
      JP2: "青森",
      JP3: "岩手",
      JP4: "宮城",
      JP5: "秋田",
      JP6: "山形",
      JP7: "福島",
    },
  },
  REGION2: {
    name: "≪ 関東 ≫",
    prefectures: {
      JP8: "茨城",
      JP9: "栃木",
      JP10: "群馬",
      JP11: "埼玉",
      JP12: "千葉",
      JP13: "東京",
      JP14: "神奈川",
    },
  },
  REGION3: {
    name: "≪ 北陸・甲信越 ≫",
    prefectures: {
      JP15: "新潟",
      JP16: "富山",
      JP17: "石川",
      JP18: "福井",
      JP19: "山梨",
      JP20: "長野",
    },
  },
  REGION4: {
    name: "≪ 中部 ≫",
    prefectures: {
      JP21: "岐阜",
      JP22: "静岡",
      JP23: "愛知",
      JP24: "三重",
    },
  },
  REGION5: {
    name: "≪ 近畿 ≫",
    prefectures: {
      JP25: "滋賀",
      JP26: "京都",
      JP27: "大阪",
      JP28: "兵庫",
      JP29: "奈良",
      JP30: "和歌山",
    },
  },
  REGION6: {
    name: "≪ 中国・四国 ≫",
    prefectures: {
      JP31: "鳥取",
      JP32: "島根",
      JP33: "岡山",
      JP34: "広島",
      JP35: "山口",
      JP36: "徳島",
      JP37: "香川",
      JP38: "愛媛",
      JP39: "高知",
    },
  },
  REGION7: {
    name: "≪ 九州・沖縄 ≫",
    prefectures: {
      JP40: "福岡",
      JP41: "佐賀",
      JP42: "長崎",
      JP43: "熊本",
      JP44: "大分",
      JP45: "宮崎",
      JP46: "鹿児島",
      JP47: "沖縄",
    },
  },
} as const;

// --- Types ---
export type RegionKey = keyof typeof RADIKO_AREA;
export type PrefKey = keyof typeof RADIKO_AREA[RegionKey]["prefectures"];
export type PrefName = typeof RADIKO_AREA[RegionKey]["prefectures"][PrefKey];
