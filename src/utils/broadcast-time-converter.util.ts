import { format, parse, addDays, addSeconds, differenceInSeconds } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ja } from 'date-fns/locale';
import type { DateOnly, DateString, DateTime, DateTimeString } from '@/types/date-time.types';
import { toDateString, toDateTimeString, parseToDate, parseToDateTime } from '@/types/date-time.types';

/**
 * ラジオ放送時間を管理するためのユーティリティクラス
 *
 * @remarks
 * このクラスは、ラジオ放送特有の時間処理を提供します。
 * - ラジオの1日は午前5時を基準とします
 * - 放送遅延を考慮した時刻計算が可能です
 * - JST（日本標準時）での時刻処理を行います
 */
class BroadcastTimeConverter {
  private readonly JST_TIMEZONE = 'Asia/Tokyo';
  private readonly RADIO_DAY_START_HOUR = 5;
  private readonly offsetMs: number;
  private delaySec: number;

  /**
   * BroadcastTimeConverterのインスタンスを生成します
   *
   * @param delaySec - 放送遅延時間（秒）。デフォルトは20秒
   */
  constructor(delaySec: number = 20) {
    this.delaySec = delaySec;
    this.offsetMs = this.RADIO_DAY_START_HOUR * 60 * 60 * 1000;
  }

  /**
   * 遅延時間を設定する
   *
   * @param delay - 設定する遅延時間（秒）
   */
  public setDelay(delay: number): void {
    this.delaySec = delay;
  }

  /**
   * 現在のJST時刻を取得する
   *
   * @returns 現在のJST時刻
   */
  private getNowJST(): Date {
    return utcToZonedTime(new Date(), this.JST_TIMEZONE);
  }

  /**
   * 現在の日付を取得する
   *
   * @returns 現在のJST日付
   */
  public getCurrentDate(): DateOnly {
    return this.getNowJST() as DateOnly;
  }

  /**
   *
   * @returns
   */
  public getCurrentDateTime(): DateTime {
    return this.getNowJST() as DateTime;
  }

  /**
   * 現在のラジオ日付を取得する（5時基準）
   *
   * @remarks
   * 午前5時を基準として、それより前の時刻は前日として扱います
   *
   * @returns ラジオ基準での現在日付
   */
  public getCurrentRadioDateTime(): DateTime {
    // 現在のJST時刻を取得
    const nowDate: Date = this.getNowJST();
    // 5時基準で調整
    const radioBase: Date = new Date(nowDate.getTime() - this.offsetMs);
    return radioBase as DateTime;
  }

  /**
   * 現在のラジオ時刻を取得する（遅延を考慮）
   *
   * @remarks
   * コンストラクタまたはsetDelayで設定された遅延時間を差し引いた時刻を返します
   *
   * @returns 遅延を考慮したラジオ時刻
   */
  public getCurrentRadioTime(): DateTime {
    // 現在のJST時刻を取得
    const nowDate: Date = this.getNowJST();
    // 遅延時間を差し引く
    const delayed: DateTime = addSeconds(nowDate, -this.delaySec) as DateTime;
    return delayed;
  }

  /**
   * 日付文字列をDateオブジェクトに変換する
   *
   * @param dateStr - 変換する日付文字列（yyyyMMdd形式）
   * @returns 変換されたDateオブジェクト
   */
  public parseDateToDateOnly(dateStr: string): DateOnly {
    return parse(dateStr, 'yyyyMMdd', new Date()) as DateOnly;
  }

  /**
   * DateOnlyをDateTimeに変換する
   * 時分秒は00:00:00に設定されます
   *
   * @param dateOnly - 変換するDateOnlyオブジェクト
   * @returns 変換されたDateTimeオブジェクト
   */
  public parseDateOnlyToDateTime(dateOnly: DateOnly): DateTime {
    const date: Date = this.parseDateOnlyToDate(dateOnly);
    return new Date(date.setHours(0, 0, 0, 0)) as DateTime;
  }

  /**
   * DateOnly を Dateに変換する
   *
   * @param dateOnly - 変換するDateOnlyオブジェクト
   * @returns 変換されたDateオブジェクト
   */
  public parseDateOnlyToDate(dateOnly: DateOnly): Date {
    return new Date(dateOnly.getFullYear(), dateOnly.getMonth(), dateOnly.getDate());
  }

  /**
   * 文字列をDateTimeオブジェクトに変換する
   *
   * @param dateTimeStr - 変換する日時文字列
   * @returns 変換されたDateTimeオブジェクト
   */
  public parseStringToDateTime(dateTimeStr: string): DateTime {
    return parseToDateTime(dateTimeStr);
  }

