import { RadikoXmlUtil } from '@/utils/radiko-xml.util';
import { DBUtil } from '@/utils/db.util';
import { RadikoProgramData } from '@/models/radiko-program.model';

describe('RadikoXmlUtil', () => {
  let db: DBUtil<RadikoProgramData>;
  let xmlUtil: RadikoXmlUtil;

  beforeEach(() => {
    db = new DBUtil<RadikoProgramData>();
    xmlUtil = new RadikoXmlUtil(db);
  });

  const sampleXML = `
  <radiko>
    <stations>
      <station id="STATION1">
        <progs>
          <prog ft="20250101050000" to="20250101053000" id="A">
            <title>Morning Show</title>
            <info>News & Talk</info>
            <pfm>DJ Alice</pfm>
            <img>http://example.com/a.jpg</img>
          </prog>
        </progs>
      </station>
    </stations>
  </radiko>`;

  test('Success0001_XMLをパースし、DBに番組が登録されること', async () => {
    const stations = await xmlUtil.parseAndSavePrograms(sampleXML);

    expect(stations.has('STATION1')).toBe(true);

    const saved = await db.find({ stationId: 'STATION1' });

    // 2件: 番組本体 + 29時まで補完
    expect(saved.length).toBe(2);

    const main = saved.find(p => p.title === 'Morning Show');
    expect(main).toBeDefined();
    expect(main?.pfm).toBe('DJ Alice');
  });

  test('Success0002_skipStations に含まれる局はスキップされること', async () => {
    const skip = new Set<string>(['STATION1']);

    const stations = await xmlUtil.parseAndSavePrograms(sampleXML, skip);

    expect(stations.size).toBe(0);

    // 全件
    const saved = await db.find({});
    expect(saved.length).toBe(0);
  });

  test('Success0003_番組終了後の隙間が補完されること（順序も確認）', async () => {
    const xmlWithGap = `
    <radiko>
      <stations>
        <station id="STATION2">
          <progs>
            <prog ft="20250101050000" to="20250101051000" id="A">
              <title>A</title>
            </prog>
            <prog ft="20250101052000" to="20250101053000" id="B">
              <title>B</title>
            </prog>
          </progs>
        </station>
      </stations>
    </radiko>`;

    await xmlUtil.parseAndSavePrograms(xmlWithGap);

    const saved = await db.find({ stationId: 'STATION2' });
    // ソートをする
    saved.sort((a, b) => a.ft.localeCompare(b.ft));

    // A → 隙間 → B → 29時補完 → 計4件
    expect(saved.length).toBe(4);

    // 順序確認
    expect(saved[0].title).toBe('A');
    expect(saved[1].title).toBe(''); // 隙間
    expect(saved[2].title).toBe('B');
    expect(saved[3].title).toBe(''); // 29時補完

    // 隙間の時刻確認
    const gap = saved[1];
    expect(gap.ft).toBe('20250101051000');
    expect(gap.to).toBe('20250101052000');

    // 29時補完の時刻確認
    const lastGap = saved[3];
    expect(lastGap.ft).toBe('20250101053000');
    expect(lastGap.to).toBe('20250101290000');
  });

  test('Failure0001_XMLパースエラー時に例外が投げられること', async () => {
    const invalidXML = `<bad></tag>`;

    await expect(xmlUtil.parseAndSavePrograms(invalidXML))
      .rejects.toThrow();
  });
});
