/**
 * Radiko Full XML Station Model
 * -------------------------------
 * XML からパースしたデータ構造の型定義
 */

/** 各ロゴ情報 */
export interface LogoInfo {
  // ロゴ幅
  width: number;
  // ロゴ高さ
  height: number;
  // ロゴ配置 (center, lrtrim など)
  align: string;
  // ロゴURL
  url: string;
}

/** 各放送局情報 */
export interface StationParsed {
  // 放送局ID (例: "802", "FMO")
  id: string;
  // 放送局名 (例: "FM802")
  name: string;
  // 英語表記 (例: "FM802")
  ascii_name: string;
  // ふりがな
  ruby?: string;
  // エリアフリー対応 (0 or 1)
  areafree: number;
  // タイムフリー対応 (0 or 1)
  timefree: number;
  // ロゴ配列
  logos: LogoInfo[];
  // バナーURL
  banner: string;
  // エリアID (例: "JP27")
  area_id: string;
  // 放送局WebページURL
  href?: string;
  // タイムフリー最大遅延
  tf_max_delay?: number;
  // 同時再生最大遅延
  simul_max_delay?: number;
}

/** 地域情報とその局リスト */
export interface RegionDataParsed {
  // 地域名 (例: "関西")
  region_name: string;
  // 地域ID (例: "Kansai")
  region_id: string;
  // 地域英語表記
  ascii_name: string;
  // この地域に属する局リスト
  stations: StationParsed[];
}
