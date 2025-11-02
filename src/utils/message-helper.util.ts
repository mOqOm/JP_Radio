import fs from 'fs-extra';
import ini from 'ini';
import path from 'path';

/**
 * プレースホルダ置換用パラメータ
 * - オブジェクトまたは順序付き配列で利用可能
 */
export type MessageParams = Record<string, string | number>;

/**
 * MessageHelper
 * -------------------
 * ini / JSON ファイルからメッセージをロードし、多言語対応文字列を取得するユーティリティ。
 * 
 * 特徴:
 * - メッセージIDによる取得
 * - 可変長引数やオブジェクトによるプレースホルダ置換
 *   - 単値/複数値 → {0},{1},...
 *   - オブジェクト → {key} 形式で名前付き置換
 *   - オブジェクトにプレースホルダがない場合は自動で JSON 化して返却
 */
export class MessageHelper {
  /** メッセージ格納 */
  private messages: Record<string, string> = {};
  /** 現在の言語 */
  private lang: string = 'ja';
  /** i18n ディレクトリのベースパス */
  private readonly baseDir: string = path.resolve(process.cwd(), 'i18n');

  constructor(lang: string = 'ja') {
    this.setLanguage(lang);
  }

  /** 言語を切替 */
  public setLanguage(lang: string) {
    this.lang = lang;
    this.loadMessages();
  }

  /** ini または JSON ファイルからメッセージをロード */
  private loadMessages() {
    const iniPath = path.join(this.baseDir, `logmessages.${this.lang}.ini`);
    const jsonPath = path.join(this.baseDir, `string_${this.lang}.json`);

    try {
      if (fs.existsSync(iniPath)) {
        const data = fs.readFileSync(iniPath, 'utf-8');
        this.messages = ini.parse(data);
      } else if (fs.existsSync(jsonPath)) {
        // fs-extra が必要
        this.messages = fs.readJsonSync(jsonPath);
      } else {
        console.warn(`[MessageHelper] No message file found for language: ${this.lang} ${iniPath} ${jsonPath}`);
        this.messages = {};
      }
    } catch(err) {
      console.error(`[MessageHelper] Failed to load messages for lang ${this.lang} ${iniPath} ${jsonPath}`, err);
      this.messages = {};
    }
  }

  /**
  * メッセージ取得
  * @param id メッセージID
  * @param params 可変長引数またはオブジェクト
  *  - 数字インデックス → {0},{1},... に置換
  *  - オブジェクト → {key} に置換。テンプレートにプレースホルダがなければ JSON 化
  * @returns 置換済み文字列
  */
  public get(id: string, ...params: (string | number | MessageParams)[]): string {
    const template = this.messages[id];
    if (!template) return `[Unknown message ID: ${id}]`;

    // 名前付き置換 {key}
    if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
        const objParams = params[0] as MessageParams;

        // テンプレートに数字ではないプレースホルダがある場合
        if (/\{[^\d]+\}/.test(template)) {
            return template.replace(/\{(\w+)\}/g, (_, key) =>
                objParams[key] !== undefined ? String(objParams[key]) : `{${key}}`
            );
        }

        // プレースホルダが数字だけ ({0}) の場合は params[0] を数字置換ブロックに任せる
    }

    // 数字インデックス置換 {0}, {1}, ...
    return template.replace(/\{(\d+)\}/g, (_, index) => {
      const idx = parseInt(index, 10);
      const val = params[idx];

      if (val === undefined) return `{${index}}`;

      // オブジェクトかつ文字列化が必要な場合のみ JSON 化
      if (typeof val === 'object' && val !== null) {
          return Array.isArray(val) ? JSON.stringify(val) : JSON.stringify(val);
      }

      // 文字列・数値はそのまま
      return String(val);
    });
  }
}

/** シングルトンインスタンス */
export const messageHelper = new MessageHelper();
