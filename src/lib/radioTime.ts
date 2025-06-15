import { format } from 'date-fns';

export const DELAY_sec = 20;   // 約20s遅延（実測）
const DELAY_msec = DELAY_sec * 1000;
const OFFSET_msec = 5 * 3600 * 1000 + DELAY_msec; // 5hオフセット

export function getCurrentTime(): string {
  return format(new Date(), 'yyyyMMddHHmmss');
}

export function getCurrentDate(): string {
  return format(new Date(), 'yyyyMMdd');
}

// ラジオの一日は「05:00～29:00」
export function getCurrentRadioTime(): string {
  var date = new Date();
  var time = date.getTime();
  const src = format(date.setTime(time - DELAY_msec), 'yyyyMMddHHmmss');
  const today = format(date.setTime(time - OFFSET_msec), 'yyyyMMdd');
  return cnvRadioTime(src, today);
}

// 深夜0:00～5:00は前日
export function getCurrentRadioDate(): string {
  var date = new Date();
  const time = date.getTime() - OFFSET_msec;
  return format(date.setTime(time), 'yyyyMMdd');
}

// 深夜0:00～5:00は日付を変えずに24:00～29:00
export function cnvRadioTime(src: string, today: string): string {
  var d = src.substr(0, 8);  // yyyyMMdd
  var h = src.substr(8, 2);  // HH
  const d0 = today.substr(0, 8);
  if(d != d0) {
    h = String(parseInt(h) + 24);
    d = d0;
  }
  return d + h + src.substr(10);
}

// 'yyyyMMddHHmmss' => 'HH:mm:ss'
export function formatTimeString(t: string): string {
  const h = t.substr( 8, 2);
  const m = t.substr(10, 2);
  const s = t.substr(12, 2);
  return `${h}:${m}:${s}`;
}

// 'HH:mm:ss'形式の時間差(sec)
export function getTimeSpan(begin: string, end: string): number {
  const [h0, m0, s0] = `${begin}:0:0`.split(':');
  const [h1, m1, s1] = `${end  }:0:0`.split(':');
  const t0 = parseInt(h0) * 3600 + parseInt(m0) * 60 + parseInt(s0);
  const t1 = parseInt(h1) * 3600 + parseInt(m1) * 60 + parseInt(s1);
  return t1-t0;
}
