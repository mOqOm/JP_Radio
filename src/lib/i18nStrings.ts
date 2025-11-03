"use strict";
import { format } from 'util';

var i18nStrings: string[];

export function loadI18nStrings(dirname: string, langCode: string): void {
  const fs = require('fs-extra');
  try {
    i18nStrings = fs.readJsonSync(`${dirname}/i18n/strings_${langCode}.json`);
  } catch (e) {
    i18nStrings = fs.readJsonSync(`${dirname}/i18n/strings_en.json`);
  }
}

export function getI18nString(key: any): string {
  var keys = key.split('.');
  var msg = '';
  if (i18nStrings) {
    msg = (keys.length > 1) ? i18nStrings[keys[0]][keys[1]] : i18nStrings[key];
  }
  return msg || key;
}

export function getI18nStringFormat(key: any, ...args: any[]): string {
  const msg = getI18nString(key);
  return format(msg, ...args);
}
