/**
 * Radiko XML パーサ設定
 * fast-xml-parser 用
 */
export const RADIKO_XML_PARSER_OPTIONS = {
  attributeNamePrefix: '@',   // XML属性は @ でプレフィックス
  ignoreAttributes: false,    // 属性もオブジェクトに含める
  allowBooleanAttributes: true, // boolean属性も許可
};

/**
 * Radiko XML 内のフィールド定義
 * XML -> RadikoProgramData へのマッピングに使用
 */
export const RADIKO_XML_FIELDS = {
  stationId: '@id',  // 局ID
  progs: 'progs',    // 番組リスト
  prog: 'prog',      // 番組情報
  from: '@ft',       // 開始時刻
  to: '@to',         // 終了時刻
  title: 'title',    // 番組タイトル
  info: 'info',      // 番組詳細
  pfm: 'pfm',        // パーソナリティ
  img: 'img',        // 画像URL
};
