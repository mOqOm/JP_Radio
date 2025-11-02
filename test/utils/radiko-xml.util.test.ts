import { RadikoXmlUtil } from '../../src/utils/radiko-xml.util';
import { DBUtil } from '../../src/utils/db.util';
import { RadikoProgramData } from '../../src/models/radiko-program.model';

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

  test('XMLをパースし、DBに番組が登録されること', async () => {
    const stations = await xmlUtil.parseAndSavePrograms(sampleXML);

    expect(stations.has('STATION1')).toBe(true);

    const saved = await db.find({ stationId: 'STATION1' });

    // 2件: 番組本体 + 29時まで補完
    expect(saved.length).toBe(2);

    const main = saved.find(p => p.title === 'Morning Show');
    expect(main).toBeDefined();
    expect(main?.pfm).toBe('DJ Alice');
  });

  test('skipStations に含まれる局はスキップされること', async () => {
    const skip = new Set<string>(['STATION1']);

    const stations = await xmlUtil.parseAndSavePrograms(sampleXML, skip);

    expect(stations.size).toBe(0);

    const saved = await db.find({}); // 全件
    expect(saved.length).toBe(0);
  });

  test('番組終了後の隙間が補完されること', async () => {
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

    // ---- 追加: 全件出力 ----
    process.stdout.write('--- STATION2 records ---\n');
    saved.forEach((rec, i) => {
      process.stdout.write(
        `${i}: ${JSON.stringify(rec)}\n`
      );
    });
    process.stdout.write('-------------------------\n');
    // -----------------------

    // A(5:00→5:10) → 隙間(5:10→5:20) → B → 29時補完 → 計4件
    expect(saved.length).toBe(4);

    const gap = saved.find(p => p.title === '');
    expect(gap).toBeDefined();
    expect(gap?.ft).toBe('20250101051000');
    expect(gap?.to).toBe('20250101052000');
  });

  test('XMLパースエラー時に例外が投げられること', async () => {
    const invalidXML = `<bad></tag>`;

    await expect(xmlUtil.parseAndSavePrograms(invalidXML))
      .rejects.toThrow();
  });
});
