// LoggerEx クラスをテスト対象としてインポート
import { LoggerEx } from '../../src/utils/logger';
// Volumio 標準 Logger 型をインポート（モック用）
import { Logger } from 'volumio-logger';
import { messageHelper } from '../../src/utils/message-helper';

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
        const dummyLogger: Logger = {
            info: jest.fn(),   // info ログ用モック
            warn: jest.fn(),   // warn ログ用モック
            error: jest.fn(),  // error ログ用モック
            debug: jest.fn()   // debug ログ用モック
        } as unknown as Logger;

        // messageHelper.get をモックして、渡された params を文字列に変換して返す
        jest.spyOn(messageHelper, 'get').mockImplementation((id: string, params?: any) => {
            if (params === undefined || params === null) return id;

            // 配列の場合は {0},{1} ... と同じ順序で連結
            if (Array.isArray(params)) {
                return params.map(p => String(p)).join(', ');
            }

            // オブジェクトの場合は値をカンマ区切りで連結
            if (typeof params === 'object') {
                return Object.values(params).map(v => String(v)).join(', ');
            }

            // 単値
            return String(params);
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
     */
    test('Success0001_String型が各ログレベルで表示されることを確認', () => {
        // info
        logger.info('TEST001', 'InfoMessage');
        expect((logger as any).logger.info).toHaveBeenCalledWith(
            expect.stringMatching(/InfoMessage/)
        );

        // warn
        logger.warn('TEST002', 'WarnMessage');
        expect((logger as any).logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/WarnMessage/)
        );

        // error
        logger.error('TEST003', 'ErrorMessage');
        expect((logger as any).logger.error).toHaveBeenCalledWith(
            expect.stringMatching(/ErrorMessage/)
        );

        // debug
        logger.debug('TEST004', 'DebugMessage');
        // forceDebug は有効化していないので debug が呼ばれる
        expect((logger as any).logger.debug).toHaveBeenCalledWith(
            expect.stringMatching(/DebugMessage/)
        );
    });

    /**
     * 2. 配列 → {0},{1} 置換の確認
     */
    test('Success0002_配列を {0},{1} で置換できることを確認', () => {
        logger.enableForceDebug(true); // 強制 debug 出力を有効化
        logger.debug('TEST005', 'Station1', 'NowPlaying');

        const logged = (logger as any).logger.info.mock.calls[0][0] as string;
        expect(logged).toMatch(/Station1/);
        expect(logged).toMatch(/NowPlaying/);
    });

    /**
     * 3. オブジェクト → 名前付き置換の確認
     */
    test('Success0003_オブジェクトを名前付き置換できることを確認', () => {
        logger.enableForceDebug(true);

        logger.debug('TEST006', { user: 'Alice', action: 'Play' });

        const logged = (logger as any).logger.info.mock.calls[0][0] as string;
        expect(logged).toMatch(/Alice/);
        expect(logged).toMatch(/Play/);
    });

    /**
     * 4. 単値 → {0} 置換の確認
     */
    test('Success0004_単値を {0} で置換できることを確認', () => {
        logger.enableForceDebug(true);

        logger.debug('TEST007', 12345);

        const logged = (logger as any).logger.info.mock.calls[0][0] as string;
        expect(logged).toMatch(/12345/);
    });
});
