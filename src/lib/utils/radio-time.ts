import { format } from 'date-fns-tz';

/** Radikoの番組表・配信はJST基準のため、サーバのシステムタイムゾーンによらずJSTで統一する。 */
const TIME_ZONE = 'Asia/Tokyo';

/**
 * Radikoのライブ配信遅延(実測、約20s)。ラジオ時間の算出時にこの分だけ巻き戻す。
 */
export const DELAY_SEC = 20;
const DELAY_MSEC = DELAY_SEC * 1000;

/** ラジオの一日の開始時刻(05:00)。この時刻を境に「ラジオ日付」が切り替わる。 */
const RADIO_DAY_START_MSEC = 5 * 3600 * 1000;

/**
 * 実時間の今日の日付を`yyyyMMdd`形式で返す。
 */
export function getCurrentDate(): string {
  return format(new Date(), 'yyyyMMdd', { timeZone: TIME_ZONE });
}

/**
 * ラジオの一日は「05:00～29:00」として扱われるため、実時間ではなく
 * `cnvRadioTime`で補正した「ラジオ時間」での現在時刻を`yyyyMMddHHmmss`形式で返す。
 * 配信遅延分(`DELAY_SEC`)を差し引いた時刻を基準にする。
 */
export function getCurrentRadioTime(): string {
  const adjustedNow = Date.now() - DELAY_MSEC;
  const src = format(adjustedNow, 'yyyyMMddHHmmss', { timeZone: TIME_ZONE });
  const today = format(adjustedNow - RADIO_DAY_START_MSEC, 'yyyyMMdd', { timeZone: TIME_ZONE });
  return cnvRadioTime(src, today);
}

/**
 * 深夜0:00～5:00は前日として扱う「ラジオ日付」を`yyyyMMdd`形式で返す。
 */
export function getCurrentRadioDate(): string {
  return format(Date.now() - DELAY_MSEC - RADIO_DAY_START_MSEC, 'yyyyMMdd', { timeZone: TIME_ZONE });
}

/**
 * `'yyyyMMddHHmmss'`形式の文字列を意味のある要素に分解したもの。
 */
export interface RadioTimeParts {
  /**
   * yyyyMMdd
   */
  date: string;
  /**
   * HH（深夜番組は24～29になりうる）
   */
  hour: string;
  /**
   * mm
   */
  minute: string;
  /**
   * ss
   */
  second: string;
}

/**
 * `'yyyyMMddHHmmss'`形式の文字列を{@link RadioTimeParts}に分解する。
 */
export function parseRadioTime(t: string): RadioTimeParts {
  return {
    date: t.slice(0, 8),
    hour: t.slice(8, 10),
    minute: t.slice(10, 12),
    second: t.slice(12, 14),
  };
}

/**
 * 実時間の日時文字列をラジオ時間に変換する。深夜0:00～5:00の番組は日付を変えず`24:00～29:00`表記にする。
 * @param src 変換対象の`'yyyyMMddHHmmss'`形式の日時文字列。
 * @param today 基準となる「ラジオ日付」(`yyyyMMdd`)。srcの日付がこれと異なる場合、深夜番組とみなす。
 */
export function cnvRadioTime(src: string, today: string): string {
  const parts = parseRadioTime(src);
  const todayDate = today.slice(0, 8);
  let hour = parts.hour;
  let date = parts.date;
  if (date !== todayDate) {
    hour = String(parseInt(hour) + 24);
    date = todayDate;
  }
  return date + hour + parts.minute + parts.second;
}

/**
 * `'yyyyMMddHHmmss'` => `'HH:mm:ss'`
 */
export function formatTimeString(t: string): string {
  const { hour, minute, second } = parseRadioTime(t);
  return `${hour}:${minute}:${second}`;
}

/**
 * `'yyyyMMddHHmmss'` => `'HH:mm'`（表示用に秒を省略）
 */
export function formatHourMinute(t: string): string {
  const { hour, minute } = parseRadioTime(t);
  return `${hour}:${minute}`;
}

/**
 * `'yyyyMMddHHmmss'` => `'yyyyMMddHHmm'`（分単位、DBの範囲検索に使う）
 */
export function toMinutePrecision(t: string): string {
  const { date, hour, minute } = parseRadioTime(t);
  return date + hour + minute;
}

/** `'HH:mm:ss'`(または`'HH:mm'`)形式の時刻を秒単位に変換する。 */
function toSeconds(t: string): number {
  const [hour, minute, second = '0'] = t.split(':');
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

/**
 * `'HH:mm:ss'`(または`'HH:mm'`)形式の2つの時刻の差を秒単位で返す(`end - begin`)。
 */
export function getTimeSpan(begin: string, end: string): number {
  return toSeconds(end) - toSeconds(begin);
}
