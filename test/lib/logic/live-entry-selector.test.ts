import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLiveEntry } from '@/logic/live-entry-selector';

test('selectLiveEntry: ログイン済みならareafree=1のライブ配信を優先する', () => {
  const entries = [
    { '@timefree': '0', '@areafree': '0', url: 'free' },
    { '@timefree': '0', '@areafree': '1', url: 'premium' },
  ];
  const chosen = selectLiveEntry(entries, true);
  assert.equal(chosen.url, 'premium');
});

test('selectLiveEntry: 未ログインならareafree=0のライブ配信を優先する', () => {
  const entries = [
    { '@timefree': '0', '@areafree': '0', url: 'free' },
    { '@timefree': '0', '@areafree': '1', url: 'premium' },
  ];
  const chosen = selectLiveEntry(entries, false);
  assert.equal(chosen.url, 'free');
});

test('selectLiveEntry: 希望するareafreeが無ければライブ配信の先頭にフォールバックする', () => {
  const entries = [
    { '@timefree': '0', '@areafree': '0', url: 'free' },
  ];
  const chosen = selectLiveEntry(entries, true);
  assert.equal(chosen.url, 'free');
});

test('selectLiveEntry: timefree!==0(タイムフリー)のエントリは除外する', () => {
  const entries = [
    { '@timefree': '1', '@areafree': '1', url: 'timefree' },
    { '@timefree': '0', '@areafree': '0', url: 'live' },
  ];
  const chosen = selectLiveEntry(entries, true);
  assert.equal(chosen.url, 'live');
});

test('selectLiveEntry: rawEntriesが単一オブジェクトでも扱える', () => {
  const entry = { '@timefree': '0', '@areafree': '0', url: 'only' };
  const chosen = selectLiveEntry(entry, false);
  assert.equal(chosen.url, 'only');
});

test('selectLiveEntry: ライブ配信が1件もなければundefinedを返す', () => {
  assert.equal(selectLiveEntry(undefined, true), undefined);
});

test('selectLiveEntry: エントリはあってもすべてタイムフリーならundefinedを返す', () => {
  const entries = [{ '@timefree': '1', '@areafree': '1', url: 'timefree' }];
  assert.equal(selectLiveEntry(entries, true), undefined);
});
