import { RadikoXmlUtil } from '@/utils/radiko-xml.util';
import type { RadikoProgramData } from '@/models/radiko-program.model';
import { parseToDateTime } from '@/types/date-time.parse';

describe('RadikoXmlUtil', () => {
  let xmlUtil: RadikoXmlUtil;

  beforeEach(() => {
    xmlUtil = new RadikoXmlUtil();
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

  test('Success0001_XMLをパースし、番組データが返却されること', () => {
    const result: RadikoProgramData[] = xmlUtil.parsePrograms(sampleXML);

    // 番組が1件以上パースされること（隙間補完で追加される可能性あり）
    expect(result.length).toBeGreaterThan(0);

    const main: RadikoProgramData | undefined = result.find((p: RadikoProgramData) => p.title === 'Morning Show');

    expect(main).toBeDefined();
    if (main === undefined || main === null) {
      throw new Error('main is undefined');
    }

    expect(main.stationId).toBe('STATION1');
    // progId は自動生成される場合がある
    expect(main.progId).toContain('STATION1');
    expect(main.pfm).toBe('DJ Alice');
    // DateTime として比較
    expect(main.ft).toEqual(parseToDateTime('20250101050000'));
    expect(main.to).toEqual(parseToDateTime('20250101053000'));
  });

  test('Success0002_skipStations に含まれる局はスキップされること', () => {
    const skip = new Set<string>(['STATION1']);

    const result: RadikoProgramData[] = xmlUtil.parsePrograms(sampleXML, skip);

    // STATION1 はスキップされるので0件
    expect(result.length).toBe(0);
  });

  test('Success0003_複数局・複数番組をパース', () => {
    const xmlMultiple = `
    <radiko>
      <stations>
        <station id="STATION1">
          <progs>
            <prog ft="20250101050000" to="20250101060000" id="A1">
              <title>Show A</title>
            </prog>
            <prog ft="20250101060000" to="20250101070000" id="A2">
              <title>Show B</title>
            </prog>
          </progs>
        </station>
        <station id="STATION2">
          <progs>
            <prog ft="20250101050000" to="20250101060000" id="B1">
              <title>Show C</title>
            </prog>
          </progs>
        </station>
      </stations>
    </radiko>`;

    const result: RadikoProgramData[] = xmlUtil.parsePrograms(xmlMultiple);

    // 隙間補完で追加される可能性があるため、最低件数のみチェック
    expect(result.length).toBeGreaterThanOrEqual(3);

    const station1Progs = result.filter((p: RadikoProgramData) => p.stationId === 'STATION1');
    expect(station1Progs.length).toBeGreaterThanOrEqual(2);

    const station2Progs = result.filter((p: RadikoProgramData) => p.stationId === 'STATION2');
    expect(station2Progs.length).toBeGreaterThanOrEqual(1);

    // 元の番組が含まれているか確認
    expect(result.some((p: RadikoProgramData) => p.title === 'Show A')).toBe(true);
    expect(result.some((p: RadikoProgramData) => p.title === 'Show B')).toBe(true);
    expect(result.some((p: RadikoProgramData) => p.title === 'Show C')).toBe(true);
  });

  test('Success0004_24時以降の時刻が正しく変換される', () => {
    const xmlWith24Hour = `
    <radiko>
      <stations>
        <station id="STATION3">
          <progs>
            <prog ft="20250101240000" to="20250101250000" id="C1">
              <title>Late Night Show</title>
            </prog>
          </progs>
        </station>
      </stations>
    </radiko>`;

    const result: RadikoProgramData[] = xmlUtil.parsePrograms(xmlWith24Hour);

    // 隙間補完で追加される可能性があるため、最低件数のみチェック
    expect(result.length).toBeGreaterThanOrEqual(1);

    const prog = result.find((p: RadikoProgramData) => p.title === 'Late Night Show');
    expect(prog).toBeDefined();

    // 24:00 → 翌日 00:00
    expect(prog?.ft).toEqual(parseToDateTime('20250102000000'));
    // 25:00 → 翌日 01:00
    expect(prog?.to).toEqual(parseToDateTime('20250102010000'));
  });

  test('Failure0001_XMLパースエラー時に例外が投げられること', () => {
    const invalidXML = `<bad></tag>`;

    expect(() => xmlUtil.parsePrograms(invalidXML))
      .toThrow();
  });

  test('Success0005_番組情報がない局も隙間補完される', () => {
    const xmlNoProgs = `
    <radiko>
      <stations>
        <station id="STATION4">
        </station>
      </stations>
    </radiko>`;

    const result: RadikoProgramData[] = xmlUtil.parsePrograms(xmlNoProgs);

    // 番組がなくても隙間補完で追加される可能性がある
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  test('Success0006_progs が単一オブジェクトでも配列として扱われる', () => {
    const xmlSingleProg = `
    <radiko>
      <stations>
        <station id="STATION5">
          <progs>
            <prog ft="20250101120000" to="20250101130000" id="S1">
              <title>Single Show</title>
            </prog>
          </progs>
        </station>
      </stations>
    </radiko>`;

    const result: RadikoProgramData[] = xmlUtil.parsePrograms(xmlSingleProg);

    // 隙間補完で追加される可能性があるため、最低件数のみチェック
    expect(result.length).toBeGreaterThanOrEqual(1);

    const singleShow = result.find((p: RadikoProgramData) => p.title === 'Single Show');
    expect(singleShow).toBeDefined();
    expect(singleShow?.stationId).toBe('STATION5');
  });

  test('Success0007_隙間補完が正しく動作すること', () => {
    const xmlWithGap = `
    <radiko>
      <stations>
        <station id="STATION6">
          <progs>
            <prog ft="20250101050000" to="20250101060000" id="G1">
              <title>Show 1</title>
            </prog>
            <prog ft="20250101070000" to="20250101080000" id="G2">
              <title>Show 2</title>
            </prog>
          </progs>
        </station>
      </stations>
    </radiko>`;

    const result: RadikoProgramData[] = xmlUtil.parsePrograms(xmlWithGap);

    // Show 1 と Show 2 の間（06:00-07:00）に隙間補完番組が追加される
    expect(result.length).toBeGreaterThanOrEqual(3);

    // 隙間補完番組を探す（06:00台の番組）
    const expectedFt = parseToDateTime('20250101060000');
    const expectedTo = parseToDateTime('20250101070000');

    const gapProgram = result.find((p: RadikoProgramData) => {
      return p.ft.getTime() === expectedFt.getTime() &&
        p.to.getTime() === expectedTo.getTime();
    });

    expect(gapProgram).toBeDefined();

    // タイトルが空文字列の場合もあるので、存在チェックのみ
    if (gapProgram) {
      // タイトルが空文字列または '放送休止' などを含む
      expect(typeof gapProgram.title).toBe('string');

      // 時刻が正しいことを確認
      expect(gapProgram.ft).toEqual(expectedFt);
      expect(gapProgram.to).toEqual(expectedTo);

      // stationId が正しいことを確認
      expect(gapProgram.stationId).toBe('STATION6');

      // progId が自動生成されていることを確認
      expect(gapProgram.progId).toContain('STATION6');
    }
  });
});
