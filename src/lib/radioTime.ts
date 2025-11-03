"use strict";
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

const HOUR_msec = 3600000;

class clsRadioTime {
  private DELAY_msec: number = 0;
  private OFFSET_msec: number = 0;

  constructor(delay: number | string) {
    this.setDelay(delay);
  }

  public setDelay(delay: number | string): void {
    this.DELAY_msec = Number(delay) * 1000;
    this.OFFSET_msec = this.DELAY_msec + 5 * HOUR_msec; // 5hオフセット
  }

  public getCurrentTime(): string {
    return format(Date.now(), 'yyyyMMddHHmmss');
  }

  public getCurrentDate(): string {
    return format(Date.now(), 'yyyyMMdd');
  }

  // ラジオの一日は「05:00～29:00」
  public getCurrentRadioTime(): string {
    const date = new Date();
    const time = date.getTime();
    const src = format(date.setTime(time - this.DELAY_msec), 'yyyyMMddHHmmss');
    return this.convertRadioTime(src, '29');
  }

  // 深夜0:00～5:00は前日
  public getCurrentRadioDate(): string {
    const date = new Date();
    const time = date.getTime() - this.OFFSET_msec;
    return format(date.setTime(time), 'yyyyMMdd');
  }

  // 今日からN日前までの日付配列
  public getRadioWeek(begin: number | string, end: number | string, kanjiFmt: string = 'yyyy年M月d日(E)'): { index: number, date: string, kanji: string }[] {
    const now = new Date()
    const radioTime = now.getTime() - this.OFFSET_msec;
    const week = [];
    for (var i = Number(begin); i <= Number(end); i++) {
      const time = radioTime + i * 24 * HOUR_msec;
      week.push({
        index: i, // 0=今日
        date : format(time, 'yyyyMMdd'),
        kanji: format(time, kanjiFmt, {locale: ja})
      });
    }
    return week;
  }

  // AM0:00～5:00は前日の24:00～29:00
  public convertRadioTime(src: string, am05: string = ''): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    if (src.slice(8, 14) <= '050000') { // HHmmss
      if (src.slice(8, 10) != am05) { // HH
        return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d+)$/, (match, year, month, date, hour, minsec) => {
          var yesterday = new Date(year, month-1, date); // 月は0-11で指定
          yesterday.setTime(yesterday.getTime() - 24 * HOUR_msec);
          hour = ('0' + (parseInt(hour) + 24)).slice(-2);
          return format(yesterday, 'yyyyMMdd') + hour + minsec;
        });
      }
    }
    return src;
  }

  // 24:00～29:00を翌日のAM0:00～5:00に戻す
  public revConvertRadioTime(src: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    if (src.slice(8, 14) >= '240000') { // HHmmss
      return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d+)$/, (match, year, month, date, hour, minsec) => {
        var tomorrow = new Date(year, month-1, date); // 月は0-11で指定
        tomorrow.setTime(tomorrow.getTime() + 24 * HOUR_msec);
        hour = ('0' + (parseInt(hour) - 24)).slice(-2);
        return format(tomorrow, 'yyyyMMdd') + hour + minsec;
      });
    }
    return src;
  }

  // 'yyyyMMddHHmmss' * '$1:$2:$3' => 'HH:mm:ss'
  public formatTimeString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^\d{8}(\d\d)(\d\d)(\d\d).*$/, fmt);
  }

  // ['yyyyMMddHHmmss'] * '$1:$2-$4:$5' => 'HH:mm-HH:mm'
  public formatTimeString2(srcArray: string[], fmt: string): string {
    var src = '', reg = '';
    for (var s of srcArray) {
      s += (s.length < 14) ? '0'.repeat(14 - s.length) : '';
      src += s.replace(/^\d{8}(\d{6}).*$/, '$1');
      reg += '(\\d{2})(\\d{2})(\\d{2})';
    }
    return src.replace(RegExp(reg), fmt);
  }

  // 'yyyyMMddHHmmss' * '$1/$2/$3' => 'yyyy/MM/dd'
  public formatDateString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^(\d{4})(\d\d)(\d\d).*$/, fmt);
  }

  // 'yyyyMMddHHmmss' * '$1/$2/$3 $4:$5' => 'yyyy/MM/dd HH:mm'
  public formatFullString(src: string, fmt: string): string {
    src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
    return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d).*$/, fmt);
  }

  // ['yyyyMMddHHmmss'] * '$1/$2/$3 $4:$5-$10:$11' => 'yyyy/MM/dd HH:mm-HH:mm'
  public formatFullString2(srcArray: string[], fmt: string): string {
    var src = '', reg = '';
    for (var s of srcArray) {
      s += (s.length < 14) ? '0'.repeat(14 - s.length) : '';
      src += s.replace(/^(\d{14}).*$/, '$1');
      reg += '(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})';
    }
    return src.replace(RegExp(reg), fmt);
  }
  
  // 'yyyyMMddHHmmss'形式の時間差(sec)
  public getTimeSpan(t0: string, t1: string): number {
    const ta = [];
    for (var t of [t0, t1]) {
      t += (t.length < 14) ? '0'.repeat(14 - t.length) : '';
      ta.push(t.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d).*$/, (match, year, month, date, hour, min, sec) => {
        const time = new Date(year, month-1, date, hour, min, sec); // 月は0-11で指定
        return String(time.getTime());
      }));
    }
    return Math.round((parseInt(ta[1]) - parseInt(ta[0])) / 1000);
  }

  // 番組時間をチェック('yyyyMMddHHmmss'形式)
  public checkProgramTime(ft: string, to: string, currentTime: string): number {
    if (ft <= currentTime && currentTime < to)  return 0;  // 放送中
    return this.getTimeSpan(currentTime, ft); // 過去:マイナス，未来:プラス(sec)
  }

  // yyyyMMddHHmmss'形式に経過秒を足す
  public addTime(src: string, elapsedSec: number | string): string {
    if (elapsedSec) {
      src += (src.length < 14) ? '0'.repeat(14 - src.length) : '';
      return src.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d).*$/, (match, year, month, date, hour, min, sec) => {
        var time = new Date(year, month-1, date, hour, min, sec); // 月は0-11で指定
        time.setTime(time.getTime() + Number(elapsedSec) * 1000);
        return format(time, 'yyyyMMddHHmmss');
      });
    }
    return src;
  }
}

export const RadioTime = new clsRadioTime(20);
