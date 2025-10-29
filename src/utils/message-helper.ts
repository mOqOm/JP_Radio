import fs from 'fs';
import ini from 'ini';
import path from 'path';

/**
 * メッセージ置換用パラメータ
 * key: プレースホルダ名
 * value: 置換文字列
 */
export type MessageParams = Record<string, string | number>;

/**
 * MessageHelper
 * -------------------
 * メッセージIDと多言語対応メッセージを管理するユーティリティ。
 * メッセージIDに対応する文字列を取得し、プレースホルダを置換する。
 * 
 * 例:
 *   const msg = messageHelper.get('I_RADIO_0001', { url: 'http://...' });
 *   // -> "[I_RADIO_0001] サーバー接続開始: http://..."
 */
export class MessageHelper {
  /** 読み込んだメッセージIDと文字列のマップ */
  private messages: Record<string, string> = {};

  /** 現在の言語 */
  private lang: string;

  /** メッセージファイルが存在するディレクトリ */
  private readonly baseDir: string;

  /**
   * コンストラクタ
   * @param lang 初期言語 (例: 'ja', 'en')
   */
  constructor(lang: string = 'ja') {
    this.lang = lang;
    this.baseDir = path.resolve(__dirname, '../i18n');
    this.loadMessages();
  }

  /**
   * メッセージファイルを読み込む
   * 言語に応じて messages_xx.ini を読み込む
   */
  private loadMessages(): void {
    const filePath = path.join(this.baseDir, `${this.lang}.ini`);
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      this.messages = ini.parse(data);
    } catch (err) {
      console.error(`[MessageHelper] Failed to load messages: ${filePath}`, err);
      this.messages = {};
    }
  }

  /**
   * 言語を変更
   * @param lang 新しい言語コード (例: 'ja', 'en')
   */
  public setLanguage(lang: string): void {
    this.lang = lang;
    this.loadMessages();
  }

  /**
   * メッセージIDに対応する文字列を取得
   * プレースホルダ {key} を params[key] で置換
   * @param id メッセージID
   * @param params 置換用パラメータ
   * @returns 置換済みメッセージ文字列
   */
  public get(id: string, params: MessageParams = {}): string {
    const template = this.messages[id];
    if (!template) {
      const warning = `[Unknown message ID: ${id}]`;
      console.warn(warning);
      return warning;
    }

    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return params[key] !== undefined ? String(params[key]) : `{${key}}`;
    });
  }
}

/** プロジェクト全体で共有するシングルトンインスタンス */
export const messageHelper = new MessageHelper();
