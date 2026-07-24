import fs from 'fs';
import path from 'path';
import ini from 'ini';
import { I18N_DIR } from './plugin-paths';

/** `i18n/`配下で読み込む.iniカタログのファイル名(拡張子・言語コードを除く)。 */
const CATALOG_NAMES = ['log_messages', 'push_messages', 'browse_texts'] as const;

/**
 * `i18n/{name}.{lang}.ini`からメッセージテンプレートを読み込み、`{0}`, `{1}`, ...形式の
 * プレースホルダを引数で置換して返す。
 */
export class MessageCatalog {
  private readonly messages: Record<string, string> = {};

  /**
   * @param lang 読み込む言語コード(`i18n/{name}.{lang}.ini`)。
   */
  constructor(lang = 'ja') {
    for (const name of CATALOG_NAMES) {
      const filePath = path.join(I18N_DIR, `${name}.${lang}.ini`);
      if (fs.existsSync(filePath) === false) {
        continue;
      }
      const parsed = ini.parse(fs.readFileSync(filePath, 'utf-8'));
      Object.assign(this.messages, parsed);
    }
  }

  /**
   * メッセージIDに対応するテンプレートを取得し、`{0}`, `{1}`, ...を引数で置換する。
   * `Error`インスタンスを渡した場合はスタックトレース(無ければメッセージ)に展開する
   * (ログ出力でエラーの詳細をそのまま埋め込めるようにするため)。
   * @param messageId `i18n`の.iniファイルに定義されたキー。
   * @param params プレースホルダに埋め込む値(順序通り)。
   * @returns 該当キーが見つからない場合は`[Unknown message ID: ...]`を返す。
   */
  get(messageId: string, ...params: (string | number | Error)[]): string {
    const template = this.messages[messageId];
    if (template === undefined) {
      return `[Unknown message ID: ${messageId}]`;
    }
    return template.replace(/\{(\d+)\}/g, (_match: string, index: string) => {
      const value = params[Number(index)];
      if (value === undefined) {
        return `{${index}}`;
      }
      if (value instanceof Error) {
        let text = value.stack;
        if (text === undefined) {
          text = value.message;
        }
        return text;
      }
      return String(value);
    });
  }
}

/** アプリ全体で共有するシングルトンインスタンス。 */
export const messageCatalog = new MessageCatalog();
