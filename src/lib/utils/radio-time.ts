import { format } from 'date-fns-tz';
import { parse, addDays, addSeconds, format as formatDate } from 'date-fns';

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
 * @param t 分解対象の`'yyyyMMddHHmmss'`形式の文字列。
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
 * {@link cnvRadioTime}の逆変換。`24:00`～`29:00`表記を翌日の`00:00`～`05:00`の実時刻表記に戻す。
 * Radiko APIのタイムフリー再生パラメータ(`start_at`/`ft`/`end_at`/`to`)は実時刻表記を要求するため使う。
 * @param src 変換対象の`'yyyyMMddHHmmss'`形式の文字列(ラジオ時間表記)。
 */
export function revCnvRadioTime(src: string): string {
  const parts = parseRadioTime(src);
  const hourNum = Number(parts.hour);
  if (hourNum < 24) {
    return src;
  }
  const baseDate = parse(parts.date, 'yyyyMMdd', new Date());
  const nextDate = formatDate(addDays(baseDate, 1), 'yyyyMMdd');
  const hour = String(hourNum - 24).padStart(2, '0');
  return nextDate + hour + parts.minute + parts.second;
}

/**
 * `'yyyyMMddHHmmss'`形式の実時刻文字列にN秒を加算する。タイムフリー再生の途中再開位置
 * (`revCnvRadioTime`で実時刻に戻した`ft` + 経過秒)を計算するために使う。
 * @param src 加算対象の`'yyyyMMddHHmmss'`形式の実時刻文字列。
 * @param seconds 加算する秒数。
 */
export function addSecondsToTimeString(src: string, seconds: number): string {
  const date = parse(src, 'yyyyMMddHHmmss', new Date());
  return formatDate(addSeconds(date, seconds), 'yyyyMMddHHmmss');
}

/**
 * `'yyyyMMddHHmmss'` => `'HH:mm:ss'`
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export function formatTimeString(t: string): string {
  const { hour, minute, second } = parseRadioTime(t);
  return `${hour}:${minute}:${second}`;
}

/**
 * `'yyyyMMddHHmmss'` => `'HH:mm'`（表示用に秒を省略）
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export function formatHourMinute(t: string): string {
  const { hour, minute } = parseRadioTime(t);
  return `${hour}:${minute}`;
}

/**
 * `'yyyyMMddHHmmss'` => `'yyyyMMddHHmm'`（分単位、DBの範囲検索に使う）
 * @param t 変換対象の`'yyyyMMddHHmmss'`形式の文字列。
 */
export function toMinutePrecision(t: string): string {
  const { date, hour, minute } = parseRadioTime(t);
  return date + hour + minute;
}

/**
 * `'HH:mm:ss'`(または`'HH:mm'`)形式の時刻を秒単位に変換する。
 * @param t 変換対象の時刻文字列。
 */
function toSeconds(t: string): number {
  const [hour, minute, second = '0'] = t.split(':');
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

/**
 * `'HH:mm:ss'`(または`'HH:mm'`)形式の2つの時刻の差を秒単位で返す(`end - begin`)。
 * @param begin 開始時刻。
 * @param end 終了時刻。
 */
export function getTimeSpan(begin: string, end: string): number {
  return toSeconds(end) - toSeconds(begin);
}

/**
 * 番組がタイムフリーで再生可能(=既に放送開始済み)かどうかを判定する。
 * `ft`/`currentRadioTime`はどちらも{@link cnvRadioTime}で正規化された`'yyyyMMddHHmmss'`文字列
 * (日付+時刻が矛盾なく連動している)なので、単純な文字列比較で時系列の前後関係を判定できる。
 * 「タイムフリーとして古すぎないか(7日以内か)」は、番組データの取得元である
 * `PROG_WEEKLY_STATION_URL`自体が前後1週間分しか返さないため、ここでは判定しない。
 * @param ft 判定対象の番組の放送開始時刻。
 * @param currentRadioTime 現在時刻(`getCurrentRadioTime`の戻り値)。
 */
export function isWithinTimeFreeWindow(ft: string, currentRadioTime: string): boolean {
  return ft <= currentRadioTime;
}
