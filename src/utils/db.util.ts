import Datastore from 'nedb-promises';

/**
 * NeDB を扱うユーティリティクラス
 * TypeScript のジェネリクスを利用し、任意の型 T を DB のドキュメントとして扱う
 * inMemoryOnly(true) により、メモリDBとして動作（永続化しない）
 */
export class DBUtil<T> {
  private db: Datastore<T>;

  constructor() {
    // メモリ内データベース
    this.db = Datastore.create({ inMemoryOnly: true });
  }

  /**
   * データを挿入する
   * @param doc 挿入するオブジェクト
   */
  public async insert(doc: T): Promise<T> {
    return await this.db.insert(doc);
  }

  /**
   * 1件だけ検索する（見つからない場合は空のオブジェクトを返す）
   * @param query 検索条件
   */
  public async findOne(query: any): Promise<T> {
    const result = await this.db.findOne(query);
    return result === null ? ({} as T) : (result as T);
  }

  /**
   * 複数件検索する
   * @param query 検索条件
   */
  public async find(query: any): Promise<T[]> {
    return await this.db.find(query) as T[];
  }

  /**
   * データ削除
   * @param query 削除条件
   * @param opts {multi: true} で複数削除
   */
  public async remove(query: any, opts = { multi: true }): Promise<number> {
    return await this.db.remove(query, opts);
  }

  /**
   * 条件に一致する件数を取得
   * @param query カウント条件
   */
  public async count(query: any): Promise<number> {
    return await this.db.count(query);
  }

  /**
   * インデックスを作成する
   * @param options { fieldName: string, unique?: boolean } など
   */
  public ensureIndex(options: any): void {
    this.db.ensureIndex(options);
  }
}
