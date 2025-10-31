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
 * - 単値 → {0}、配列 → {0},{1}... 置換対応
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
   * 内部ログ処理
   * @param level ログレベル
   * @param msgId メッセージID
   * @param params 任意のパラメータ
   *  - MessageParams
   *  - [string, unknown][] 配列 or 任意配列
   *  - string / number（{0} として置換）
   *  - Error
   */
  private log(level: LogLevel, msgId: string, params?: MessageParams | [string, unknown][] | string | number | Error): void {
    let finalParams: MessageParams = {};

    if (params !== undefined) {
      // Error オブジェクトは自動変換
      if (params instanceof Error) {
        finalParams.errorMessage = params.message;
        finalParams.errorStack = params.stack ?? '';
      }

      // 配列: {0}, {1}, ... として展開
      else if (Array.isArray(params)) {
        finalParams = params.reduce((acc, v, i) => {
          acc[i] = typeof v === 'string' || typeof v === 'number' ? v : String(v);
          return acc;
        }, {} as MessageParams);
      }

      // 文字列 / 数値 → {0}
      else if (typeof params === 'string' || typeof params === 'number') {
        finalParams = { 0: params };
      }

      // オブジェクト → 名前付き置換
      else if (typeof params === 'object') {
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

    // Debug 強制タグ
    const forcedDebug = (finalParams as any).__forceDebug;
    if (forcedDebug) {
      // 表示用に削除
      delete (finalParams as any).__forceDebug;
    }

    // messageHelper から i18n メッセージを取得
    const message = messageHelper.get(msgId, finalParams);

    // タイムスタンプ生成
    const timestamp = new Date().toISOString();

    /**
     * 出力フォーマット:
     * - 標準: [タイムスタンプ] [サービス名] [レベル] [メッセージID] メッセージ本文
     *   ※ serviceName が null/undefined の場合は [サービス名] は表示されません
     * - 強制Debug時: [タイムスタンプ] [サービス名] [DEBUG-FORCED] [メッセージID] メッセージ本文
     */
    const tag = forcedDebug ? 'DEBUG-FORCED' : level.toUpperCase();
    // サービス名がある場合だけ表示
    const serviceTag = this.serviceName ? `[${this.serviceName}] ` : '';
    const formatted = `[${timestamp}] ${serviceTag}[${tag}] [${msgId}] ${message}`;

    // 強制debug → info扱い
    if (forcedDebug) {
      this.logger.info(formatted);
      return;
    }

    // Volumio Logger に出力
    switch (level) {
      case 'info': this.logger.info(formatted); break;
      case 'warn': this.logger.warn(formatted); break;
      case 'error': this.logger.error(formatted); break;
      case 'debug': this.logger.debug(formatted); break;
    }
  }

  /** info ログ出力 */
  public info(paramsId: string, params?: any): void {
    this.log('info', paramsId, params);
  }

  /** warn ログ出力 */
  public warn(paramsId: string, params?: any): void {
    this.log('warn', paramsId, params);
  }

  /** error ログ出力 */
  public error(paramsId: string, params?: any): void {
    this.log('error', paramsId, params);
  }

  /** debug ログ出力 */
  public debug(paramsId: string, params?: any): void {
    if (this.forceDebug) {
      // 強制時: debug を info で出しつつタグ付与
      this.log('info', paramsId, {
        ...(typeof params === 'object' && params ? params : {}),
        __forceDebug: true
      });
    } else {
      this.log('debug', paramsId, params);
    }
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
