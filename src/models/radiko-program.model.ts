import { DateTime } from "@/types/date-time.types";

export interface RadikoProgramData {
  /** 放送局ID */
  stationId: string;
  /** 番組ID */
  progId: string;
  /** 開始日時(UTC) */
  ft: DateTime;
  /** 終了日時(UTC) */
  to: DateTime;
  /** 再生時間(秒) */
  dur: number;
  /** 番組タイトル */
  title: string;
  /** パーソナリティ */
  pfm?: string;
  /** 番組情報 */
  info?: string;
  /** 画像URL */
  img?: string | null;
}