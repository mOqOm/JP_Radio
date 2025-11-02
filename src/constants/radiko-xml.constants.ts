/**
 * Radiko XML パーサ設定
 * fast-xml-parser 用
 */
export const RADIKO_XML_PARSER_OPTIONS = {
  // XML属性は @ でプレフィックス
  attributeNamePrefix: '@',
  // 属性もオブジェクトに含める
  ignoreAttributes: false,
  // boolean属性も許可
  allowBooleanAttributes: true,
  // 名前空間のプレフィックスを削除（xmlnsなどを無視）
  removeNSPrefix: true,
};

/**
 * Radiko XML 内のフィールド定義
 * XML -> RadikoProgramData へのマッピングに使用
 */
export const RADIKO_XML_FIELDS = {
  // 局ID
  stationId: '@id',
  // 番組リスト
  progs: 'progs',
  // 番組情報
  prog: 'prog',
  // 開始時刻
  from: '@ft',
  // 終了時刻
  to: '@to',
  // 番組タイトル
  title: 'title',
  // 番組詳細
  info: 'info',
  // パーソナリティ
  pfm: 'pfm',
  // 画像URL
  img: 'img',
};
