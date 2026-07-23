import 'date-utils';
import { format } from 'util';
import { randomBytes } from 'crypto';
import got, { OptionsOfJSONResponseBody, Response } from 'got';
import { spawn, ChildProcess } from 'child_process';
import * as tough from 'tough-cookie';
import { CookieJar } from 'tough-cookie';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';

import type { StationInfo, RegionData } from './models/station-model';
import type { LoginAccount, LoginState } from './models/auth-model';
import {
  LOGIN_URL, CHECK_URL, AUTH1_URL, AUTH2_URL,
  STATION_AREA_URL, STATION_FULL_URL,
  STATION_STREAM_XML_URL, PLAY_LIVE_QUERY,
  AUTH_KEY, MAX_RETRY_COUNT, PROG_DAILY_STATION_URL
} from './consts/radiko-urls';

import { AreaKanji } from './consts/area-name';

const xmlParser = new XMLParser({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  removeNSPrefix: true,
  allowBooleanAttributes: true,
});

export default class Radiko {
  private token: string | null = null;
  private areaId: string | null = null;
  private cookieJar: CookieJar = new tough.CookieJar();
  private loginState: LoginState | null = null;

  public stations: Map<string, StationInfo> = new Map();
  public stationData: RegionData[] = [];
  public areaData: Map<string, { areaName: string; stations: string[] }> = new Map();

  constructor(private logger: Console, private port: number) { }

  async init(acct: LoginAccount | null = null, forceGetStations = false): Promise<void> {
    if (acct) {
      this.logger.info('JP_Radio::Attempting login');
      let loginOK = await this.checkLogin();
      if (!loginOK) {
        this.cookieJar = await this.login(acct);
        loginOK = await this.checkLogin();
      }
      this.loginState = loginOK;
    }

    if (forceGetStations || !this.areaId) {
      const [token, areaId] = await this.getToken();
      this.token = token;
      this.areaId = areaId;
      await this.getStations();
    }
  }

  async getMyAreaId(): Promise<string> {
    return this.areaId + '/' + (this.loginState ? this.loginState.member_type.type : '');
  }

  private async login(acct: LoginAccount): Promise<CookieJar> {
    this.logger.info('JP_Radio::Radiko.login');
    const jar = new tough.CookieJar();
    try {
      await got.post(LOGIN_URL, {
        cookieJar: jar,
        form: { mail: acct.mail, pass: acct.pass },
      });
      return jar;
    } catch (err: any) {
      if (err.statusCode === 302) return jar;
      this.logger.error('JP_Radio::Login failed', err);
      throw err;
    }
  }

  private async checkLogin(): Promise<LoginState | null> {
    this.logger.info('JP_Radio::Radiko.checkLogin');
    if (!this.cookieJar) {
      this.logger.info('JP_Radio::premium account not set');
      return null;
    }

    try {
      const options: OptionsOfJSONResponseBody = {
        cookieJar: this.cookieJar,
        method: 'GET',
        responseType: 'json'
      };

      const response: Response<any> = await got(CHECK_URL, options);
      const body = response.body as LoginState;

      this.logger.info(`JP_Radio::Login status: ${body.member_type.type}`);
      return body;

    } catch (err: any) {
      const statusCode = err?.response?.statusCode;

      if (statusCode === 400) {
        this.logger.info('JP_Radio::premium not logged in (HTTP 400)');
        return null;
      }

      this.logger.error(`JP_Radio::premium account login check error: ${err.message}`, err);
      return null;
    }
  }

  private async getToken(): Promise<[string, string]> {
    this.logger.info('JP_Radio::Radiko.getToken');
    const auth1Headers = await this.auth1();
    const [partialKey, token] = this.getPartialKey(auth1Headers);
    const result = await this.auth2(token, partialKey);
    const [areaId] = result.trim().split(',');
    this.logger.info(`JP_Radio::Radiko.getToken: areaId=${areaId}`);
    return [token, areaId];
  }

  private async auth1(): Promise<Record<string, string>> {
    this.logger.info('JP_Radio::Radiko.auth1');
    const res = await got.get(AUTH1_URL, {
      cookieJar: this.cookieJar,
      headers: {
        'X-Radiko-App': 'pc_html5',
        'X-Radiko-App-Version': '0.0.1',
        'X-Radiko-User': 'dummy_user',
        'X-Radiko-Device': 'pc',
      },
    });
    return res.headers as Record<string, string>;
  }

