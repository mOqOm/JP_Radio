export interface RadikoMyInfo {
  /** JPXX （例: JP13） */
  areaId: string;

  /** エリアフリー: 0 =不可, 1 =可 */
  areafree: string; // API上 文字列なので stringにする

  /** 会員種別: 'free' | 'premium' など */
  member_type: string;

  /** 受信可能局数 */
  cntStations: number;
}
