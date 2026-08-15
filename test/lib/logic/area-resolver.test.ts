import { resolveAreaIdArray, resolveAreaFilter } from '@/logic/area-resolver';
import { NATIONWIDE_AREA_ID } from '@/consts/area-name';

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

  it('設定画面でエリアを選択していれば、会員種別によらずそのエリアのみを返す(選択にJP13を含む場合)', () => {
    expect(resolveAreaIdArray('JP13/AreaFree', [], ['JP13', 'JP27'])).toEqual(['JP13', 'JP27']);
  });

  it('AreaFree会員でも選択エリアが空なら全国47エリアを返す', () => {
    const result = resolveAreaIdArray('JP13/AreaFree', [], []);
    expect(result).toHaveLength(47);
  });

  it('非AreaFree会員(無料プランなど)でもエリアを選択していれば、そのエリアのみを返す(NATIONWIDE_AREA_ID未選択ならJP13は加えない)', () => {
    expect(resolveAreaIdArray('JP13/Free', ['JP1', 'JP2', 'JP13'], ['JP1', 'JP2'])).toEqual(['JP1', 'JP2']);
  });

  it('選択エリアにNATIONWIDE_AREA_IDが含まれていなければ、JP13は加えない', () => {
    expect(resolveAreaIdArray('JP13/Free', [], ['JP1', 'JP27'])).toEqual(['JP1', 'JP27']);
  });

  it('選択エリアにNATIONWIDE_AREA_ID(「全国」)が含まれていれば、それを除いてJP13を加える', () => {
    expect(resolveAreaIdArray('JP13/Free', [], ['JP1', NATIONWIDE_AREA_ID])).toEqual(['JP1', 'JP13']);
  });

  it('未ログイン(myAreaIdの会員種別が空文字列)時は、選択エリアに自エリアが含まれていなくても自エリアを加える(局一覧が自エリアのみのケース対応)', () => {
    expect(resolveAreaIdArray('JP27/', [], ['JP1'])).toEqual(['JP1', 'JP27']);
  });

  it('ログイン済みなら会員種別を問わず自エリアを強制的には加えない', () => {
    expect(resolveAreaIdArray('JP27/premium', [], ['JP1'])).toEqual(['JP1']);
  });
});

describe('resolveAreaFilter', () => {
  it('エリアを選択していれば、会員種別によらずそのエリアID集合を返す(局一覧を絞り込む)', () => {
    const result = resolveAreaFilter(['JP27']);
    expect(result).toEqual(new Set(['JP27']));
  });

  it('選択エリアが空なら絞り込みなし(null)を返す', () => {
    expect(resolveAreaFilter([])).toBeNull();
  });

  it('NATIONWIDE_AREA_ID(「全国」)も他のエリアIDと同様にそのまま集合に含める', () => {
    const result = resolveAreaFilter(['JP27', NATIONWIDE_AREA_ID]);
    expect(result).toEqual(new Set(['JP27', NATIONWIDE_AREA_ID]));
  });
});