  /**
   * DateTimeをHHmm形式の文字列に変換する
   *
   * @param dateTime - 変換するDateTimeオブジェクト
   * @returns HHmm形式の時刻文字列（例: "1430"）
   */
  public revConvertRadioTime(dateTime: DateTime): string {
    return format(dateTime, 'HHmm');
  }

  /**
   * DateTimeをHHmmss形式の文字列に変換する
   *
   * @param dateTime - 変換するDateTimeオブジェクト
   * @returns HHmmss形式の時刻文字列（例: "143059"）
   */
  public revConvertRadioTimeWithSeconds(dateTime: DateTime): string {
    return format(dateTime, 'HHmmss');
  }

  /**
   * DateTimeをyyyyMMdd形式の文字列に変換する
   *
   * @param dateTime - 変換するDateTimeオブジェクト
   * @returns yyyyMMdd形式の日付文字列（例: "20240115"）
   */
  public parseDateTimeToStringDate(dateTime: DateTime): string {
    return format(dateTime, 'yyyyMMdd');
  }

  public parseDateOnlyToStringDate(dateOnly: DateOnly): string {
    return format(dateOnly, 'yyyyMMdd');
  }

  /**
   * DateTimeをyyyyMMddHHmmss形式の文字列に変換する
   *
   * @param dateTime - 変換するDateTimeオブジェクト
   * @returns yyyyMMddHHmmss形式の日時文字列（例: "20240115143059"）
   */
  public parseDateTimeToStringDateTime(dateTime: DateTime): string {
    return format(dateTime, 'yyyyMMddHHmmss');
  }

  public parseDateTimeToDateOnly(dateTime: DateTime): DateOnly {
    const dateStr: string = this.parseDateTimeToStringDate(dateTime);
    return this.parseDateToDateOnly(dateStr);
  }


  /**
   * 番組時間内かチェックし、時間差を返す
   *
   * @param ftDateTime - 番組開始時刻
   * @param toDateTime - 番組終了時刻
   * @param currentTime - チェック対象の現在時刻
   * @returns 番組時間内の場合は0、それ以外は開始時刻までの秒数差
   */
  public checkProgramTime(ftDateTime: DateTime, toDateTime: DateTime, currentTime: DateTime): number {
    if (ftDateTime <= currentTime && currentTime < toDateTime) {
      return 0;
    }
    return this.getTimeSpanByDateTime(currentTime, ftDateTime);
  }

  /**
   * 日付に指定日数を加算する
   *
   * @param dateStr - 基準となる日付文字列（yyyyMMdd形式）
   * @param days - 加算する日数（負の値で減算）
   * @returns 計算結果の日付文字列（yyyyMMdd形式）
   */
  public addDay(dateStr: DateString, days: number): DateString {
    const parsed = parse(dateStr, 'yyyyMMdd', new Date());
    const newDate = addDays(parsed, days);
    return toDateString(format(newDate, 'yyyyMMdd'));
  }

  /**
   * 日時に指定秒数を加算する
   *
   * @param dateTime - 基準となる日時
   * @param seconds - 加算する秒数（負の値で減算）
   * @returns 計算結果の日時
   */
  public addSecondsTime(dateTime: DateTime, seconds: number): DateTime {
    const newDateTime = addSeconds(dateTime, seconds);
    return newDateTime as DateTime;
  }

  /**
   * 2つのDate間の秒数差を取得する
   *
   * @param fromDate - 開始日時
   * @param toDate - 終了日時
   * @returns 秒数差（toDate - fromDate）
   */
  public getTimeSpanByDate(fromDate: Date, toDate: Date): number {
    return differenceInSeconds(toDate, fromDate);
  }

  /**
   * 2つのDateTime間の秒数差を取得する
   *
   * @param fromDateTime - 開始日時
   * @param toDateTime - 終了日時
   * @returns 秒数差（toDateTime - fromDateTime）
   */
  public getTimeSpanByDateTime(fromDateTime: DateTime, toDateTime: DateTime): number {
    return differenceInSeconds(toDateTime, fromDateTime);
  }

  /**
   * 2つの日時文字列間の秒数差を取得する
   *
   * @param from - 開始日時文字列
   * @param to - 終了日時文字列
   * @returns 秒数差（to - from）
   */
  public getTimeSpan(from: DateTimeString, to: DateTimeString): number {
    const fromDate = parseToDateTime(from);
    const toDate = parseToDateTime(to);

    return differenceInSeconds(toDate, fromDate);
  }

