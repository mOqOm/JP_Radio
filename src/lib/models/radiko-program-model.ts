/**
 * DB(RdkProg)に保存する番組1件分のデータ。
 */
export interface RadikoProgramData {
  // 局ID(例: 'TBS')
  station: string;
  // 局IDと番組IDを連結した一意なキー
  id: string;
  // 放送開始時刻(ラジオ時間、`'yyyyMMddHHmmss'`)
  ft: string;
  // 放送終了時刻(ラジオ時間、`'yyyyMMddHHmmss'`)
  tt: string;
  // 番組タイトル
  title: string;
  // パーソナリティ名
  pfm: string;
  // 番組画像URL
  img: string;
  // 番組詳細情報(HTML)。番組情報モーダルでのみ使う(Browse一覧等の軽量なメタ情報には含めない)
  info: string;
}
