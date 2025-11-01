/**
 * Radiko XML 全体データ型
 */
export interface RadikoXMLData {
  radiko: {
    stations: {
      station: RadikoXMLStation[];
    };
  };
}

/**
 * Radiko XML 内の局情報型
 */
export interface RadikoXMLStation {
  '@id': string;  // 局ID
  progs: RadikoXMLProgSet[]; // 番組セット
}

/**
 * 番組セット（日付ごと）
 */
export interface RadikoXMLProgSet {
  date: string;           // 日付
  prog: RadikoXMLProg[];  // 番組リスト
}

/**
 * 番組情報
 */
export interface RadikoXMLProg {
  '@id': string;    // 番組ID
  '@ft': string;    // 開始時刻
  '@to': string;    // 終了時刻
  title: string;    // タイトル
  info: string;     // 番組詳細
  pfm: string;      // パーソナリティ
  img: string;      // 画像URL
}
