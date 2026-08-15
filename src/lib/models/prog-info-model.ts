/**
 * 番組情報モーダルの表示・キュー追加に使うデータ。`explodeUri`の返却値と同じ形にすることで、
 * モーダルの「再生」「キューに追加」ボタンからそのままVolumioの再生キューへ渡せるようにする。
 */
export interface ProgInfoData {
  service: string;
  type: string;
  title: string;
  name: string;
  album: string;
  artist: string;
  albumart: string;
  uri: string;
  // 番組詳細情報(HTML、無ければ空文字列)。番組情報モーダルの表示にのみ使う。
  info: string;
}
