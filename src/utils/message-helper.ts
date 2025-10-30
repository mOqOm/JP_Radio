import fs from 'fs';
import ini from 'ini';
import path from 'path';

export type MessageParams = Record<string, string | number>;

export class MessageHelper {
  private messages: Record<string, string> = {};
  private lang: string = 'ja';
  private readonly baseDir: string = path.resolve(__dirname, './i18n');

  constructor(lang: string = 'ja') {
    this.setLanguage(lang);
  }

  public setLanguage(lang: string) {
    this.lang = lang;
    this.loadMessages();
  }

  private loadMessages() {
    const filePath = path.join(this.baseDir, `${this.lang}.ini`);
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      this.messages = ini.parse(data);
    } catch (err) {
      console.error(`[MessageHelper] Failed to load messages: ${filePath}`, err);
      this.messages = {};
    }
  }

  public get(id: string, params: MessageParams = {}): string {
    const template = this.messages[id];
    if (!template) return `[Unknown message ID: ${id}]`;

    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return params[key] !== undefined ? String(params[key]) : `{${key}}`;
    });
  }
}

export const messageHelper = new MessageHelper();