  /**
   * 日時を指定フォーマットで整形する
   *
   * @param dateTime - 整形する日時
   * @param formatStr - 出力フォーマット（date-fnsのformat関数の形式）
   * @returns 整形された日時文字列
   */
  public formatDateTime(dateTime: DateTime, formatStr: string): string {
    return format(dateTime, formatStr, { locale: ja });
  }

  public formatDateOnly(dateOnly: DateOnly, formatStr: string): string {
    return format(dateOnly, formatStr, { locale: ja });
  }

  /**
   * 開始・終了日時を指定フォーマットで整形する
   *
   * @param startDateTime - 開始日時
   * @param endDateTime - 終了日時
   * @param startFormat - 開始日時のフォーマット
   * @param endFormat - 終了日時のフォーマット（省略時はstartFormatを使用）
   * @param separator - 区切り文字。デフォルトは'-'
   * @returns 整形された日時範囲文字列
   */
  public formatDateTimeRange(startDateTime: DateTime, endDateTime: DateTime, startFormat: string, endFormat?: string, separator: string = '-'): string {
    const startStr: string = format(startDateTime, startFormat, { locale: ja });
    const endStr: string = format(endDateTime, endFormat || startFormat, { locale: ja });
    return `${startStr}${separator}${endStr}`;
  }

  /**
   * ラジオ業界特有の24時以降の時刻表記（放送時刻）を通常の日時（DateTime）に変換します。
   *
   * ラジオ局では、深夜帯の番組を前日の延長として表記するため、
   * 24:00以降（例: 25:30 = 翌日01:30）の時刻表記が使用されます。
   * この関数は、そのような放送時刻を標準的なDateTime型に正規化します。
   *
   * @param dateTimeString - 変換対象の日時文字列（yyyyMMddHHmmss形式、最大14桁）
   *                         14桁未満の場合は自動的に'0'でパディングされます
   * @returns 変換後のDateTime型オブジェクト
   *          - 24時以降の場合: 翌日の該当時刻に変換（例: 20240101250000 → 2024-01-02 01:00:00）
   *          - 23時以前の場合: そのままDateTime型に変換
   *
   * @example
   * ```typescript
   * // 通常の時刻（23時以前）
   * convertRadioTime('20240101120000') // → 2024-01-01 12:00:00
   *
   * // 深夜時刻（24時以降）
   * convertRadioTime('20240101250000') // → 2024-01-02 01:00:00
   * convertRadioTime('20240101273000') // → 2024-01-02 03:30:00
   * ```
   */
  public convertRadioTime(dateTimeString: DateTimeString): DateTime {
    // yyyyMMddHHmmss の 14桁にパディング
    const padded: string = dateTimeString.padEnd(14, '0');

    // HH（時）の部分を抽出
    const hour: number = parseInt(padded.slice(8, 10), 10);

    // 24時間未満の場合はそのまま変換
    if (hour < 24) {
      return parseToDateTime(padded);
    }

    // 24時間以上の場合
    // 年月日部分
    const dateStr: string = padded.slice(0, 8);

    // 時分秒部分（24を引く）
    const adjustedHour: number = hour - 24;

    // 分秒部分
    const minute: string = padded.slice(10, 12);
    const second: string = padded.slice(12, 14);

    // 一旦その日の時刻として DateTime を作成
    const baseDate: string = `${dateStr}${String(adjustedHour).padStart(2, '0')}${minute}${second}`;
    const dateTime: DateTime = parseToDateTime(baseDate);

    // 翌日に変換
    return addDays(dateTime, 1) as DateTime;
  }

  /**
   * ラジオ日時形式の文字列をDateTimeに変換する（24時間以上対応）
   *
   * @remarks
   * - Radikoの深夜表記（24:00～29:00）を正しく翌日の時刻に変換します
   * - 午前0時～4時59分の時刻は、放送日基準（前日扱い）ではありません
   *
   * @param dateTimeString - ラジオ日時文字列（yyyyMMddHHmmss形式、部分指定可）
   * @returns 変換されたDateTime
   */
  public convertRadioDateTime(dateTimeString: DateTimeString): DateTime {
    // まず24時間以上を正規化
    const normalized: DateTime = this.convertRadioTime(dateTimeString);

    // DateTime に変換
    return normalized;
  }
}

export const broadcastTimeConverter = new BroadcastTimeConverter(20);
