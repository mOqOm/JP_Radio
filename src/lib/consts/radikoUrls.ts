// 認証系
export const LOGIN_URL = 'https://radiko.jp/ap/member/webapi/member/login';
export const CHECK_URL = 'https://radiko.jp/ap/member/webapi/v2/member/login/check';
export const LOGOUT_URL = 'https://radiko.jp/ap/member/webapi/member/logout';
export const AUTH1_URL = 'https://radiko.jp/v2/api/auth1';
export const AUTH2_URL = 'https://radiko.jp/v2/api/auth2';
export const AUTH_KEY = 'bcd151073c03b352e1ef2fd66c32209da9ca0afa';
export const MAX_RETRY_COUNT = 2;

// 再生系
export const PLAY_LIVE_URL = 'https://f-radiko.smartstream.ne.jp/%s/_definst_/simul-stream.stream/playlist.m3u8';
export const PLAY_TIMEFREE_URL = 'https://radiko.jp/v2/api/ts/playlist.m3u8?station_id=%s&l=15&ft=%s&to=%s';

// ステーションリスト
export const STATION_AREA_URL = 'http://radiko.jp/v3/station/list/%s.xml';  // JP13.xml
export const STATION_FULL_URL = 'http://radiko.jp/v3/station/region/full.xml';

// 番組表（エリア別）
export const PROG_DATE_AREA_URL = 'http://radiko.jp/v3/program/date/%s/%s.xml'; // 20250831/JP13.xml
export const PROG_NOW_AREA_URL = 'http://radiko.jp/v3/program/now/%s.xml';      // JP13.xml（直近）
export const PROG_TODAY_AREA_URL = 'http://radiko.jp/v3/program/today/%s.xml';  // JP13.xml（今日；AM5:00に切り替わる）

// 番組表（日付別）
export const PROG_DAILY_STATION_URL = 'http://radiko.jp/v3/program/station/date/%s/%s.xml'; // 20250831/TBS.xml
export const PROG_WEEKLY_STATION_URL = 'http://radiko.jp/v3/program/station/weekly/%s.xml'; // TBS.xml（前後１週間＝-7~+6）