  private getPartialKey(headers: Record<string, string>): [string, string] {
    this.logger.info('JP_Radio::Radiko.getPartialKey');
    const token = headers['x-radiko-authtoken'];
    const offset = parseInt(headers['x-radiko-keyoffset'], 10);
    const length = parseInt(headers['x-radiko-keylength'], 10);
    const partialKey = Buffer.from(AUTH_KEY.slice(offset, offset + length)).toString('base64');
    return [partialKey, token];
  }

  private async auth2(token: string, partialKey: string): Promise<string> {
    this.logger.info('JP_Radio::Radiko.auth2');
    const res = await got.get(AUTH2_URL, {
      cookieJar: this.cookieJar,
      headers: {
        'X-Radiko-AuthToken': token,
        'X-Radiko-Partialkey': partialKey,
        'X-Radiko-User': 'dummy_user',
        'X-Radiko-Device': 'pc',
      },
    });
    return res.body;
  }

  private async getStations(): Promise<void> {
    this.logger.info('JP_Radio::Radiko.getStations');
    this.stations = new Map();
    this.areaData = new Map();

    // 1. フル局データを取得・パース
    const fullRes = await got(STATION_FULL_URL);
    const fullParsed = xmlParser.parse(fullRes.body);

    const regionData: RegionData[] = fullParsed.region.stations.map((region: any) => ({
      region_name: region['@region_name'],
      region_id: region['@region_id'],
      ascii_name: region['@ascii_name'],
      stations: region.station.map((s: any) => ({
        id: String(s.id),   // FM802対策
        name: s.name,
        ascii_name: s.ascii_name,
        areafree: s.areafree,
        timefree: s.timefree,
        banner: s.banner,
        area_id: s.area_id,
      })),
    }));

    // 2. 並列数制限付きで47エリア分の取得を並列化
    const limit = pLimit(5);
    const areaIDs = Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);

    await Promise.all(
      areaIDs.map((areaId) =>
        limit(async () => {
          const res = await got(format(STATION_AREA_URL, areaId));
          const parsed = xmlParser.parse(res.body);
          const stations = parsed.stations.station.map((s: any) => s.id);
          this.areaData.set(areaId, {
            areaName: parsed.stations['@area_name'],
            stations,
          });
        })
      )
    );

    const areaData = this.areaData;
    const currentAreaID = this.areaId ?? '';
    const allowedStations = areaData.get(currentAreaID)?.stations.map(String) ?? [];

    // 3. regionData をもとに stations を構成
    for (const region of regionData) {
      for (const station of region.stations) {
        const id = station.id;
        const areaName = areaData.get(station.area_id)?.areaName?.replace(' JAPAN', '') ?? '';
        const areaKanji = AreaKanji.get(station.area_id) ?? areaName;

        if (this.loginState || allowedStations.includes(id)) {
          this.stations.set(id, {          // 'TBS'
            RegionName: region.region_name,// '関東'
            BannerURL: station.banner,     // 'http://radiko.jp/res/banner/radiko_banner.png'
            AreaId: station.area_id,       // 'JP13'
            AreaName: areaName,            // 'TOKYO'
            AreaKanji: areaKanji,          // '東京'
            Name: station.name,            // 'TBSラジオ'
            AsciiName: station.ascii_name, // 'TBS RADIO'
            AreaFree: station.areafree,    // '1'
          });
        }
      }
    }

