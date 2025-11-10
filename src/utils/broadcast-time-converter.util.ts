import { format, parse, addDays, addSeconds, differenceInSeconds } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { ja } from 'date-fns/locale';

/**
 * Radikoの「放送日と時刻（05:00～29:00）」を
 * 通常のカレンダー時刻（00:00～24:00）と相互変換するユーティリティ
 *
 * 放送業界の共通仕様に対応（05:00 = 1日の開始）
 * 深夜0～5時は前日の24～29時扱い
 * Radiko遅延（タイムラグ）補正機能付き
 * date-fns + date-fns-tz によるタイムゾーン対応
 */
class BroadcastTimeConverter {
  private readonly JST_TIMEZONE = 'Asia/Tokyo';
  private readonly RADIO_DAY_START_HOUR = 5; // ラジオの1日は05:00開始

  // Radiko配信遅延（秒）
  private delaySec: number = 0;
  // 遅延 + ラジオ日付開始オフセット(5時間)のミリ秒
  private offsetMs: number = 0;

  constructor(delay: number | string) {
    this.setDelay(delay);
  }

  /**
   * Radiko遅延秒を設定し、内部オフセットを更新
   * @param delay 秒数（例: 20）
   */
  public setDelay(delay: number | string): void {
    this.delaySec = Number(delay);
    // ラジオ日付開始は「05:00」→ 遅延 + 5時間オフセット
    this.offsetMs = (this.delaySec + this.RADIO_DAY_START_HOUR * 3600) * 1000;
  }

  /**
   * 現在のJST時刻を取得
   */
  public getNowJST(): Date {
    return utcToZonedTime(new Date(), this.JST_TIMEZONE);
  }

  /**
   * 文字列をDateオブジェクトに変換（JST）
   * @param dateTimeStr yyyyMMddHHmmss 形式
   */
  private parseDateTime(dateTimeStr: string): Date {
    const padded = dateTimeStr.padEnd(14, '0');
    return parse(padded, 'yyyyMMddHHmmss', new Date());
  }

  /**
   * 現在時刻（yyyyMMddHHmmss）
   */
  public getCurrentTime(): string {
    return format(this.getNowJST(), 'yyyyMMddHHmmss');
  }

  /**
   * 今日の日付（yyyyMMdd）
   */
  public getCurrentDate(): string {
    return format(this.getNowJST(), 'yyyyMMdd');
  }

  /**
   * 現在時刻をラジコ時間(05:00=1日開始)で返す
   * 遅延補正済み
   */
  public getCurrentRadioTime(): string {
    const now = this.getNowJST();
    const delayed = addSeconds(now, -this.delaySec);
    return format(delayed, 'yyyyMMddHHmmss');
  }

  /**
   * ラジコ日付（深夜0～5時は前日扱い）
   * @returns yyyyMMdd 形式
   */
  public getCurrentRadioDate(): string {
    const now = this.getNowJST();
    const offset = new Date(now.getTime() - this.offsetMs);
    return format(offset, 'yyyyMMdd');
  }

  /**
   * 日付に日数を加算（yyyyMMdd → yyyyMMdd）
   * @param dateStr yyyyMMdd 形式
   * @param days 加算する日数
   */
  public addDay(dateStr: string, days: number): string {
    const date = parse(dateStr, 'yyyyMMdd', new Date());
    const newDate = addDays(date, days);
    return format(newDate, 'yyyyMMdd');
  }

  /**
   * ラジコ日付基準で、今日からN日間の日付リストを返す
   * @param begin 例) 0=今日, -6=6日前
   * @param end   例) 0=今日, 6=6日後
   * @param kanjiFmt 日本語フォーマット
   */
  public getRadioWeek(
    begin: number | string,
    end: number | string,
    kanjiFmt: string = 'yyyy年M月d日(E)'
  ): { index: number; date: string; kanji: string }[] {
    const now = this.getNowJST();
    const radioBase = new Date(now.getTime() - this.offsetMs);
    const result: { index: number; date: string; kanji: string }[] = [];

    const b = Number(begin);
    const e = Number(end);

    for (let i = b; i <= e; i++) {
      const target = addDays(radioBase, i);
      result.push({
        index: i,
        date: format(target, 'yyyyMMdd'),
        kanji: format(target, kanjiFmt, { locale: ja }),
      });
    }

    return result;
  }


