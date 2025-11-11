import { format, parse, addDays, addSeconds, differenceInSeconds } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ja } from 'date-fns/locale';
import type { DateString, DateTime, DateTimeString } from '@/types/date-time.types';
import { toDateString, toDateTimeString, parseToDate, parseToDateTime } from '@/types/date-time.types';

class BroadcastTimeConverter {
  private readonly JST_TIMEZONE = 'Asia/Tokyo';
  private readonly RADIO_DAY_START_HOUR = 5;
  private readonly offsetMs: number;
  private delaySec: number;

  constructor(delaySec: number = 20) {
    this.delaySec = delaySec;
    this.offsetMs = this.RADIO_DAY_START_HOUR * 60 * 60 * 1000;
  }

  /**
   * 遅延設定
   */
  public setDelay(delay: number | string): void {
    this.delaySec = Number(delay);
  }

  /**
   * 現在のJST時刻を取得
   */
  public getNowJST(): Date {
    return utcToZonedTime(new Date(), this.JST_TIMEZONE);
  }

  /**
   * 現在の日付を取得（yyyyMMdd）
   */
  public getCurrentDate(): Date {
    return this.getNowJST();
  }

  /**
   * 現在のラジオ日付を取得（05:00 = 1日の開始）
   */
  public getCurrentRadioDate(): Date {
    const nowDate: Date = this.getNowJST();
    const radioBase: Date = new Date(nowDate.getTime() - this.offsetMs);
    return radioBase;
  }

  /**
   * 現在時刻をラジコ時間で返す（yyyyMMddHHmmss）
   */
  public getCurrentRadioTime(): DateTime {
    const nowDate: Date = this.getNowJST();
    const delayed: DateTime = addSeconds(nowDate, -this.delaySec) as DateTime;
    return delayed;
  }

  /**
   * 文字列をDateオブジェクトに変換
   */
  public parseStringToDate(dateStr: string): Date {
    return parseToDate(dateStr);
  }

  /**
   * 文字列をDateTimeオブジェクトに変換
   */
  public parseStringToDateTime(dateTimeStr: string): DateTime {
    return parseToDateTime(dateTimeStr);
  }

  /**
   * DateTimeオブジェクトを'HHmm'形式の文字列に変換します。
   *
   * @param dateTime - 変換するDateTimeオブジェクト。
   * @returns 'HHmm'形式の時間を表す文字列。
   */
  public revConvertRadioTime(dateTime: DateTime): string {
    return format(dateTime, 'HHmm');
  }

  /**
   * DateTimeオブジェクトを'HHmmss'形式の文字列に変換します。
   *
   * @param dateTime - 変換するDateTimeオブジェクト。
   * @returns 'HHmmss'形式の時間を表す文字列。
   */
  public revConvertRadioTimeWithSeconds(dateTime: DateTime): string {
    return format(dateTime, 'HHmmss');
  }

  /**
   * DateTimeを'yyyyMMdd'形式の文字列に変換
   * @param dateTime
   * @returns
   */
  public parseDateTimeToStringDate(dateTime: DateTime): string {
    return format(dateTime, 'yyyyMMdd');
  }

  /**
   * DateTimeを'yyyyMMddHHmmss'形式の文字列に変換
   * @param dateTime
   * @returns
   */
  public parseDateTimeToStringDateTime(dateTime: DateTime): string {
    return format(dateTime, 'yyyyMMddHHmmss');
  }

  // 番組時間をチェック('yyyyMMddHHmmss'形式)
  public checkProgramTime(ftDateTime: DateTime, toDateTime: DateTime, currentTime: DateTime): number {
    if (ftDateTime <= currentTime && currentTime < toDateTime) {
      // 放送中
      return 0;
    }
    // 過去:マイナス，未来:プラス(sec)
    return this.getTimeSpanByDateTime(currentTime, ftDateTime);
  }

  /**
   * 日付に日数を加算（yyyyMMdd → yyyyMMdd）
   */
  public addDay(dateStr: DateString | string, days: number): DateString {
    const date = typeof dateStr === 'string' ? toDateString(dateStr) : dateStr;
    const parsed = parse(date, 'yyyyMMdd', new Date());
    const newDate = addDays(parsed, days);
    return toDateString(format(newDate, 'yyyyMMdd'));
  }

  /**
   * 日時に秒数を加算（DateTime → DateTime）
   */
  public addTime(dateTime: DateTime, seconds: number): DateTime {
    const newDateTime = addSeconds(dateTime, seconds);
    return newDateTime as DateTime;
  }

