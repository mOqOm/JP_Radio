import fs from 'fs-extra';
import ini from 'ini';
import path from 'path';

/** プレースホルダ置換用パラメータ */
export type MessageParams = Record<string, string | number | unknown>;

/**
 * MessageHelper
 * -------------------
 * ini ファイルからメッセージをロードし、多言語対応文字列を取得
 */
export class MessageHelper {
  /** メッセージ格納 */
  private messages: Record<string, any> = {};
  /** 現在の言語 */
  private lang: string = 'ja';
  /** i18n ディレクトリ */
  private readonly baseDir: string = path.resolve(process.cwd(), 'i18n');

  constructor(lang: string = 'ja') {
    this.setLanguage(lang);
  }

  /** 言語を切替 */
  public setLanguage(lang: string) {
    this.lang = lang;
    this.loadMessages();
  }

  /** ini ファイルからメッセージをロード */
  private loadMessages() {
    const logMsgPath = path.join(this.baseDir, `log_messages.${this.lang}.ini`);
    const pushMsgPath = path.join(this.baseDir, `push_messages.${this.lang}.ini`);
    const browseTextPath = path.join(this.baseDir, `browse_texts.${this.lang}.ini`);

    // ini ファイル (ログ用)
    if (fs.existsSync(logMsgPath)) {
      try {
        this.messages = ini.parse(fs.readFileSync(logMsgPath, 'utf-8'));
      } catch (error: any) {
        console.error(`[MessageHelper] Failed to load ${logMsgPath}`, error);
      }
    }

    // ini ファイル (プッシュ用)
    if (fs.existsSync(pushMsgPath)) {
      try {
        const pushMessages = ini.parse(fs.readFileSync(pushMsgPath, 'utf-8'));
        this.messages = { ...this.messages, ...pushMessages };
      } catch (error: any) {
        console.error(`[MessageHelper] Failed to load ${pushMsgPath}`, error);
      }
    }

    // ini ファイル (Browse用)
    if (fs.existsSync(browseTextPath)) {
      try {
        const pushMessages = ini.parse(fs.readFileSync(browseTextPath, 'utf-8'));
        this.messages = { ...this.messages, ...pushMessages };
      } catch (error: any) {
        console.error(`[MessageHelper] Failed to load ${browseTextPath}`, error);
      }
    }
  }

  /**
   * メッセージ取得
   * @param messageId メッセージID
   * @param params 可変長引数またはオブジェクト、Errorも対応
   */
  public get(messageId: string, ...params: (string | number | MessageParams | Error)[]): string {
    const template = this.messages[messageId];
    if (!template) {
      return `[Unknown message ID: ${messageId}]`;
    }

    // Error オブジェクト対応
    if (params.length === 1 && params[0] instanceof Error) {
      const err = params[0] as Error;
      params = [{ errorMessage: err.message ?? 'Unknown error', errorStack: err.stack ?? '' }];
    }

    // 名前付き置換 {key}
    if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
      const objParams = params[0] as MessageParams;
      if (/\{[^\d]+\}/.test(template)) {
        return template.replace(/\{(\w+)\}/g, (_match: string, key: string) =>
          objParams[key] !== undefined ? String(objParams[key]) : `{${key}}`
        );
      }
    }

    // 数字インデックス置換 {0}, {1}, ...
    return template.replace(/\{(\d+)\}/g, (_match: string, index: string) => {
      const idx = parseInt(index, 10);
      const val = params[idx];
      if (val === undefined) {
        return `{${index}}`;
      }
      if (typeof val === 'object' && val !== null) {
        return Array.isArray(val) ? JSON.stringify(val) : JSON.stringify(val);
      }
      return String(val);
    });
  }
}

/** シングルトンインスタンス */
export const messageHelper = new MessageHelper();
