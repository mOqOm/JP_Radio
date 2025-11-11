/**
 * 日付・時刻文字列のパース処理
 * - DateOnly (yyyyMMdd) と DateTime (yyyyMMddHHmmss / yyyyMMddHHmmssSSS) をパース
 * - 厳格モードと寛容モードを提供
 */

import type { DateOnly, DateTime } from '@/types/date-time.types';

/**
 * 文字列を DateOnly にパース（厳格モード）
 * - yyyyMMdd 形式（8桁）のみ受け付ける
 * - 不正な形式の場合は例外をスロー
 *
 * @param value パース対象の文字列
 * @returns DateOnly（時分秒ミリ秒は 00:00:00.000）
 * @throws Error 形式が不正な場合
 */
export function parseToDate(value: string): DateOnly {
    if (!/^\d{8}$/.test(value)) {
        throw new Error(`Invalid date format: ${value} (expected: yyyyMMdd)`);
    }

    const year = parseInt(value.substring(0, 4), 10);
    const month = parseInt(value.substring(4, 6), 10);
    const day = parseInt(value.substring(6, 8), 10);

    // 日付の妥当性チェック
    if (month < 1 || month > 12) {
        throw new Error(`Invalid month: ${month} in ${value}`);
    }

    const date = new Date(year, month - 1, day, 0, 0, 0, 0);

    // Date コンストラクタが自動補正する場合を検出
    // 例: 2025-02-30 → 2025-03-02 になるのを防ぐ
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        throw new Error(`Invalid date: ${value} (does not exist in calendar)`);
    }

    return date as DateOnly;
}

/**
 * 文字列を DateTime にパース（厳格モード）
 * - yyyyMMddHHmmss（14桁、秒まで）
 * - yyyyMMddHHmmssSSS（17桁、ミリ秒まで）
 * - 上記以外は例外をスロー
 *
 * @param value パース対象の文字列
 * @returns DateTime
 * @throws Error 形式が不正な場合
 */
export function parseToDateTime(value: string): DateTime {
    let year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number;

    if (/^\d{14}$/.test(value)) {
        // yyyyMMddHHmmss（秒まで）
        year = parseInt(value.substring(0, 4), 10);
        month = parseInt(value.substring(4, 6), 10);
        day = parseInt(value.substring(6, 8), 10);
        hour = parseInt(value.substring(8, 10), 10);
        minute = parseInt(value.substring(10, 12), 10);
        second = parseInt(value.substring(12, 14), 10);
        ms = 0;
    } else if (/^\d{17}$/.test(value)) {
        // yyyyMMddHHmmssSSS（ミリ秒まで）
        year = parseInt(value.substring(0, 4), 10);
        month = parseInt(value.substring(4, 6), 10);
        day = parseInt(value.substring(6, 8), 10);
        hour = parseInt(value.substring(8, 10), 10);
        minute = parseInt(value.substring(10, 12), 10);
        second = parseInt(value.substring(12, 14), 10);
        ms = parseInt(value.substring(14, 17), 10);
    } else {
        throw new Error(`Invalid datetime format: ${value} (expected: yyyyMMddHHmmss or yyyyMMddHHmmssSSS)`);
    }

    // 日付・時刻の妥当性チェック
    if (month < 1 || month > 12) {
        throw new Error(`Invalid month: ${month} in ${value}`);
    }
    if (hour < 0 || hour > 23) {
        throw new Error(`Invalid hour: ${hour} in ${value}`);
    }
    if (minute < 0 || minute > 59) {
        throw new Error(`Invalid minute: ${minute} in ${value}`);
    }
    if (second < 0 || second > 59) {
        throw new Error(`Invalid second: ${second} in ${value}`);
    }
    if (ms < 0 || ms > 999) {
        throw new Error(`Invalid millisecond: ${ms} in ${value}`);
    }

    const date = new Date(year, month - 1, day, hour, minute, second, ms);

    // Date コンストラクタが自動補正する場合を検出
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second ||
        date.getMilliseconds() !== ms
    ) {
        throw new Error(`Invalid datetime: ${value} (does not exist in calendar)`);
    }

    return date as DateTime;
}

/**
 * 文字列を DateOnly にパース（寛容モード）
 * - 不正な形式の場合は null を返す（例外をスローしない）
 *
 * @param value パース対象の文字列
 * @returns DateOnly または null
 */
export function tryParseToDate(value: string): DateOnly | null {
    try {
        return parseToDate(value);
    } catch {
        return null;
    }
}

/**
 * 文字列を DateTime にパース（寛容モード）
 * - 不正な形式の場合は null を返す（例外をスローしない）
 *
 * @param value パース対象の文字列
 * @returns DateTime または null
 */
export function tryParseToDateTime(value: string): DateTime | null {
    try {
        return parseToDateTime(value);
    } catch {
        return null;
    }
}

/**
 * 文字列を自動判別してパース（DateOnly または DateTime）
 * - 8桁 → DateOnly
 * - 14桁 or 17桁 → DateTime
 * - その他 → 例外
 *
 * @param value パース対象の文字列
 * @returns DateOnly または DateTime
 * @throws Error 形式が不正な場合
 */
export function parseToDateAuto(value: string): DateOnly | DateTime {
    if (/^\d{8}$/.test(value)) {
        return parseToDate(value);
    }
    if (/^\d{14}$/.test(value) || /^\d{17}$/.test(value)) {
        return parseToDateTime(value);
    }
    throw new Error(`Invalid date/datetime format: ${value}`);
}

/**
 * 文字列を自動判別してパース（寛容モード）
 *
 * @param value パース対象の文字列
 * @returns DateOnly, DateTime, または null
 */
export function tryParseToDateAuto(value: string): DateOnly | DateTime | null {
    try {
        return parseToDateAuto(value);
    } catch {
        return null;
    }
}