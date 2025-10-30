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
 * 特徴:
 * - messageHelper と連携して i18n メッセージを出力
 * - Error オブジェクトを params.error に渡すと message と stack を自動展開
 * - `[string, unknown][]` 配列や単純 string / number も自動で MessageParams に変換
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
   * @param params 任意のパラメータ
   *  - MessageParams
   *  - [string, unknown][] 配列
   *  - string / number（value として置換）
   */
  private log(
    level: LogLevel,
    msgId: string,
    params?: MessageParams | [string, unknown][] | string | number | Error
  ): void {
    let finalParams: MessageParams = {};

    if (params !== undefined) {
      // Error オブジェクトは自動変換
      if (params instanceof Error) {
        finalParams.errorMessage = params.message;
        finalParams.errorStack = params.stack ?? '';
      } 
      // 単純 string / number は value キーに変換
      else if (typeof params === 'string' || typeof params === 'number') {
        finalParams.value = params;
      } 
      // [key,value][] 配列を変換
      else if (Array.isArray(params) && params.length > 0 && Array.isArray(params[0])) {
        try {
          finalParams = Object.fromEntries(
            (params as [string, unknown][]).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' ? v : String(v)])
          ) as MessageParams;
        } catch (e) {
          finalParams = {};
          console.warn(`[LoggerEx] Failed to convert array to params`, e);
        }
      }
      // MessageParams はそのまま
      else {
        finalParams = params as MessageParams;
      }
    }

    // params.error が Error オブジェクトの場合の安全展開
    const errCandidate: unknown = finalParams.error;
    if (errCandidate instanceof Error) {
      const err = errCandidate;
      finalParams.errorMessage = err.message;
      finalParams.errorStack = err.stack ?? '';
      delete finalParams.error;
    }

    // messageHelper から i18n メッセージを取得
    const message = messageHelper.get(msgId, finalParams);

    // タイムスタンプ生成
    const timestamp = new Date().toISOString();

    // 出力フォーマット: [タイムスタンプ] [レベル] [メッセージID] メッセージ本文
    const formatted = `[${timestamp}] [${level.toUpperCase()}] [${msgId}] ${message}`;

    // Volumio Logger に出力
    switch (level) {
      case 'info': this.logger.info(formatted); break;
      case 'warn': this.logger.warn(formatted); break;
      case 'error': this.logger.error(formatted); break;
      case 'debug': this.logger.debug(formatted); break;
    }
  }

  /** info ログ出力 */
  public info(paramsId: string, params?: MessageParams | [string, unknown][] | string | number | Error): void {
    this.log('info', paramsId, params);
  }

  /** warn ログ出力 */
  public warn(paramsId: string, params?: MessageParams | [string, unknown][] | string | number | Error): void {
    this.log('warn', paramsId, params);
  }

  /** error ログ出力 */
  public error(paramsId: string, params?: MessageParams | [string, unknown][] | string | number | Error): void {
    this.log('error', paramsId, params);
  }

  /** debug ログ出力 */
  public debug(paramsId: string, params?: MessageParams | [string, unknown][] | string | number | Error): void {
    this.log('debug', paramsId, params);
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
