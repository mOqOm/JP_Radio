import fs from 'fs-extra';
import ini from 'ini';
import path from 'path';

/**
 * プレースホルダ置換用パラメータ
 * - オブジェクトでも順序付き配列でも使える
 */
export type MessageParams = Record<string, string | number>;

/**
 * MessageHelper
 * -------------------
 * ini ファイルからメッセージを読み込み、多言語対応の文字列を取得
 * 可変引数またはオブジェクト引数でプレースホルダを置換可能
 */
export class MessageHelper {
  private messages: Record<string, string> = {};
  private lang: string = 'ja';
  private readonly baseDir: string = path.resolve(__dirname, '../i18n');

  constructor(lang: string = 'ja') {
    this.setLanguage(lang);
  }

  /** 言語を切替 */
  public setLanguage(lang: string) {
    this.lang = lang;
    this.loadMessages();
  }

  /** iniとjsonファイルからメッセージをロード */
  private loadMessages() {
    const iniPath = path.join(this.baseDir, `${this.lang}.ini`);
    const jsonPath = path.join(this.baseDir, `string_${this.lang}.json`);

    try {
      if (fs.existsSync(iniPath)) {
        const data = fs.readFileSync(iniPath, 'utf-8');
        this.messages = ini.parse(data);
      } else if (fs.existsSync(jsonPath)) {
        this.messages = fs.readJsonSync(jsonPath); // fs-extra が必要
      } else {
        console.warn(`[MessageHelper] No message file found for language: ${this.lang}`);
        this.messages = {};
      }
    } catch (err) {
      console.error(`[MessageHelper] Failed to load messages for lang ${this.lang}`, err);
      this.messages = {};
    }
  }

  /**
   * メッセージ取得
   * @param id メッセージID
   * @param params 可変長引数またはオブジェクトで置換
   * @returns 置換済み文字列
   */
  public get(id: string, ...params: (string | number | MessageParams)[]): string {
    const template = this.messages[id];
    if (!template) return `[Unknown message ID: ${id}]`;

    // 最初の引数がオブジェクトなら名前付き置換
    if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
      const objParams = params[0] as MessageParams;
      return template.replace(/\{(\w+)\}/g, (_, key) =>
        objParams[key] !== undefined ? String(objParams[key]) : `{${key}}`
      );
    }

    // 数字インデックス置換 {0}, {1}, ...
    return template.replace(/\{(\d+)\}/g, (_, index) => {
      const idx = parseInt(index, 10);
      return params[idx] !== undefined ? String(params[idx]) : `{${index}}`;
    });
  }
}

/** シングルトン */
export const messageHelper = new MessageHelper();
