import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

// 1時間をミリ秒換算
const HOUR_msec = 3600000;

/**
 * Radikoの「放送日と時刻（05:00～29:00）」を
 * 通常のカレンダー時刻（00:00～24:00）と相互変換するユーティリティ
 *
 * ✅ 放送業界の共通仕様に対応（05:00 = 1日の開始）
 * ✅ 深夜0～5時は前日の24～29時扱い
 * ✅ Radiko遅延（タイムラグ）補正機能付き
 * ✅ Date-fns によるフォーマット
 */
class BroadcastTimeConverter  {
  // Radiko配信遅延（秒→ミリ秒）
  private DELAY_msec: number = 0;
  // 遅延 + ラジコ日付開始オフセット(5h)
  private OFFSET_msec: number = 0;

  constructor(delay: number | string) {
    this.setDelay(delay);
  }

  /**
   * Radiko遅延秒を設定し、内部オフセットを更新
   * @param delay 秒数（例: 20）
   */
  public setDelay(delay: number | string): void {
    this.DELAY_msec = Number(delay) * 1000;
    // Radiko日付開始は「05:00」
    // → 遅延 + 5時間オフセット = ラジオ基準時
    this.OFFSET_msec = this.DELAY_msec + 5 * HOUR_msec;
  }

  /** 現在時刻（yyyyMMddHHmmss） */
  public getCurrentTime(): string {
    return format(Date.now(), 'yyyyMMddHHmmss');
  }

  /** 今日の日付（yyyyMMdd） */
  public getCurrentDate(): string {
    return format(Date.now(), 'yyyyMMdd');
  }

  /**
   * 現在時刻をラジコ時間(05:00=1日開始)で返す
   * 遅延補正済み
   */
  public getCurrentRadioTime(): string {
    // 現在時刻の取得
    const date = new Date();
    const time = date.getTime();
    const src = format(time - this.DELAY_msec, 'yyyyMMddHHmmss');

    // "29"は翌日5時までの最大時刻
    return this.convertRadioTime(src, '29');
  }

  /**
   * ラジコ日付（深夜0～5時は前日扱い）
   */
  public getCurrentRadioDate(): string {
    return format(Date.now() - this.OFFSET_msec, 'yyyyMMdd');
  }

  /**
   * ラジコ日付基準で、今日からN日間の日付リストを返す
   * @param begin 例) 0=今日, -6=6日前
   * @param end   例) 0=今日, 6=6日後
   */
  public getRadioWeek(begin: number | string, end: number | string, kanjiFmt: string = 'yyyy年M月d日(E)'): { index: number, date: string, kanji: string }[] {
    // 現在時刻の取得
    const now = Date.now();
    const radioBase = now - this.OFFSET_msec;
    const week = [];

    for (let i = Number(begin); i <= Number(end); i++) {
      const t = radioBase + i * 24 * HOUR_msec;
      week.push({
        // 0=今日
        index: i,
        date : format(t, 'yyyyMMdd'),
        kanji: format(t, kanjiFmt, {locale: ja})
      });
    }
    return week;
  }

  /**
   * 24〜29時表現を通常の日付へ変換
   * 例: 20240201023000 → 20240131263000 (=01/31 26:30)
   * @param src yyyyMMddHHmmss
   */
  public convertRadioTime(src: string, am05: string = ''): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';

    // 深夜0:00〜5:00 → 前日の24:00〜29:00扱い
    if (src.slice(8, 14) <= '050000') {
      // 29:00など特殊値は無視
      if (src.slice(8, 10) != am05) {
        return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d+)$/, (match, y, m, d, h, ms) => {
          const base = new Date(y, m-1, d);
          base.setTime(base.getTime() - 24 * HOUR_msec);
          h = ('0' + (parseInt(h) + 24)).slice(-2);
          return format(base, 'yyyyMMdd') + h + ms;
        });
      }
    }
    return src;
  }

  /**
   * 逆変換：24〜29時を通常の0〜5時へ
   */
  public revConvertRadioTime(src: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';

    if (src.slice(8, 14) >= '240000') {
      return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d+)$/, (match, y, m, d, h, ms) => {
        const base = new Date(y, m-1, d);
        base.setTime(base.getTime() + 24 * HOUR_msec);
        h = ('0' + (parseInt(h) - 24)).slice(-2);
        return format(base, 'yyyyMMdd') + h + ms;
      });
    }
    return src;
  }

  // 以下フォーマット便利関数群（元コード維持）

  public formatTimeString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^\d{8}(\d\d)(\d\d)(\d\d).*$/, fmt);
  }

  public formatTimeString2(srcArray: string[], fmt: string): string {
    let src = '', reg = '';
    for (const s0 of srcArray) {
      const s = s0.padEnd(14, '0');
      src += s.replace(/^\d{8}(\d{6}).*$/, '$1');
      reg += '(\\d{2})(\\d{2})(\\d{2})';
    }
    return src.replace(RegExp(reg), fmt);
  }

  public formatDateString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^(\d{4})(\d\d)(\d\d).*$/, fmt);
  }

  public formatFullString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d).*$/, fmt);
  }

  public formatFullString2(srcArray: string[], fmt: string): string {
    let src = '', reg = '';
    for (const s0 of srcArray) {
      const s = s0.padEnd(14, '0');
      src += s.replace(/^(\d{14}).*$/, '$1');
      reg += '(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})';
    }
    return src.replace(RegExp(reg), fmt);
  }
  
  /**
   * 'yyyyMMddHHmmss'形式の時間差(sec)
   */
  public getTimeSpan(t0: string, t1: string): number {
    const parse = (t: string) => {
      t = t.padEnd(14, '0');
      const y = +t.slice(0, 4), m = +t.slice(4, 6)-1, d = +t.slice(6, 8);
      const h = +t.slice(8,10), min = +t.slice(10,12), s = +t.slice(12,14);
      return new Date(y, m, d, h, min, s).getTime();
    };
    return Math.round((parse(t1) - parse(t0)) / 1000);
  }

  /**
   * 現在時刻が番組範囲内かチェック
   * @returns 0 = 放送中 / プラス = 放送前 / マイナス = 終了後
   */
  public checkProgramTime(ft: string, to: string, currentTime: string): number {
    if (ft <= currentTime && currentTime < to) return 0;
    return this.getTimeSpan(currentTime, ft);
  }

  /**
   * yyyyMMddHHmmss に経過秒を加算
   */
  public addTime(src: string, elapsedSec: number | string): string {
    if (!elapsedSec) return src;
    src = src.padEnd(14, '0');

    return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d).*$/, (match, y, m, d, h, min, s) => {
      const time = new Date(+y, +m-1, +d, +h, +min, +s);
      time.setTime(time.getTime() + Number(elapsedSec) * 1000);
      return format(time, 'yyyyMMddHHmmss');
    });
  }
}

// デフォルト20秒遅延
export const broadcastTimeConverter = new BroadcastTimeConverter(20);
