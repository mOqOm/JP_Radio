/**
 * 日付・時刻の型定義
 * - ブランド型を使用して、通常の Date と区別
 */

/** yyyyMMdd 形式（文字列） */
export type DateString = string & { readonly __brand: 'DateString' };

/**
 * yyyyMMddHHmmss 形式（文字列）
 * 不足分は末尾を0で埋める
 * 例: "2024010112" -> "20240101120000"
 * 24時間以上の時刻もそのまま受け入れる
 */
export type DateTimeString = string & { readonly __brand: 'DateTimeString' };

/** yyyyMMddHHmmssSSS 形式（文字列） */
export type DateTimeMsString = string & { readonly __brand: 'DateTimeMsString' };

/**
 * Date オブジェクト（日付のみ、時刻は 00:00:00.000）
 */
export type DateOnly = Date & { readonly __brand: 'DateOnly' };

/** Date オブジェクト（日付と時刻） */
export type DateTime = Date & { readonly __brand: 'DateTime' };

/**
 * 通常の string を DateString に変換（型チェック付き）
 */
export function toDateString(value: string): DateString {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Invalid DateString format: ${value} (expected: yyyyMMdd)`);
  }
  return value as DateString;
}

/**
 * 通常の string を DateTimeString に変換（型チェック付き）
 * 不足分は末尾を0で埋める
 * 例: "2024010112" -> "20240101120000"
 * 24時間以上の時刻もそのまま受け入れる
 */
export function toDateTimeString(value: string): DateTimeString {
  const padded = value.padEnd(14, '0');
  if (!/^\d{14}$/.test(padded)) {
    throw new Error(`Invalid DateTimeString format: ${value} (expected: yyyyMMddHHmmss)`);
  }
  return padded as DateTimeString;
}

/**
 * 通常の string を DateTimeMsString に変換（型チェック付き）
 */
export function toDateTimeMsString(value: string): DateTimeMsString {
  const padded = value.padEnd(17, '0');
  if (!/^\d{17}$/.test(padded)) {
    throw new Error(`Invalid DateTimeMsString format: ${value} (expected: yyyyMMddHHmmssSSS)`);
  }
  return padded as DateTimeMsString;
}

/**
 * Date オブジェクトから DateOnly を作成
 * 時刻は 00:00:00.000 に正規化
 */
export function toDateOnly(date: Date): DateOnly {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized as DateOnly;
}

/**
 * Date オブジェクトから DateTime を作成
 */
export function toDateTime(date: Date): DateTime {
  return new Date(date) as DateTime;
}

/**
 * 年月日時分秒から DateTime を作成
 */
export function createDateTime(
  year: number,
  month: number,
  day: number,
  hour: number = 0,
  minute: number = 0,
  second: number = 0,
  ms: number = 0
): DateTime {
  return new Date(year, month, day, hour, minute, second, ms) as DateTime;
}

// パース関数は date-time.parse.ts から再エクスポート
export {
  parseToDate,
  parseToDateTime,
  tryParseToDate,
  tryParseToDateTime,
  parseToDateAuto,
  tryParseToDateAuto
} from './date-time.parse';