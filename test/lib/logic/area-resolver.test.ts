import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAreaIdArray } from '@/logic/area-resolver';

test('resolveAreaIdArray: AreaFree会員なら全国47エリアを返す', () => {
  const result = resolveAreaIdArray('JP13/AreaFree', []);
  assert.equal(result.length, 47);
  assert.equal(result[0], 'JP1');
  assert.equal(result[46], 'JP47');
});

test('resolveAreaIdArray: AreaFreeでなければ局一覧に実在するエリアIDを返す', () => {
  const result = resolveAreaIdArray('JP13/premium', ['JP13', 'JP14']);
  assert.deepEqual(result, ['JP13', 'JP14']);
});

test('resolveAreaIdArray: 局一覧のエリアIDが空なら自エリア+JP13にフォールバックする', () => {
  const result = resolveAreaIdArray('JP27/premium', []);
  assert.deepEqual(result, ['JP27', 'JP13']);
});

test('resolveAreaIdArray: myAreaIdが未指定でも局一覧のエリアIDがあればそれを使う', () => {
  const result = resolveAreaIdArray(undefined, ['JP5']);
  assert.deepEqual(result, ['JP5']);
});

test('resolveAreaIdArray: myAreaIdも局一覧のエリアIDもない場合(既知のエッジケース)', () => {
  // myAreaId未指定 かつ 局一覧が空の場合、自エリアIDにあたる要素がundefinedになる
  // (現状の実装通りの挙動を確認するテスト。実運用では起こりにくい組み合わせ)
  const result = resolveAreaIdArray(undefined, []);
  assert.deepEqual(result, [undefined, 'JP13']);
});
