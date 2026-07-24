import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentDate,
  getCurrentRadioTime,
  getCurrentRadioDate,
  parseRadioTime,
  cnvRadioTime,
  formatTimeString,
  formatHourMinute,
  toMinutePrecision,
  getTimeSpan,
} from '@/utils/radio-time';

test('parseRadioTime: yyyyMMddHHmmssを各要素に分解する', () => {
  assert.deepEqual(parseRadioTime('20250831235959'), {
    date: '20250831',
    hour: '23',
    minute: '59',
    second: '59',
  });
});

test('cnvRadioTime: 当日日付と一致する場合はそのまま', () => {
  assert.equal(cnvRadioTime('20250831120000', '20250831'), '20250831120000');
});

test('cnvRadioTime: 深夜0:00~5:00は前日日付+24時間表記になる', () => {
  // 2025/09/01 02:30:00 は「ラジオ日付」的には2025/08/31の26:30:00として扱う
  assert.equal(cnvRadioTime('20250901023000', '20250831'), '20250831263000');
});

test('formatTimeString: HH:mm:ss形式に変換する', () => {
  assert.equal(formatTimeString('20250831050102'), '05:01:02');
});

test('formatHourMinute: HH:mm形式に変換する(秒は省略)', () => {
  assert.equal(formatHourMinute('20250831050102'), '05:01');
});

test('toMinutePrecision: 分単位まで切り詰める', () => {
  assert.equal(toMinutePrecision('20250831050159'), '202508310501');
});

test('getTimeSpan: HH:mm:ss形式同士の差を秒単位で返す', () => {
  assert.equal(getTimeSpan('05:00:00', '05:01:30'), 90);
});

test('getTimeSpan: HH:mm形式(秒省略)同士の差も計算できる', () => {
  assert.equal(getTimeSpan('05:00', '06:00'), 3600);
});

test('getTimeSpan: endがbeginより前ならマイナスを返す', () => {
  assert.equal(getTimeSpan('06:00:00', '05:00:00'), -3600);
});

test('getCurrentDate: yyyyMMdd形式(8桁の数字)を返す', () => {
  assert.match(getCurrentDate(), /^\d{8}$/);
});

test('getCurrentRadioTime: yyyyMMddHHmmss形式(14桁の数字)を返す', () => {
  assert.match(getCurrentRadioTime(), /^\d{14}$/);
});

test('getCurrentRadioDate: yyyyMMdd形式(8桁の数字)を返す', () => {
  assert.match(getCurrentRadioDate(), /^\d{8}$/);
});
