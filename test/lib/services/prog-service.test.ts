import RdkProg from '@/services/prog-service';
import { httpClient } from '@/utils/http-client';
import { LoggerEx } from '@/utils/logger';

jest.mock('@/utils/http-client', () => ({
  httpClient: { get: jest.fn() },
}));

const mockGet = httpClient.get as jest.Mock;

/**
 * `PROG_DAILY_STATION_URL`(program/station/date/{date}/{station}.xml)相当のレスポンス。
 */
function dailyStationXml(id: string, ft: string, to: string, title: string): string {
  return dailyStationXmlMulti([{ id, ft, to, title }]);
}

/**
 * 複数の`<prog>`要素を持つ`PROG_DAILY_STATION_URL`相当のレスポンス。
 * TBS等の長時間番組が1時間ごとに区切られ、同一`id`を持つケースの再現に使う。
 */
function dailyStationXmlMulti(progs: Array<{ id: string; ft: string; to: string; title: string }>): string {
  const progsXml = progs
    .map(
      (p) => `        <prog id="${p.id}" ft="${p.ft}" to="${p.to}">
          <title>${p.title}</title>
          <pfm>パーソナリティ</pfm>
          <img>http://example.com/img.png</img>
        </prog>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<radiko>
  <stations>
    <station>
      <progs>
${progsXml}
      </progs>
    </station>
  </stations>
</radiko>`;
}

describe('RdkProg (30日表示期間で週次APIの範囲外の日付を補う機能)', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('getStationProgramsForDate: 指定日のURLを組み立て(date, station)の順で呼び、番組データを返す', async () => {
    mockGet.mockResolvedValue({
      body: dailyStationXml('1234', '20260601050000', '20260601060000', '朝の番組'),
      headers: {},
      statusCode: 200,
    });

    const logger = new LoggerEx(console as unknown as Console);
    const prog = new RdkProg(logger);

    const result = await prog.getStationProgramsForDate('TBS', '20260601');

    expect(mockGet).toHaveBeenCalledTimes(1);
    const calledUrl = mockGet.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/20260601/TBS.xml');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      station: 'TBS',
      id: 'TBS12340500',
      ft: '20260601050000',
      tt: '20260601060000',
      title: '朝の番組',
    });
  });

  it('getStationProgramsForDates: 複数日分を並列取得し、結果を1つの配列にまとめる', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('/20260610/')) {
        return { body: dailyStationXml('1', '20260610050000', '20260610060000', '番組A'), headers: {}, statusCode: 200 };
      }
      if (url.includes('/20260611/')) {
        return { body: dailyStationXml('2', '20260611050000', '20260611060000', '番組B'), headers: {}, statusCode: 200 };
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const logger = new LoggerEx(console as unknown as Console);
    const prog = new RdkProg(logger);

    const result = await prog.getStationProgramsForDates('TBS', ['20260610', '20260611']);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.map((p) => p.title).sort()).toEqual(['番組A', '番組B']);
  });

  it('同一progId対策: 同じ@idを持つ1時間区切りの長時間番組(TBS等)が両方ともDBに登録される', async () => {
    mockGet.mockResolvedValue({
      body: dailyStationXmlMulti([
        { id: '9999', ft: '20260601010000', to: '20260601020000', title: '長時間番組(1コマ目)' },
        { id: '9999', ft: '20260601020000', to: '20260601030000', title: '長時間番組(2コマ目)' },
      ]),
      headers: {},
      statusCode: 200,
    });

    const logger = new LoggerEx(console as unknown as Console);
    const errorSpy = jest.spyOn(logger, 'error');
    const prog = new RdkProg(logger);

    const result = await prog.getStationProgramsForDate('TBS', '20260601');

    // 同一@idでも放送開始時刻(HHmm)が異なるためidが別々になり、どちらも破棄されずに登録される
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id).sort()).toEqual(['TBS99990100', 'TBS99990200']);
    expect(errorSpy).not.toHaveBeenCalledWith('PRG_E004', expect.anything());
  });

  it('findProgramsInRange: サーバーへ問い合わせずDBキャッシュのみから指定日付範囲の番組を返す', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('/20260620/')) {
        return { body: dailyStationXml('1', '20260620050000', '20260620060000', '範囲内'), headers: {}, statusCode: 200 };
      }
      if (url.includes('/20260625/')) {
        return { body: dailyStationXml('2', '20260625050000', '20260625060000', '範囲外'), headers: {}, statusCode: 200 };
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const logger = new LoggerEx(console as unknown as Console);
    const prog = new RdkProg(logger);

    // 事前にDBへ2日分投入(範囲内の20260620と、範囲外の20260625)
    await prog.getStationProgramsForDate('TBS', '20260620');
    await prog.getStationProgramsForDate('TBS', '20260625');
    mockGet.mockClear();

    const result = await prog.findProgramsInRange('TBS', '20260619', '20260621');

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.map((p) => p.title)).toEqual(['範囲内']);
  });
});