  /**
   * ラジコ日付基準で、今日からN日間の日付リストを返す
   */
  public getRadioWeek(
    begin: number | string,
    end: number | string,
    kanjiFmt: string = 'yyyy年M月d日(E)'
  ): { index: number; date: DateString; kanji: string }[] {
    const now = this.getNowJST();
    const radioBase = new Date(now.getTime() - this.offsetMs);
    const result: { index: number; date: DateString; kanji: string }[] = [];

    const b = Number(begin);
    const e = Number(end);

    for (let i = b; i <= e; i++) {
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
   * ラジコ日付基準で、指定した日付範囲のリストを返す
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
   * 2つの Date の差を秒単位で計算
   */
  public getTimeSpanByDate(fromDate: Date, toDate: Date): number {
    return differenceInSeconds(toDate, fromDate);
  }

  /**
 * 2つの Date の差を秒単位で計算
 */
  public getTimeSpanByDateTime(fromDateTime: DateTime, toDateTime: DateTime): number {
    return differenceInSeconds(toDateTime, fromDateTime);
  }

  /**
   * 2つの DateTimeString の差を秒単位で計算
   */
  public getTimeSpan(from: DateTimeString | string, to: DateTimeString | string): number {
    const fromNormalized = typeof from === 'string' ? toDateTimeString(from) : from;
    const toNormalized = typeof to === 'string' ? toDateTimeString(to) : to;

    const fromDate = parseToDateTime(fromNormalized);
    const toDate = parseToDateTime(toNormalized);

    return differenceInSeconds(toDate, fromDate);
  }

  /**
   * 通常時刻(00:00～05:00)をラジコ時刻(24:00～29:00)に変換
   */
  public convertRadioTime(timeStr: string): DateTimeString {
    // 14桁にパディング
    const padded: string = timeStr.padEnd(14, '0');
    // 時間部分を抽出
    const hour: number = parseInt(padded.substring(8, 10));

    if (hour < this.RADIO_DAY_START_HOUR) {
      const date: DateTime = this.parseStringToDateTime(padded);
      const prevDay: Date = addDays(date, -1);
      const newHour: number = hour + 24;

      const result = format(prevDay, 'yyyyMMdd') +
        String(newHour).padStart(2, '0') +
        padded.substring(10, 14);

      return toDateTimeString(result);
    }

    return toDateTimeString(padded);
  }


  /**
   * 通常時刻(00:00～05:00)をラジコ時刻(24:00～29:00)に変換
   */
  public convertRadioDateTime(timeStr: string): DateTime {
    // 14桁にパディング
    const padded: string = timeStr.padEnd(14, '0');
    // 時間部分を抽出
    const hour: number = parseInt(padded.substring(8, 10));

    if (hour < this.RADIO_DAY_START_HOUR) {
      const date: DateTime = this.parseStringToDateTime(padded);
      const prevDay: Date = addDays(date, -1);
      const newHour: number = hour + 24;

      const result = format(prevDay, 'yyyyMMdd') +
        String(newHour).padStart(2, '0') +
        padded.substring(10, 14);

      return this.parseStringToDateTime(result);
    }

    return this.parseStringToDateTime(padded);
  }

  /**
   * DateTimeString をフォーマット
   */
  public formatDateString(dateTimeStr: DateTimeString | string, formatStr: string): string {
    const normalized = typeof dateTimeStr === 'string' ? toDateTimeString(dateTimeStr) : dateTimeStr;
    const date = parseToDateTime(normalized);
    return format(date, formatStr, { locale: ja });
  }

  /**
   * 複数の DateTimeString をフォーマット（正規表現置換）
   */
  public formatTimeString2(dateTimeStrArray: (DateTimeString | string)[], formatStr: string): string {
    const regex = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/g;
    return dateTimeStrArray.join('~').replace(regex, formatStr);
  }

  /**
   * 日時の範囲をフォーマット（開始～終了）
   *
   * @param start 開始日時
   * @param end 終了日時
   * @param startFormat 開始日時のフォーマット (date-fns形式)
   * @param endFormat 終了日時のフォーマット（省略時は startFormat と同じ）
   * @param separator セパレーター（デフォルト: '-'）
   * @returns フォーマット済み文字列
   *
   * @example
   * const start = createDateTime(2025, 10, 10, 12, 0, 0);
   * const end = createDateTime(2025, 10, 10, 13, 0, 0);
   *
   * // 年月日 時:分-時:分
   * formatDateTimeRange(start, end, 'yyyy/MM/dd HH:mm', 'HH:mm')
   * // => '2025/11/10 12:00-13:00'
   *
   * // 時刻のみ
   * formatDateTimeRange(start, end, 'HH:mm')
   * // => '12:00-13:00'
   *
   * // カスタムセパレーター
   * formatDateTimeRange(start, end, 'HH:mm', 'HH:mm', ' ～ ')
   * // => '12:00 ～ 13:00'
   */
  public formatDateTimeRange(startDateTime: DateTime, endDateTime: DateTime, startFormat: string, endFormat?: string, separator: string = '-'): string {
    // 開始日時を指定フォーマットで文字列化（日本語ロケール使用）
    const startStr: string = format(startDateTime, startFormat, { locale: ja });

    // 終了日時を指定フォーマットで文字列化（endFormat未指定時はstartFormatを使用）
    const endStr: string = format(endDateTime, endFormat || startFormat, { locale: ja });

    // 開始時刻 + セパレーター + 終了時刻 の形式で返却
    return `${startStr}${separator}${endStr}`;
  }


  /**
   * 複数の Date をフォーマット（正規表現置換）
   *
   * @param srcArray Date の配列
   * @param fmt フォーマット文字列 (例: '$1/$2/$3')
   *            - $1-$3: 日付 (年、月、日)
   * @returns フォーマット済み文字列
   *
   * @example
   * const date1 = new Date(2025, 10, 10);
   * const date2 = new Date(2025, 10, 11);
   * formatDateArray([date1, date2], '$1/$2/$3')
   * // => '2025/11/10-2025/11/11'
   */
  public formatDateArray(srcArray: Date[], fmt: string): string {
    let concatenatedDates = '';
    let regexPattern = '';

    for (const item of srcArray) {
      // Date → 'yyyyMMdd' 形式に変換
      const dateStr = format(item, 'yyyyMMdd');

      // 連結
      concatenatedDates += dateStr;

      // 正規表現パターンを追加（年月日の3グループ）
      regexPattern += '(\\d{4})(\\d{2})(\\d{2})';
    }

    // 連結した文字列を正規表現で置換
    return concatenatedDates.replace(new RegExp(regexPattern), fmt);
  }
}

// デフォルトの遅延時間は20秒
export const broadcastTimeConverter = new BroadcastTimeConverter(20);