    this.stationData = regionData;
  }

  async getStationName(stationId: string): Promise<string> {
    return this.stations?.get(stationId)?.Name ?? '';
  }

  async getStationAsciiName(stationId: string): Promise<string> {
    return this.stations?.get(stationId)?.AsciiName ?? '';
  }

  async play(station: string): Promise<ChildProcess | null> {
    this.logger.info(`JP_Radio::Radiko.play station=>${station}`);
    if (!this.stations?.has(station)) {
      this.logger.warn(`JP_Radio::Station not found: ${station}`);
      return null;
    }

    let m3u8: string | null = null;
    for (let i = 0; i < MAX_RETRY_COUNT; i++) {
      if (!this.token) [this.token, this.areaId] = await this.getToken();
      const playlistUrl = await this.getLivePlaylistUrl(station);
      if (playlistUrl) {
        m3u8 = await this.genTempChunkM3u8URL(playlistUrl, this.token);
      }
      if (m3u8) break;
      this.logger.info('JP_Radio::Retrying stream fetch with new token');
      [this.token, this.areaId] = await this.getToken();
    }

    if (!m3u8) {
      this.logger.error('JP_Radio::Failed to get playlist URL');
      return null;
    }

    // medialist/m3u8の取得にはAuthTokenだけでなくRadikoアプリ識別ヘッダー一式が必要
    const streamHeaders = [
      `X-Radiko-Authtoken:${this.token}`,
      'X-Radiko-App:pc_html5',
      'X-Radiko-App-Version:0.0.1',
      'X-Radiko-User:dummy_user',
      'X-Radiko-Device:pc',
    ].join('\r\n') + '\r\n';

    // ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がずRadikoに拒否されるため、
    // プレイリスト取得だけはローカルのプロキシ経由にしてNode側で毎回正しいヘッダーを付けて中継する
    // (セグメント本体は直接Radikoから取得できておりそちらは問題ないので対象外)
    const proxyUrl = `http://127.0.0.1:${this.port}/radiko/medialist-proxy?url=${encodeURIComponent(m3u8)}&token=${encodeURIComponent(this.token!)}`;

    // ffmpegはデフォルトでRange: bytes=0-を付けてシーク可否を確認しにいくが、
    // Radiko側がこれに対して不正な短いレスポンスを返すため、-seekable 0でRangeヘッダー送信を止める
    // -reconnect_at_eofは、プロキシ経由の正常完了したプレイリスト取得までEOFとして再接続扱いしてしまうため外す
    const args = [
      '-loglevel', 'error',
      '-y', '-seekable', '0',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
      '-headers', streamHeaders,
      '-i', proxyUrl, '-acodec', 'copy', '-f', 'adts', 'pipe:1'
    ];

    this.logger.info(`JP_Radio::Radiko.play: ffmpeg ${args}`);

    return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true });
  }

  // ライブ配信のplaylist_create_urlをlocal局ごとのstream XMLから取得し、lsidを付与したURLを組み立てる
  private async getLivePlaylistUrl(station: string): Promise<string | null> {
    try {
      const res = await got(format(STATION_STREAM_XML_URL, station));
      const parsed = xmlParser.parse(res.body);
      const rawEntries = parsed?.urls?.url;
      const entries: any[] = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];

      const liveEntries = entries.filter((entry) => String(entry['@timefree']) === '0');
      const preferAreaFree = this.loginState ? '1' : '0';
      const chosen = liveEntries.find((entry) => String(entry['@areafree']) === preferAreaFree) ?? liveEntries[0];

      const createUrl = chosen?.playlist_create_url;
      if (!createUrl) {
        this.logger.error(`JP_Radio::getLivePlaylistUrl: no playlist_create_url found for ${station}`);
        return null;
      }

      const lsid = randomBytes(16).toString('hex');
      return createUrl + format(PLAY_LIVE_QUERY, station, lsid);
    } catch (err) {
      this.logger.error('JP_Radio::getLivePlaylistUrl error', err);
      return null;
    }
  }

  private async genTempChunkM3u8URL(url: string, token: string): Promise<string | null> {
    try {
      const res = await got(url, {
        headers: {
          'X-Radiko-AuthToken': token,
          'X-Radiko-App': 'pc_html5',
          'X-Radiko-App-Version': '0.0.1',
          'X-Radiko-User': 'dummy_user',
          'X-Radiko-Device': 'pc',
        },
      });

      // HLSマスタープレイリストから#で始まらない最初の行(メディアプレイリストURI)を取得
      // 新方式では variant URL が「.m3u8」で終わらない(例: /medialist?session=...)ことがあるため拡張子では判定しない
      const chunkUrl = res.body
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith('http') && !line.startsWith('#'));
      if (!chunkUrl) {
        this.logger.error(`JP_Radio::genTempChunkM3u8URL: no media playlist URI found. url=${url} status=${res.statusCode} body=${res.body.slice(0, 500)}`);
        return null;
      }
      return chunkUrl;
    } catch (err: any) {
      this.logger.error(`JP_Radio::genTempChunkM3u8URL error url=${url} status=${err?.response?.statusCode} body=${err?.response?.body ?? err?.message}`);
      return null;
    }
  }

  async getProgramDaily(station: string, date: string): Promise<any> {
    const res = await got(format(PROG_DAILY_STATION_URL, station, date));
    return xmlParser.parse(res.body);
  }
}
