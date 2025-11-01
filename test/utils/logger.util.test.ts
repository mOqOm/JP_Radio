// LoggerEx クラスをテスト対象としてインポート
import { LoggerEx } from '../../src/utils/logger.util';
// Volumio 標準 Logger 型をインポート（モック用）
import { Logger } from 'volumio-logger';
import { messageHelper } from '../../src/utils/message-helper.util';

/**
 * LoggerEx のユニットテスト
 */
describe('LoggerEx', () => {
  let logger: LoggerEx;

  /**
   * 各テスト前に LoggerEx のインスタンスを作成
   * dummyLogger は Jest のモック関数を持つ簡易 Logger
   */
  beforeEach(() => {
    //時間を指定
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-10-31T23:55:10.000Z');

    // LoggerEx のインスタンス作成
    const dummyLogger: Logger = {
      info: jest.fn(),   // info ログ用モック
      warn: jest.fn(),   // warn ログ用モック
      error: jest.fn(),  // error ログ用モック
      debug: jest.fn()   // debug ログ用モック
    } as unknown as Logger;

    // messageHelper.get をモックして、渡された params を文字列に変換して返す
    jest.spyOn(messageHelper, 'get').mockImplementation((id: string, params?: any) => {
      const template = (messageHelper as any).messages[id] ?? `[Unknown message ID: ${id}]`;

      if (params === undefined || params === null) return template;

      // 配列 → {0},{1},...
      if (Array.isArray(params)) {
        return template.replace(/\{(\d+)\}/g, (_: string, idx: string) => {
          const i = parseInt(idx, 10);
          return params[i] !== undefined ? String(params[i]) : `{${i}}`;
        });
      }

      // オブジェクト → 名前付き置換 + JSON化
      if (typeof params === 'object' && !Array.isArray(params)) {
        // テンプレートのキー置換
        let replaced = template.replace(/\{(\w+)\}/g, (_: string, key: string) => {
          return params[key] !== undefined ? String(params[key]) : `{${key}}`;
        });
        // プレースホルダが残っている場合は JSON 表示
        if (replaced.includes('{')) {
          replaced = JSON.stringify(params);
        }
        return replaced;
      }

      // 単値 → {0}置換
      return template.replace(/\{0\}/g, String(params));
    });

    // LoggerEx に dummyLogger とサービス名を渡して初期化
    logger = new LoggerEx(dummyLogger, 'jp_radio');
  });

  /**
   * 0. debug メソッドで強制 debug 出力が info として呼ばれるかの確認
   */
  test('Success0000_Debug強制出力がInfoとして呼ばれることを確認', () => {
    // 強制 debug 出力を有効化
    logger.enableForceDebug(true);

    // debug 出力（本来は info に昇格される）
    logger.debug('TEST000', 'Hello Forced Debug');

    // dummyLogger.info が呼ばれたことを確認
    expect((logger as any).logger.info).toHaveBeenCalled();
  });

  /**
   * 1. 各ログレベルの string 引数が正しく出力されることを確認
   *  同時に console にも実際の出力を表示
   */
  test('Success0001_String型が各ログレベルで表示されることを確認', () => {
    // メッセージIDの設定
    (messageHelper as any).messages['TEST001'] = '{0}';
    (messageHelper as any).messages['TEST002'] = '{0}';
    (messageHelper as any).messages['TEST003'] = '{0}';
    (messageHelper as any).messages['TEST004'] = '{0}';

    // info
    logger.info('TEST001', 'InfoMessage');
    const infoLogged = (logger as any).logger.info.mock.calls[0][0] as string;
    process.stdout.write(`INFOログ: ${infoLogged}\n`);
    // assert
    expect(infoLogged).toMatch(/InfoMessage/);

    // warn
    logger.warn('TEST002', 'WarnMessage');
    const warnLogged = (logger as any).logger.warn.mock.calls[0][0] as string;
    process.stdout.write(`WARNログ: ${warnLogged}\n`);
    // assert
    expect(warnLogged).toMatch(/WarnMessage/);

    // error
    logger.error('TEST003', 'ErrorMessage');
    const errorLogged = (logger as any).logger.error.mock.calls[0][0] as string;
    process.stdout.write(`ERRORログ: ${errorLogged}\n`);
    // assert
    expect(errorLogged).toMatch(/ErrorMessage/);

    // debug
    logger.debug('TEST004', 'DebugMessage');
    // forceDebug は有効化していないので debug が呼ばれる
    const debugLogged = (logger as any).logger.debug.mock.calls[0][0] as string;
    process.stdout.write(`DEBUGログ: ${debugLogged}\n`);
    // assert
    expect(debugLogged).toMatch(/DebugMessage/);
  });

  /**
   * 2. 配列 → {0},{1} 置換の確認
   */
  test('Success0002_配列を {0},{1} で置換できることを確認', () => {
    // メッセージIDの設定
    (messageHelper as any).messages['TEST005'] = '{0} : {1}';

    logger.enableForceDebug(true); // 強制 debug 出力を有効化
    logger.debug('TEST005', 'Station1', 'NowPlaying');

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;
    process.stdout.write(`ログ: ${logged}\n`);
    expect(logged).toMatch(/Station1/);
    expect(logged).toMatch(/NowPlaying/);
  });

  /**
   * 3. オブジェクト → 名前付き置換の確認
   */
  test('Success0003_オブジェクトを名前付き置換できることを確認', () => {
    // メッセージIDの設定
    (messageHelper as any).messages['TEST006'] = '{user}:{action}';

    logger.enableForceDebug(true);

    logger.debug('TEST006', { user: 'Alice', action: 'Play' });

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;
    process.stdout.write(`ログ: ${logged}\n`);
    expect(logged).toMatch(/Alice/);
    expect(logged).toMatch(/Play/);
  });

  /**
   * 4. 単値 → {0} 置換の確認
   */
  test('Success0004_単値を {0} で置換できることを確認', () => {
    // メッセージIDの設定
    (messageHelper as any).messages['TEST007'] = '{0}';

    logger.enableForceDebug(true);

    logger.debug('TEST007', 12345);

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;
    process.stdout.write(`ログ: ${logged}\n`);
    expect(logged).toMatch(/12345/);
  });
  
  test('Success0005_オブジェクトをログに出力できること(Object.entries対応)', () => {
    // メッセージテンプレート設定
    (messageHelper as any).messages['TEST_OBJECT'] = '{0}';

    // ログ対象オブジェクト
    const obj = { user: 'Alice', action: 'Login', role: 'admin' };

    logger.info('TEST_OBJECT', obj);

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;

    process.stdout.write(`OBJログ: ${logged}\n`);

    // JSON形式で出力されるはず
    expect(logged).toMatch(/Alice/);
    expect(logged).toMatch(/Login/);
    expect(logged).toMatch(/admin/);

    // Object.entries が展開されているかに近い表現
    expect(logged).toMatch(/user/);
    expect(logged).toMatch(/action/);
    expect(logged).toMatch(/role/);
  });
});
