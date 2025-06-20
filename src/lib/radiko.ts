import 'date-utils';
import { format } from 'util';
import got, { OptionsOfJSONResponseBody, Options, Response } from 'got';
import { spawn, ChildProcess } from 'child_process';
import * as tough from 'tough-cookie';
import { CookieJar } from 'tough-cookie';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';

import type { StationInfo, RegionData } from './models/StationModel';
import type { LoginAccount, LoginState } from './models/AuthModel';
import {
  LOGIN_URL, CHECK_URL, AUTH1_URL, AUTH2_URL,
  CHANNEL_AREA_URL, CHANNEL_FULL_URL, PLAY_URL,
  AUTH_KEY, MAX_RETRY_COUNT, PROG_DAILY_URL
} from './consts/radikoUrls';

import { AreaKanji } from './consts/areaName';

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

  constructor(
    private port: number,
    private logger: Console,
    private acct: LoginAccount
  ) { }

  async init(acct: LoginAccount | null = null, forceGetStations = false): Promise<void> {
    if (acct) {
      this.logger.info('JP_Radio::Attempting login');
      const loginOK = await this.checkLogin() ?? await this.login(acct).then(jar => {
        this.cookieJar = jar;
        return this.checkLogin();
      });
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
    const fullRes = await got(CHANNEL_FULL_URL);
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
          const res = await got(format(CHANNEL_AREA_URL, areaId));
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
      m3u8 = await this.genTempChunkM3u8URL(format(PLAY_URL, station), this.token);
      if (m3u8) break;
      this.logger.info('JP_Radio::Retrying stream fetch with new token');
      [this.token, this.areaId] = await this.getToken();
    }

    if (!m3u8) {
      this.logger.error('JP_Radio::Failed to get playlist URL');
      return null;
    }

    const args = ['-y', '-headers', `X-Radiko-Authtoken:${this.token}`, '-i', m3u8, '-acodec', 'copy', '-f', 'adts', '-loglevel', 'error', 'pipe:1'];

    this.logger.info(`JP_Radio::Radiko.play: ffmpeg ${args}`);

    return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore', 'ipc'], detached: true });
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

      return res.body.split('\n').find(line => line.startsWith('http') && line.endsWith('.m3u8')) ?? null;
    } catch (err) {
      this.logger.error('JP_Radio::genTempChunkM3u8URL error', err);
      return null;
    }
  }

  async getProgramDaily(station: string, date: string): Promise<any> {
    const res = await got(format(PROG_DAILY_URL, station, date));
    return xmlParser.parse(res.body);
  }
}
