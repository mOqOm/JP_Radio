import fs from 'fs';
import path from 'path';
import ini from 'ini';

/** `i18n/`配下で読み込む.iniカタログのファイル名(拡張子・言語コードを除く)。 */
const CATALOG_NAMES = ['push_messages', 'browse_texts'] as const;

/**
 * `i18n`ディレクトリの場所を解決する。
 * 本番ビルド後は`dist/i18n/`(このファイルから見て`../../i18n`)に配置されるが、
 * ts-node実行時(テスト等)は`src/lib/utils/`から見てプロジェクトルート直下の`i18n/`
 * (`../../../i18n`)を参照する必要があるため、両方を候補として実在する方を採用する。
 */
function resolveBaseDir(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'i18n'),
    path.join(__dirname, '..', '..', '..', 'i18n'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * `i18n/{name}.{lang}.ini`からメッセージテンプレートを読み込み、`{0}`, `{1}`, ...形式の
 * プレースホルダを引数で置換して返す。
 */
export class MessageCatalog {
  private readonly messages: Record<string, string> = {};

  constructor(lang = 'ja') {
    const baseDir = resolveBaseDir();
    for (const name of CATALOG_NAMES) {
      const filePath = path.join(baseDir, `${name}.${lang}.ini`);
      if (fs.existsSync(filePath) === false) {
        continue;
      }
      const parsed = ini.parse(fs.readFileSync(filePath, 'utf-8'));
      Object.assign(this.messages, parsed);
    }
  }

  /**
   * メッセージIDに対応するテンプレートを取得し、`{0}`, `{1}`, ...を引数で置換する。
   * @param messageId `i18n`の.iniファイルに定義されたキー。
   * @param params プレースホルダに埋め込む値(順序通り)。
   * @returns 該当キーが見つからない場合は`[Unknown message ID: ...]`を返す。
   */
  get(messageId: string, ...params: (string | number)[]): string {
    const template = this.messages[messageId];
    if (template === undefined) {
      return `[Unknown message ID: ${messageId}]`;
    }
    return template.replace(/\{(\d+)\}/g, (_match: string, index: string) => {
      const value = params[Number(index)];
      if (value === undefined) {
        return `{${index}}`;
      }
      return String(value);
    });
  }
}

/** アプリ全体で共有するシングルトンインスタンス。 */
export const messageCatalog = new MessageCatalog();
