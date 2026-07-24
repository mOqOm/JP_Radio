import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StationInfo } from '@/models/station-model';
import { isStationRelevantForArea, isDuplicateAreaFreeStation } from '@/logic/station-filter';

function makeStation(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    regionName: '関東',
    bannerUrl: '',
    areaId: 'JP13',
    areaName: 'TOKYO',
    areaKanji: '東京',
    name: 'TBSラジオ',
    asciiName: 'TBS RADIO',
    areaFree: '0',
    ...overrides,
  };
}

test('isStationRelevantForArea: 所属エリアと一致する一般局はtrue', () => {
  const station = makeStation({ areaId: 'JP13', areaFree: '0', regionName: '関東' });
  assert.equal(isStationRelevantForArea(station, 'JP13'), true);
});

test('isStationRelevantForArea: 所属エリアと異なりareaFreeでない一般局はfalse', () => {
  const station = makeStation({ areaId: 'JP13', areaFree: '1', regionName: '関東' });
  assert.equal(isStationRelevantForArea(station, 'JP14'), false);
});

test('isStationRelevantForArea: 所属エリアと異なってもNHK地方局(areaFree===0)はtrue', () => {
  const station = makeStation({ areaId: 'JP13', areaFree: '0', regionName: '関東' });
  assert.equal(isStationRelevantForArea(station, 'JP14'), true);
});

test('isStationRelevantForArea: 全国広域局はJP13取得時のみtrue', () => {
  const station = makeStation({ areaId: 'JP13', areaFree: '1', regionName: '全国' });
  assert.equal(isStationRelevantForArea(station, 'JP13'), true);
  assert.equal(isStationRelevantForArea(station, 'JP14'), false);
});

test('isDuplicateAreaFreeStation: NHK地方局(areaFree===0)で処理済みならtrue', () => {
  const station = makeStation({ areaFree: '0' });
  const doneAreaFree = new Set(['JOAK']);
  assert.equal(isDuplicateAreaFreeStation(station, 'JOAK', doneAreaFree), true);
});

test('isDuplicateAreaFreeStation: NHK地方局でも未処理ならfalse', () => {
  const station = makeStation({ areaFree: '0' });
  const doneAreaFree = new Set<string>();
  assert.equal(isDuplicateAreaFreeStation(station, 'JOAK', doneAreaFree), false);
});

test('isDuplicateAreaFreeStation: areaFreeでない局は処理済みリストにあってもfalse', () => {
  const station = makeStation({ areaFree: '1' });
  const doneAreaFree = new Set(['TBS']);
  assert.equal(isDuplicateAreaFreeStation(station, 'TBS', doneAreaFree), false);
});
