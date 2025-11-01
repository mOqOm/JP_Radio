import { MessageHelper } from '../../src/utils/message-helper.util';

describe('MessageHelper', () => {
    let helper: MessageHelper;

    beforeEach(() => {
        helper = new MessageHelper();
    });

    test('Success0001_既存のメッセージIDで文字列が返る', () => {
        // テスト冒頭でメッセージIDとテンプレートを設定
        (helper as any).messages['TEST001'] = 'Hello {0}';

        const msg = helper.get('TEST001', 'World');
        process.stdout.write(`TEST001出力: ${msg}\n`);
        expect(msg).toBe('Hello World');
    });

    test('Success0002_存在しないメッセージIDでUnknownが返る', () => {
        const msg = helper.get('NO_ID');
        process.stdout.write(`NO_ID出力: ${msg}\n`);
        expect(msg).toBe('[Unknown message ID: NO_ID]');
    });

    test('Success0003_配列引数で {0}, {1} が置換される', () => {
        (helper as any).messages['TEST002'] = 'Values: {0}, {1}';

        const msg = helper.get('TEST002', 'One', 'Two');
        process.stdout.write(`TEST002出力: ${msg}\n`);
        expect(msg).toBe('Values: One, Two');
    });

    test('Success0004_オブジェクト引数で名前付き置換が動作する', () => {
        (helper as any).messages['TEST003'] = 'User {user} performed {action}';

        const msg = helper.get('TEST003', { user: 'Alice', action: 'Play' });
        process.stdout.write(`TEST003出力: ${msg}\n`);
        expect(msg).toBe('User Alice performed Play');
    });

    test('Success0005_オブジェクトにないキーはそのまま残る', () => {
        (helper as any).messages['TEST003'] = 'User {user} performed {action}';

        const msg = helper.get('TEST003', { user: 'Bob' });
        process.stdout.write(`TEST003出力（未指定キーあり）: ${msg}\n`);
        expect(msg).toBe('User Bob performed {action}');
    });

    test('Success0006_単値を {0} に置換できる', () => {
        (helper as any).messages['TEST001'] = 'Hello {0}';

        const msg = helper.get('TEST001', 123);
        process.stdout.write(`TEST001出力（単値）: ${msg}\n`);
        expect(msg).toBe('Hello 123');
    });

    test('Success0007_可変長引数で {0}, {1} を置換できる', () => {
        (helper as any).messages['TEST002'] = 'Values: {0}, {1}';

        const msg = helper.get('TEST002', 10, 20);
        process.stdout.write(`TEST002出力（可変長引数）: ${msg}\n`);
        expect(msg).toBe('Values: 10, 20');
    });
    
    test('Success0008_オブジェクトをJSON化して返す', () => {
        (helper as any).messages['TEST004'] = '{0}';

        const obj = { user: 'Alice', action: 'Login', role: 'admin' };
        const msg = helper.get('TEST004', obj);

        process.stdout.write(`TEST004出力(オブジェクトJSON化): ${msg}\n`);

        // JSON文字列に変換されていることを確認
        expect(msg).toContain('"user":"Alice"');
        expect(msg).toContain('"action":"Login"');
        expect(msg).toContain('"role":"admin"');
    });
});
