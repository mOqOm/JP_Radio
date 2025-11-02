// Volumio標準Loggerの型をインポート
import type { Logger } from 'volumio-logger';
// messageHelper と MessageParams をインポート
import { messageHelper, MessageParams } from '@/utils/message-helper.util';

/**
 * ログレベルの型定義
 */
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * LoggerEx
 * ----------
 * Volumio標準Loggerをラップし、メッセージIDとパラメータを使った
 * 多言語対応ログ出力を提供するクラス
 *
 * 特徴:
 * - messageHelper と連携して i18n メッセージを出力
 * - Error オブジェクトを params.error に渡すと message と stack を自動展開
 * - 可変長引数で配列/単値/オブジェクトを柔軟に置換
 *   - 単値 → {0}
 *   - 複数引数 → {0},{1},...
 *   - オブジェクト → 名前付き置換
 */
export class LoggerEx {
    /** Volumio標準Logger */
    private logger: Logger;
    /** サービス名の表示(初期値:null) */
    private serviceName: string | null = null;
    /** debug を info に昇格するフラグ */
    private forceDebug = false;

    constructor(volumioLogger: Logger, serviceName?: string) {
        this.logger = volumioLogger;
        if (serviceName !== undefined) {
            this.serviceName = serviceName;
        }
    }

    /** debug を強制的に info として出力させる */
    public enableForceDebug(enable = true): void {
        this.forceDebug = enable;
    }

    /**
     * debug ログ出力
     * 可変長引数に対応
     */
    public debug(msgId: string, ...params: (string | number | MessageParams | Error)[]): void {
        if (this.forceDebug) {
            // debug → info に昇格 + __forceDebug タグ付与
            this.log('info', msgId, ...params, { __forceDebug: true });
        } else {
            this.log('debug', msgId, ...params);
        }
    }

    /** info ログ出力 */
    public info(msgId: string, ...params: (string | number | MessageParams | Error)[]): void {
        this.log('info', msgId, ...params);
    }

    /** warn ログ出力 */
    public warn(msgId: string, ...params: (string | number | MessageParams | Error)[]): void {
        this.log('warn', msgId, ...params);
    }

    /** error ログ出力 */
    public error(msgId: string, ...params: (string | number | MessageParams | Error)[]): void {
        this.log('error', msgId, ...params);
    }

    /**
     * 内部ログ処理
     */
    private log(level: LogLevel, msgId: string, ...params: any[]): void {
        // messageHelper から i18n メッセージ取得
        const message = messageHelper.get(msgId, ...params);

        // タイムスタンプ生成
        const timestamp = new Date().toISOString();

        // 出力フォーマット
        const tag = this.forceDebug ? 'DEBUG-FORCED' : level.toUpperCase();
        const serviceTag = this.serviceName ? `[${this.serviceName}] ` : '';
        const formatted = `[${timestamp}] ${serviceTag}[${tag}] [${msgId}] ${message}`;

        // 強制 debug → info 扱い
        if (this.forceDebug) {
            this.logger.info(formatted);
            return;
        }

        // ログレベルに応じて出力
        switch (level) {
            case 'info':
                this.logger.info(formatted);
                break;
            case 'warn':
                this.logger.warn(formatted);
                break;
            case 'error':
                this.logger.error(formatted);
                break;
            case 'debug':
                this.logger.debug(formatted);
                break;
        }
    }

    /**
     * 表示言語を変更
     */
    public setLanguage(lang: string): void {
        messageHelper.setLanguage(lang);
    }
}
