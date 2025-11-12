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
  // 局ID
  '@id': string;
  // 番組セット
  progs: RadikoXMLProgSet[];
}

/**
 * 番組セット（日付ごと）
 */
export interface RadikoXMLProgSet {
  // 日付
  date: string;
  // 番組リスト
  prog: RadikoXMLProg[];
}

/**
 * 番組情報
 */
export interface RadikoXMLProg {
  // 番組ID
  '@id': string;
  // 開始時刻(yyyyMMddHHmmss 形式)
  '@ft': string;
  // 終了時刻(yyyyMMddHHmmss 形式)
  '@to': string;
  // 再生時間(秒)
  '@dur': string;
  // タイトル
  title: string;
  // 番組詳細
  info: string;
  // パーソナリティ
  pfm: string;
  // 画像URL
  img: string;
}
