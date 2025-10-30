// Volumio標準Loggerの型をインポート
import type { Logger } from 'volumio-logger';
import { messageHelper, MessageParams } from './message-helper';
/**
 * MessageParams
 *  - Error オブジェクトも含めて柔軟に対応
 */
export type MessageParams = { [key: string]: any };

/**
 * ログレベルの型定義
 */
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * LoggerEx
 * --------------
 * Volumio標準Loggerをラップし、メッセージIDとパラメータを使った
 * 多言語対応ログ出力を提供するクラス。
 */
export class LoggerEx {
  private logger: Logger;

  constructor(volumioLogger: Logger) {
    this.logger = volumioLogger;
  }

  private log(level: LogLevel, msgId: string, params: MessageParams = {}): void {
    // Errorオブジェクトを安全に展開
    if (params.error instanceof Error) {
      const err = params.error as Error;
      params.errorMessage = err.message;
      params.errorStack = err.stack ?? '';
      delete params.error;
    }

    const message = messageHelper.get(msgId, params);

    // タイムスタンプ生成
    const timestamp = new Date().toISOString();

    // 出力フォーマット: [タイムスタンプ] [レベル] [メッセージID] メッセージ本文
    const formatted = `[${timestamp}] [${level.toUpperCase()}] [${msgId}] ${message}`;

    switch (level) {
      case 'info':  this.logger.info(formatted);  break;
      case 'warn':  this.logger.warn(formatted);  break;
      case 'error': this.logger.error(formatted); break;
      case 'debug': this.logger.debug(formatted); break;
    }
  }

  public info(msgId: string, params?: MessageParams): void { this.log('info', msgId, params); }
  public warn(msgId: string, params?: MessageParams): void { this.log('warn', msgId, params); }
  public error(msgId: string, params?: MessageParams): void { this.log('error', msgId, params); }
  public debug(msgId: string, params?: MessageParams): void { this.log('debug', msgId, params); }

  public setLanguage(lang: string): void {
    messageHelper.setLanguage(lang);
  }
}
