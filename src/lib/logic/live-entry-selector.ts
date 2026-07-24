import { toArray } from '../utils/xml';

/**
 * 局ごとのstream XMLから得られる配信エントリ一覧(単一オブジェクト/配列/未定義のいずれか)から、
 * ライブ配信(timefree==='0')かつログイン状態に応じたareafreeを優先して1件選択する。
 * 該当がなければライブ配信対象の先頭を返す。
 * @param rawEntries stream XMLをパースして得た配信エントリ(単一オブジェクト/配列/未定義のいずれか)。
 * @param isLoggedIn Radikoプレミアム会員としてログイン済みかどうか。
 * @returns 選択された配信エントリ。ライブ配信対象が1件もなければundefined。
 */
export function selectLiveEntry(rawEntries: any, isLoggedIn: boolean): any | undefined {
  const entries = toArray(rawEntries);
  const liveEntries = entries.filter((entry) => String(entry['@timefree']) === '0');

  let preferAreaFree: string;
  if (isLoggedIn === true) {
    preferAreaFree = '1';
  } else {
    preferAreaFree = '0';
  }

  let chosen = liveEntries.find((entry) => String(entry['@areafree']) === preferAreaFree);
  if (chosen === undefined) {
    chosen = liveEntries[0];
  }
  return chosen;
}
