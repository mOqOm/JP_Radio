// LoggerEx クラスをテスト対象としてインポート
import { LoggerEx } from '@/utils/logger.util';
// Volumio 標準 Logger 型をインポート（モック用）
import { Logger } from 'volumio-logger';
import { messageHelper } from '@/utils/message-helper.util';

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
      info: jest.fn(), // info ログ用モック
      warn: jest.fn(), // warn ログ用モック
      error: jest.fn(), // error ログ用モック
      debug: jest.fn() // debug ログ用モック
    } as unknown as Logger;

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
    // Assert
    expect(infoLogged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [INFO] [TEST001] InfoMessage');

    // warn
    logger.warn('TEST002', 'WarnMessage');
    const warnLogged = (logger as any).logger.warn.mock.calls[0][0] as string;
    // Assert
    expect(warnLogged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [WARN] [TEST002] WarnMessage');

    // error
    logger.error('TEST003', 'ErrorMessage');
    const errorLogged = (logger as any).logger.error.mock.calls[0][0] as string;
    // Assert
    expect(errorLogged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [ERROR] [TEST003] ErrorMessage');

    // debug
    logger.debug('TEST004', 'DebugMessage');
    // forceDebug は有効化していないので debug が呼ばれる
    const debugLogged = (logger as any).logger.debug.mock.calls[0][0] as string;
    // Assert
    expect(debugLogged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [DEBUG] [TEST004] DebugMessage');
  });

  /**
   * 2. 配列 → {0},{1} 置換の確認
   */
  test('Success0002_配列を {0},{1} で置換できることを確認', () => {
    // メッセージIDの設定
    (messageHelper as any).messages['TEST005'] = '{0} : {1}';

    // 強制 debug 出力を有効化
    logger.enableForceDebug(true);
    logger.debug('TEST005', 'Station1', 'NowPlaying');

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;
    // Assert
    expect(logged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [DEBUG-FORCED] [TEST005] Station1 : NowPlaying');
  });

  /**
   * 3. オブジェクト → 名前付き置換の確認
   */
  test('Success0003_オブジェクトを名前付き置換できることを確認', () => {
    // メッセージIDの設定
    (messageHelper as any).messages['TEST006'] = '{user}:{action}';

    logger.enableForceDebug(true);

    logger.info('TEST006', {
      user: 'Alice',
      action: 'Play'
    });

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;
    // Assert
    expect(logged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [DEBUG-FORCED] [TEST006] Alice:Play');
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
    // Assert
    expect(logged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [DEBUG-FORCED] [TEST007] 12345');
  });

  test('Success0005_オブジェクトをログに出力できること(Object.entries対応)', () => {
    // メッセージテンプレート設定
    (messageHelper as any).messages['TEST_OBJECT'] = '{0}';

    // ログ対象オブジェクト
    const obj = {
      user: 'Alice',
      action: 'Login',
      role: 'admin'
    };

    logger.info('TEST_OBJECT', obj);

    const logged = (logger as any).logger.info.mock.calls[0][0] as string;

    // Assert
    expect(logged).toBe('[2025-10-31T23:55:10.000Z] [jp_radio] [INFO] [TEST_OBJECT] {"user":"Alice","action":"Login","role":"admin"}');
  });
});
