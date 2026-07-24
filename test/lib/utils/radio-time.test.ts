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

describe('parseRadioTime', () => {
  it('yyyyMMddHHmmssを各要素に分解する', () => {
    expect(parseRadioTime('20250831235959')).toEqual({
      date: '20250831',
      hour: '23',
      minute: '59',
      second: '59',
    });
  });
});

describe('cnvRadioTime', () => {
  it('当日日付と一致する場合はそのまま', () => {
    expect(cnvRadioTime('20250831120000', '20250831')).toBe('20250831120000');
  });

  it('深夜0:00~5:00は前日日付+24時間表記になる', () => {
    // 2025/09/01 02:30:00 は「ラジオ日付」的には2025/08/31の26:30:00として扱う
    expect(cnvRadioTime('20250901023000', '20250831')).toBe('20250831263000');
  });
});

describe('formatTimeString', () => {
  it('HH:mm:ss形式に変換する', () => {
    expect(formatTimeString('20250831050102')).toBe('05:01:02');
  });
});

describe('formatHourMinute', () => {
  it('HH:mm形式に変換する(秒は省略)', () => {
    expect(formatHourMinute('20250831050102')).toBe('05:01');
  });
});

describe('toMinutePrecision', () => {
  it('分単位まで切り詰める', () => {
    expect(toMinutePrecision('20250831050159')).toBe('202508310501');
  });
});

describe('getTimeSpan', () => {
  it('HH:mm:ss形式同士の差を秒単位で返す', () => {
    expect(getTimeSpan('05:00:00', '05:01:30')).toBe(90);
  });

  it('HH:mm形式(秒省略)同士の差も計算できる', () => {
    expect(getTimeSpan('05:00', '06:00')).toBe(3600);
  });

  it('endがbeginより前ならマイナスを返す', () => {
    expect(getTimeSpan('06:00:00', '05:00:00')).toBe(-3600);
  });
});

describe('現在時刻系(形式のみ確認)', () => {
  it('getCurrentDate: yyyyMMdd形式(8桁の数字)を返す', () => {
    expect(getCurrentDate()).toMatch(/^\d{8}$/);
  });

  it('getCurrentRadioTime: yyyyMMddHHmmss形式(14桁の数字)を返す', () => {
    expect(getCurrentRadioTime()).toMatch(/^\d{14}$/);
  });

  it('getCurrentRadioDate: yyyyMMdd形式(8桁の数字)を返す', () => {
    expect(getCurrentRadioDate()).toMatch(/^\d{8}$/);
  });
});
