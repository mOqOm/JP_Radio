/**
 * JP Radio 動作時の設定パラメータ
 * Controller で生成し Service(JpRadio) に受け渡す不変構造
 */
export interface JpRadioConfig {
  /** HTTP サービス待受ポート */
  port: number;
  /** ネットワーク遅延補正秒 */
  delay: number;
  /** アルバムアート取得方式 */
  aaType: string;
  /** 番組取得対象期間 (過去, 日数) */
  ppFrom: number;
  /** 番組取得対象期間 (未来, 日数) */
  ppTo: number;
  /** 番組表示用 時刻フォーマット (含: from-to) */
  timeFmt: string;
  /** 番組表示用 日付フォーマット (timeFmt から時刻部分を除去した派生) */
  dateFmt: string;
  /** 利用するエリアID一覧 */
  areaIdArray: string[];
}

export const DEFAULT_JP_RADIO_CONFIG: JpRadioConfig = {
  port: 9000,
  delay: 20,
  aaType: 'type3',
  ppFrom: 7,
  ppTo: 7,
  timeFmt: 'YYYY-MM-DD HH:mm',
  dateFmt: 'YYYY-MM-DD',
  areaIdArray: []
};