  /**
   * ラジコ日付基準で、指定した日付範囲のリストを返す
   * @param from 開始日 (Date)
   * @param to   終了日 (Date)
   * @param kanjiFmt 日本語フォーマット
   */
  public getRadioWeekDateRange(from: Date, to: Date, kanjiFmt: string = 'yyyy年M月d日(E)'): { index: number; date: Date; kanji: string }[] {
    const radioBase = new Date(this.getNowJST().getTime() - this.offsetMs);

    // 日付のみ比較できるように時刻を切り捨て
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

    const result: { index: number; date: Date; kanji: string }[] = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const index = Math.floor((date.getTime() - radioBase.getTime()) / 86400000);

      result.push({
        index,
        date: date,
        kanji: format(date, kanjiFmt, { locale: ja }),
      });
    }
    return result;
  }

  /**
   * 通常時刻(00:00～05:00)をラジコ時刻(24:00～29:00)に変換
   * @param timeStr yyyyMMddHHmmss 形式
   * @returns yyyyMMddHHmmss 形式（深夜は前日の24～29時扱い）
   */
  public convertRadioTime(timeStr: string): string {
    const padded = timeStr.padEnd(14, '0');
    const hour = parseInt(padded.substring(8, 10));

    // 00:00～04:59 → 前日の24:00～28:59に変換
    if (hour < this.RADIO_DAY_START_HOUR) {
      const date = this.parseDateTime(padded);
      const prevDay = addDays(date, -1);
      const newHour = hour + 24;

      return format(prevDay, 'yyyyMMdd') +
        String(newHour).padStart(2, '0') +
        padded.substring(10, 14);
    }

    return padded;
  }

  /**
   * ラジコ時刻(24:00～29:00)を通常時刻(00:00～05:00)に逆変換
   * @param timeStr yyyyMMddHHmmss 形式
   * @returns yyyyMMddHHmmss 形式
   */
  public revConvertRadioTime(timeStr: string): string {
    const padded = timeStr.padEnd(14, '0');
    const hour = parseInt(padded.substring(8, 10));

    // 24:00～29:00 → 翌日の00:00～05:00に変換
    if (hour >= 24) {
      const date = this.parseDateTime(padded);
      const nextDay = addDays(date, 1);
      const newHour = hour - 24;

      return format(nextDay, 'yyyyMMdd') +
        String(newHour).padStart(2, '0') +
        padded.substring(10, 14);
    }

    return padded;
  }

  /**
   * 番組時間をチェック('yyyyMMddHHmmss'形式)
   * @param ft 番組開始時刻
   * @param to 番組終了時刻
   * @param currentTime 現在時刻
   * @returns 0: 放送中、負: 過去、正: 未来（秒）
   */
  public checkProgramTime(ft: string, to: string, currentTime: string): number {
    if (ft <= currentTime && currentTime < to) {
      return 0; // 放送中
    }
    return this.getTimeSpan(currentTime, ft); // 過去:マイナス，未来:プラス(sec)
  }

  /**
   * 2つの時刻の差を秒単位で計算
   * @param from 開始時刻 (yyyyMMddHHmmss)
   * @param to 終了時刻 (yyyyMMddHHmmss)
   * @returns 時間差（秒）
   */
  public getTimeSpan(from: string, to: string): number {
    const fromDate = this.parseDateTime(from);
    const toDate = this.parseDateTime(to);
    return differenceInSeconds(toDate, fromDate);
  }

  /**
   * 時刻に秒数を加算
   * @param timeStr yyyyMMddHHmmss 形式
   * @param seconds 加算する秒数
   * @returns yyyyMMddHHmmss 形式
   */
  public addTime(timeStr: string, seconds: number | string): string {
    if (!seconds) return timeStr;
    const date = this.parseDateTime(timeStr);
    const newDate = addSeconds(date, Number(seconds));
    return format(newDate, 'yyyyMMddHHmmss');
  }

  // ['yyyyMMddHHmmss'] * '$1/$2/$3 $4:$5-$10:$11' => 'yyyy/MM/dd HH:mm-HH:mm'
  public formatFullString2(srcArray: string[], fmt: string): string {
    let src = '', reg = '';
    for (const s of srcArray) {
      const padded = s.padEnd(14, '0');
      src += padded.replace(/^(\d{14}).*$/, '$1');
      reg += '(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})';
    }
    return src.replace(new RegExp(reg), fmt);
  }

  // 'yyyyMMddHHmmss' * '$1/$2/$3' => 'yyyy/MM/dd'
  public formatDateString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^(\d{4})(\d\d)(\d\d).*$/, fmt);
  }

  // ['yyyyMMddHHmmss'] * '$1:$2-$4:$5' => 'HH:mm-HH:mm'
  public formatTimeString2(srcArray: string[], fmt: string): string {
    let src = '', reg = '';
    for (const s of srcArray) {
      const padded = s.padEnd(14, '0');
      src += padded.replace(/^\d{8}(\d{6}).*$/, '$1');
      reg += '(\\d{2})(\\d{2})(\\d{2})';
    }
    return src.replace(new RegExp(reg), fmt);
  }
}

// デフォルト20秒遅延
export const broadcastTimeConverter = new BroadcastTimeConverter(20);