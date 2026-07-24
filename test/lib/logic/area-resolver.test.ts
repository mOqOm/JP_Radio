import { resolveAreaIdArray } from '@/logic/area-resolver';

describe('resolveAreaIdArray', () => {
  it('AreaFree会員なら全国47エリアを返す', () => {
    const result = resolveAreaIdArray('JP13/AreaFree', []);
    expect(result).toHaveLength(47);
    expect(result[0]).toBe('JP1');
    expect(result[46]).toBe('JP47');
  });

  it('AreaFreeでなければ局一覧に実在するエリアIDを返す', () => {
    expect(resolveAreaIdArray('JP13/premium', ['JP13', 'JP14'])).toEqual(['JP13', 'JP14']);
  });

  it('局一覧のエリアIDが空なら自エリア+JP13にフォールバックする', () => {
    expect(resolveAreaIdArray('JP27/premium', [])).toEqual(['JP27', 'JP13']);
  });

  it('myAreaIdが未指定でも局一覧のエリアIDがあればそれを使う', () => {
    expect(resolveAreaIdArray(undefined, ['JP5'])).toEqual(['JP5']);
  });

  it('myAreaIdも局一覧のエリアIDもない場合(既知のエッジケース)', () => {
    // myAreaId未指定 かつ 局一覧が空の場合、自エリアIDにあたる要素がundefinedになる
    // (現状の実装通りの挙動を確認するテスト。実運用では起こりにくい組み合わせ)
    expect(resolveAreaIdArray(undefined, [])).toEqual([undefined, 'JP13']);
  });

  it('AreaFree会員が設定画面でエリアを選択していれば、そのエリアのみを返す', () => {
    expect(resolveAreaIdArray('JP13/AreaFree', [], ['JP13', 'JP27'])).toEqual(['JP13', 'JP27']);
  });

  it('AreaFree会員でも選択エリアが空なら全国47エリアを返す', () => {
    const result = resolveAreaIdArray('JP13/AreaFree', [], []);
    expect(result).toHaveLength(47);
  });
});
