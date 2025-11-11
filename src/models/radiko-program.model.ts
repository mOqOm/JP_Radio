import { DateTime } from "@/types/date-time.types";

export interface RadikoProgramData {
  stationId: string;
  progId: string;
  ft: DateTime;
  to: DateTime;
  title: string;
  info?: string;
  pfm?: string;
  img?: string;
}
