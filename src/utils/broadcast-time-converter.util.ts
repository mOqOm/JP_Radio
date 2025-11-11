import { format, parse, addDays, addSeconds, differenceInSeconds } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ja } from 'date-fns/locale';
import type { DateString, DateTime, DateTimeString } from '@/types/date-time.types';
import { toDateString, toDateTimeString, parseToDate, parseToDateTime } from '@/types/date-time.types';

/**
 * ラジオ放送時間を管理するためのユーティリティクラス
 *
 * @remarks
 * このクラスは、ラジオ放送特有の時間処理を提供します。
 * - ラジオの1日は午前5時を基準とします
 * - 放送遅延を考慮した時刻計算が可能です
 * - JST（日本標準時）での時刻処理を行います
 *
 * @example
 * ```typescript
 * const converter = new BroadcastTimeConverter(20);
 * const currentRadioDate = converter.getCurrentRadioDate();
 * const currentRadioTime = converter.getCurrentRadioTime();
 * ```
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
  public getNowJST(): Date {
    return utcToZonedTime(new Date(), this.JST_TIMEZONE);
  }

  /**
   * 現在の日付を取得する
   *
   * @returns 現在のJST日付
   */
  public getCurrentDate(): Date {
    return this.getNowJST();
  }

  /**
   * 現在のラジオ日付を取得する（5時基準）
   *
   * @remarks
   * 午前5時を基準として、それより前の時刻は前日として扱います
   *
   * @returns ラジオ基準での現在日付
   */
  public getCurrentRadioDate(): Date {
    const nowDate: Date = this.getNowJST();
    const radioBase: Date = new Date(nowDate.getTime() - this.offsetMs);
    return radioBase;
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
    const nowDate: Date = this.getNowJST();
    const delayed: DateTime = addSeconds(nowDate, -this.delaySec) as DateTime;
    return delayed;
  }

  /**
   * 文字列をDateオブジェクトに変換する
   *
   * @param dateStr - 変換する日付文字列
   * @returns 変換されたDateオブジェクト
   */
  public parseStringToDate(dateStr: string): Date {
    return parseToDate(dateStr);
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

  /**
   * DateTimeをyyyyMMddHHmmss形式の文字列に変換する
   *
   * @param dateTime - 変換するDateTimeオブジェクト
   * @returns yyyyMMddHHmmss形式の日時文字列（例: "20240115143059"）
   */
  public parseDateTimeToStringDateTime(dateTime: DateTime): string {
    return format(dateTime, 'yyyyMMddHHmmss');
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
  public addTime(dateTime: DateTime, seconds: number): DateTime {
    const newDateTime = addSeconds(dateTime, seconds);
    return newDateTime as DateTime;
  }

  /**
   * ラジオ週間の日付リストを取得する
   *
   * @param begin - 開始インデックス（0が基準日）
   * @param end - 終了インデックス
   * @param kanjiFmt - 漢字表記のフォーマット。デフォルトは'yyyy年M月d日(E)'
   * @returns 日付情報の配列（インデックス、日付文字列、漢字表記を含む）
   */
  public getRadioWeek(
    begin: number,
    end: number,
    kanjiFmt: string = 'yyyy年M月d日(E)'
  ): { index: number; date: DateString; kanji: string }[] {
    const now = this.getNowJST();
    const radioBase = new Date(now.getTime() - this.offsetMs);
    const result: { index: number; date: DateString; kanji: string }[] = [];

    for (let i = begin; i <= end; i++) {
      const target = addDays(radioBase, i);
      result.push({
        index: i,
        date: toDateString(format(target, 'yyyyMMdd')),
        kanji: format(target, kanjiFmt, { locale: ja }),
      });
    }

    return result;
  }

  /**
   * 指定期間のラジオ週間の日付リストを取得する
   *
   * @param from - 開始日
   * @param to - 終了日
   * @param kanjiFmt - 漢字表記のフォーマット。デフォルトは'yyyy年M月d日(E)'
   * @returns 日付情報の配列（インデックス、Dateオブジェクト、漢字表記を含む）
   */
  public getRadioWeekByDateRange(from: Date, to: Date, kanjiFmt: string = 'yyyy年M月d日(E)'): { index: number; date: Date; kanji: string }[] {
    const radioBase = new Date(this.getNowJST().getTime() - this.offsetMs);

    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

    const result: { index: number; date: Date; kanji: string }[] = [];
    for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
      const index: number = Math.floor((date.getTime() - radioBase.getTime()) / 86400000);

      result.push({
        index,
        date: date,
        kanji: format(date, kanjiFmt, { locale: ja }),
      });
    }
    return result;
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
  public formatDate(dateTime: DateTime, formatStr: string): string {
    return format(dateTime, formatStr, { locale: ja });
  }


  /**
   * 開始・終了日時をHHmm-HHmm形式に整形する
   *
   * @param fromDateTime
   * @param toDateTime
   * @returns
   */
  public formatTimeString(fromDateTime: DateTime, toDateTime: DateTime): string {
    const fromTimeStr: string = this.revConvertRadioTime(fromDateTime);
    const toTimeStr: string = this.revConvertRadioTime(toDateTime);
    return `${fromTimeStr}-${toTimeStr}`;
  }

  /**
   * 日時文字列配列を指定フォーマットで整形する
   *
   * @param dateTimeStrArray - 整形する日時文字列の配列
   * @param formatStr - 出力フォーマット（正規表現のキャプチャグループを使用）
   * @returns 整形された日時文字列（~で連結）
   */
  public formatTimeString2(dateTimeStrArray: DateTimeString[], formatStr: string): string {
    const regex = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/g;
    return dateTimeStrArray.join('~').replace(regex, formatStr);
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
   * Date配列を指定フォーマットで整形する
   *
   * @param srcArray - 整形するDateオブジェクトの配列
   * @param fmt - 出力フォーマット（正規表現のキャプチャグループを使用）
   * @returns 整形された日付文字列
   */
  public formatDateArray(srcArray: Date[], fmt: string): string {
    let concatenatedDates = '';
    let regexPattern = '';

    for (const item of srcArray) {
      const dateStr = format(item, 'yyyyMMdd');
      concatenatedDates += dateStr;
      regexPattern += '(\\d{4})(\\d{2})(\\d{2})';
    }

    return concatenatedDates.replace(new RegExp(regexPattern), fmt);
  }

  /**
   * ラジオ時刻形式の文字列を DateTimeString に変換する（24時間以上対応）
   *
   * @remarks
   * Radikoは深夜を24:00, 25:00のように表記します。
   * これを翌日の00:00, 01:00に変換します。
   *
   * @param timeStr - ラジオ時刻文字列（yyyyMMddHHmmss形式、部分指定可）
   * @returns 正規化された DateTimeString（24時間以上を翌日に変換）
   */
  public convertRadioTime(timeStr: string): DateTimeString {
    // 14桁にパディング
    const padded: string = timeStr.padEnd(14, '0');

    // 時間部分を抽出
    const hourStr: string = padded.slice(8, 10);
    const hour: number = parseInt(hourStr, 10);

    // 24時間以上の場合は通常の日時に変換（24:00 → 翌日00:00）
    if (hour >= 24) {
      const year: number = parseInt(padded.slice(0, 4), 10);
      const month: number = parseInt(padded.slice(4, 6), 10);
      const day: number = parseInt(padded.slice(6, 8), 10);
      const adjustedHour: number = hour - 24;
      const minute: string = padded.slice(10, 12);
      const second: string = padded.slice(12, 14);

      // 一旦通常の時刻として DateTime を作成
      const normalizedTimeStr =
        `${padded.slice(0, 4)}${padded.slice(4, 6)}${padded.slice(6, 8)}` +
        `${String(adjustedHour).padStart(2, '0')}${minute}${second}`;

      // DateTime に変換して1日加算
      const dateTime: DateTime = parseToDateTime(normalizedTimeStr);
      const nextDay: DateTime = addDays(dateTime, 1) as DateTime;

      // DateTimeString に変換
      return toDateTimeString(format(nextDay, 'yyyyMMddHHmmss'));
    }

    // 通常の時刻（0～23時）はそのまま返す
    return toDateTimeString(padded);
  }

  /**
   * ラジオ日時形式の文字列をDateTimeに変換する（24時間以上対応）
   *
   * @remarks
   * - Radikoの深夜表記（24:00～29:00）を正しく翌日の時刻に変換します
   * - 午前0時～4時59分の時刻は、放送日基準（前日扱い）ではありません
   *
   * @param timeStr - ラジオ日時文字列（yyyyMMddHHmmss形式、部分指定可）
   * @returns 変換されたDateTime
   */
  public convertRadioDateTime(timeStr: string): DateTime {
    // まず24時間以上を正規化
    const normalized: DateTimeString = this.convertRadioTime(timeStr);

    // DateTime に変換
    return parseToDateTime(normalized);
  }
}

export const broadcastTimeConverter = new BroadcastTimeConverter(20);
