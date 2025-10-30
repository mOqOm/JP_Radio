// Volumio標準Loggerの型をインポート
import type { Logger } from 'volumio-logger';
// messageHelper と MessageParams をインポート
import { messageHelper, MessageParams } from './message-helper';

/**
 * ログレベルの型定義
 */
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * LoggerEx
 * --------------
 * Volumio標準Loggerをラップし、メッセージIDとパラメータを使った
 * 多言語対応ログ出力を提供するクラス。
 * 
 * - messageHelper と連携して i18n メッセージを出力
 * - Error オブジェクトが params.error に渡された場合は自動的に message と stack を追加
 */
export class LoggerEx {
  /** Volumio標準Logger */
  private logger: Logger;

  constructor(volumioLogger: Logger) {
    this.logger = volumioLogger;
  }

  /**
   * 内部ログ処理
   * @param level ログレベル
   * @param msgId メッセージID
   * @param params プレースホルダ置換用パラメータ
   */
  private log(level: LogLevel, msgId: string, params: MessageParams = {}): void {
    // params.error が Error オブジェクトである場合に安全に展開
    const errCandidate: unknown = params.error;
    if (errCandidate instanceof Error) {
      const err = errCandidate;
      // message と stack を別キーに追加
      params.errorMessage = err.message;
      params.errorStack = err.stack ?? '';
      // 元の error キーは削除
      delete params.error;
    }

    // messageHelper から i18n メッセージを取得
    const message = messageHelper.get(msgId, params);

    // タイムスタンプ生成
    const timestamp = new Date().toISOString();

    // 出力フォーマット: [タイムスタンプ] [レベル] [メッセージID] メッセージ本文
    const formatted = `[${timestamp}] [${level.toUpperCase()}] [${msgId}] ${message}`;

    // Volumio Logger に出力
    switch (level) {
      case 'info':  this.logger.info(formatted);  break;
      case 'warn':  this.logger.warn(formatted);  break;
      case 'error': this.logger.error(formatted); break;
      case 'debug': this.logger.debug(formatted); break;
    }
  }

  /** info ログ出力 */
  public info(msgId: string, params?: MessageParams): void {
    this.log('info', msgId, params);
  }

  /** warn ログ出力 */
  public warn(msgId: string, params?: MessageParams): void {
    this.log('warn', msgId, params);
  }

  /** error ログ出力 */
  public error(msgId: string, params?: MessageParams): void {
    this.log('error', msgId, params);
  }

  /** debug ログ出力 */
  public debug(msgId: string, params?: MessageParams): void {
    this.log('debug', msgId, params);
  }

  /**
   * 表示言語を変更
   * LoggerEx と messageHelper 両方で参照される
   * @param lang 言語コード ('ja', 'en' など)
   */
  public setLanguage(lang: string): void {
    messageHelper.setLanguage(lang);
  }
}
