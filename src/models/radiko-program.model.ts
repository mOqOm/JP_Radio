import { DateTime } from "@/types/date-time.types";

export interface RadikoProgramData {
  stationId: string;
  progId: string;
  /** 開始日時(UTC) */
  ft: DateTime;
  /** 終了日時(UTC) */
  to: DateTime;
  title: string;
  info?: string;
  pfm?: string;
  img?: string;
}
