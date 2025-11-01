import { broadcastTimeConverter } from '../../src/utils/broadcast-time-converter.util';

describe('BroadcastTimeConverter', () => {
  beforeEach(() => {
    // 固定日時: 2025-01-10 04:30:00（深夜帯）
    jest.useFakeTimers().setSystemTime(new Date('2025-01-10T04:30:00+09:00'));
    // 遅延の設定
    broadcastTimeConverter.setDelay(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('Success0001_現在時刻を取得', () => {
    const result = broadcastTimeConverter.getCurrentTime();
    process.stdout.write(`getCurrentTime: ${result}\n`);
    // Assert
    expect(result).toBe('20250110043000');
  });

  test('Success0002_現在日付を取得', () => {
    const result = broadcastTimeConverter.getCurrentDate();
    process.stdout.write(`getCurrentDate: ${result}\n`);
    // Assert
    expect(result).toBe('20250110');
  });

  test('Success0003_ラジオ時刻取得 (05:00跨ぎ変換)', () => {
    const result = broadcastTimeConverter.getCurrentRadioTime();
    process.stdout.write(`getCurrentRadioTime: ${result}\n`);
    // Assert
    // 深夜4:30は前日の28:30扱い
    expect(result.slice(0, 8)).toBe('20250109'); // 前日
    expect(result.slice(8)).toBe('283000'); // 28:30:00
  });

  test('Success0004_ラジオ日付取得 (深夜時ズレ)', () => {
    const result = broadcastTimeConverter.getCurrentRadioDate();
    process.stdout.write(`getCurrentRadioDate: ${result}\n`);
    // Assert
    expect(result).toBe('20250109'); // 前日
  });

  test('Success0005_深夜 → 24時表現変換 convertRadioTime()', () => {
    const result = broadcastTimeConverter.convertRadioTime('20250110023000');
    process.stdout.write(`convertRadioTime: ${result}\n`);
    // Assert
    expect(result).toBe('20250109263000'); // 前日 26:30:00
  });

  test('Success0006_24-29時 → 通常時間 revConvertRadioTime()', () => {
    const result = broadcastTimeConverter.revConvertRadioTime('20250109263000');
    process.stdout.write(`revConvertRadioTime: ${result}\n`);
    // Assert
    expect(result).toBe('20250110023000'); // 当日 02:30:00
  });

  test('Success0007_時刻フォーマット', () => {
    const result = broadcastTimeConverter.formatTimeString('20250110043000', '$1:$2:$3');
    process.stdout.write(`formatTimeString: ${result}\n`);
    // Assert
    expect(result).toBe('04:30:00');
  });

  test('Success0008_日付フォーマット', () => {
    const result = broadcastTimeConverter.formatDateString('20250110043000', '$1/$2/$3');
    process.stdout.write(`formatDateString: ${result}\n`);
    // Assert
    expect(result).toBe('2025/01/10');
  });

  test('Success0009_時間差計算', () => {
    const sec = broadcastTimeConverter.getTimeSpan('20250110040000', '20250110043000');
    process.stdout.write(`getTimeSpan: ${sec}\n`);
    // Assert
    expect(sec).toBe(1800); // 30分
  });

  test('Success0010_番組時間チェック（放送中）', () => {
    const result = broadcastTimeConverter.checkProgramTime('20250110040000', '20250110050000', '20250110043000');
    process.stdout.write(`checkProgramTime(放送中): ${result}\n`);
    // Assert
    expect(result).toBe(0);
  });

  test('Success0011_番組時間チェック（未来）', () => {
    const result = broadcastTimeConverter.checkProgramTime('20250110050000', '20250110060000', '20250110043000');
    process.stdout.write(`checkProgramTime(未来): ${result}\n`);
    // Assert
    expect(result).toBeGreaterThan(0);
  });

  test('Success0012_時間加算', () => {
    const result = broadcastTimeConverter.addTime('20250110040000', 3600);
    process.stdout.write(`addTime: ${result}\n`);
    // Assert
    expect(result).toBe('20250110050000');
  });
});
