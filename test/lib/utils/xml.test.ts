import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toArray } from '@/utils/xml';

test('toArray: 配列はそのまま返す', () => {
  const input = [{ id: '1' }, { id: '2' }];
  assert.deepEqual(toArray(input), input);
});

test('toArray: 単一オブジェクトは配列に包む', () => {
  const input = { id: '1' };
  assert.deepEqual(toArray(input), [input]);
});

test('toArray: undefinedは空配列にする', () => {
  assert.deepEqual(toArray(undefined), []);
});

test('toArray: 空配列はそのまま空配列', () => {
  assert.deepEqual(toArray([]), []);
});
