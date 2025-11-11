import { DBUtil } from '@/utils/db.util';

// テスト用データ型
interface TestDoc {
  name: string;
  age: number;
}

describe('DBUtil<T>', () => {
  let db: DBUtil<TestDoc>;

  // 各テスト前にメモリDBを初期化
  beforeEach(() => {
    db = new DBUtil<TestDoc>();
  });

  /**
   * insert + findOne の動作確認
   * 1件挿入し、検索で同じデータが取得できること
   */
  test('Success0001_データを登録し、findOneで取得できること', async () => {
    const doc = { name: 'Alice', age: 25 };
    await db.insert(doc);

    const result = await db.findOne({ name: 'Alice' });

    // Assert
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Alice');
    expect(result?.age).toBe(25);
  });

  /**
   * 複数件 insert + find の動作確認
   * 2件挿入 → 全件取得 → 件数が一致すること
   */
  test('Success0002_複数件 insert し、find で全件取得できること', async () => {
    await db.insert({ name: 'Tom', age: 30 });
    await db.insert({ name: 'John', age: 40 });

    const results = await db.find({});
    // Assert
    expect(results.length).toBe(2);
  });

  /**
   * remove の動作確認
   * 1件削除され、以後 findOne で取得できないこと
   */
  test('Success0003_remove でデータ削除できること', async () => {
    await db.insert({ name: 'Bob', age: 20 });

    const removed = await db.remove({ name: 'Bob' });
    // Assert
    expect(removed).toBe(1);

    const remain = await db.findOne({ name: 'Bob' });
    // Assert
    // ✅ 空オブジェクトを期待
    expect(remain).toEqual({});
  });

  /**
   * count の動作確認
   * 登録件数と count が一致すること
   */
  test('Success0004_count で件数取得できること', async () => {
    await db.insert({ name: 'Ken', age: 35 });
    await db.insert({ name: 'Mike', age: 29 });

    const count = await db.count({});
    // Assert
    expect(count).toBe(2);
  });

  /**
   * ensureIndex の正常動作確認
   * エラーが発生せずにインデックスが張れること
   */
  test('Success0005_ensureIndex がエラーなく実行できること', () => {
    expect(() => db.ensureIndex({ fieldName: 'name', unique: true })).not.toThrow();
  });

  /**
   * unique インデックスの検証
   * 重複 key の insert がエラーになること
   */
  test('Success0006_unique index により重複登録ができないこと', async () => {
    db.ensureIndex({ fieldName: 'name', unique: true });

    await db.insert({ name: 'Sara', age: 22 });

    // Assert
    // もう1件同じ name で insert → 例外になるはず
    await expect(db.insert({ name: 'Sara', age: 30 })).rejects.toThrow();
  });

  /**
   * 削除後の count 確認
   */
  test('Success0007_remove 後に count が減ること', async () => {
    await db.insert({ name: 'Alice', age: 25 });
    await db.insert({ name: 'Bob', age: 30 });

    let count = await db.count({});
    expect(count).toBe(2);

    await db.remove({ name: 'Bob' });

    count = await db.count({});
    expect(count).toBe(1);
  });

  /**
   * 削除後の find 確認
   */
  test('Success0008_remove 後に find で取得できないこと', async () => {
    await db.insert({ name: 'Alice', age: 25 });
    await db.insert({ name: 'Bob', age: 30 });

    await db.remove({ name: 'Bob' });

    const results = await db.find({});
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Alice');
  });
});
