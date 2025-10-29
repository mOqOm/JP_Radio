import 'date-utils';
import { format } from 'util';
import got, { OptionsOfJSONResponseBody, Response } from 'got';
import { spawn, execFile, ChildProcess } from 'child_process';
import * as tough from 'tough-cookie';
import { CookieJar } from 'tough-cookie';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';
import fs from 'fs';

import type { StationInfo, RegionData } from '../models/station.model';
import type { LoginAccount, LoginState } from '../models/auth.model';
import {
  LOGIN_URL, CHECK_URL, AUTH1_URL, AUTH2_URL,
  STATION_AREA_URL, STATION_FULL_URL, PLAY_LIVE_URL, PLAY_TIMEFREE_URL,
  AUTH_KEY, MAX_RETRY_COUNT
} from '../constants/radiko-urls.constants';

import { getI18nString } from './i18nStrings';
import { RadioTime } from './radio-time';
import { LoggerEx } from '../utils/logger';


const xmlParser = new XMLParser({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  removeNSPrefix: true,
  allowBooleanAttributes: true,
});

export default class Radiko {
  private readonly logger: LoggerEx;
  private token: string = '';
  private myAreaId: string = '';
  private cookieJar: CookieJar = new tough.CookieJar();
  private loginState: LoginState | null = null;

  public stations: Map<string, StationInfo> = new Map();
  public areaData: Map<string, { areaName: string; stations: string[] }> = new Map();
  private areaIDs: string[];

  constructor(logger: LoggerEx, areaIDs: string[]) {
    this.logger = logger;
    this.areaIDs = areaIDs;
  }

  public async init(acct: LoginAccount | null = null, forceGetStations = false): Promise<string[]> {
    this.logger.info('JP_Radio::Radiko.init');
    if (acct) {
      this.logger.info('JP_Radio::Attempting login');
      const loginOK = await this.checkLogin() ?? await this.login(acct).then(jar => {
        this.cookieJar = jar;
        return this.checkLogin();
      });
      this.loginState = loginOK;
    }

    if (forceGetStations || !this.myAreaId) {
      [this.token, this.myAreaId] = await this.getToken();
      await this.getStations();
    }
    return [this.myAreaId, this.loginState?.areafree ?? '', this.loginState?.member_type.type ?? '']
  }

  private async login(acct: LoginAccount): Promise<CookieJar> {
    this.logger.info('JP_Radio::Radiko.login');
    const jar = new tough.CookieJar();
    try {
      await got.post(LOGIN_URL, {
        cookieJar: jar,
        form: acct
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
      // TODO: エリアフリー・タイムフリー30・ダブルプランはここで判別できるのか？？？
      const response: Response<any> = await got(CHECK_URL, options);
      const body = response.body as LoginState;
      //this.logger.info(`JP_Radio::checkLogin: Login status=${Object.entries(body)}`);
      //this.logger.info(`JP_Radio::checkLogin: member_type=${Object.entries(body.member_type)}`);
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

//-----------------------------------------------------------------------

  private async getStations(): Promise<void> {
    this.logger.info('JP_Radio::Radiko.getStations: start...');
    const startTime = Date.now();
    this.stations = new Map();
    this.areaData = new Map();

    // 1. フル局データを取得・パース
    const fullRes = await got(STATION_FULL_URL);
    const fullParsed = xmlParser.parse(fullRes.body);
    const regionData: RegionData[] = fullParsed.region.stations.map((region: any) => ({
      region_name: region['@region_name'],
      region_id  : region['@region_id'],
      ascii_name : region['@ascii_name'],
      stations: region.station.map((s: any) => ({
        id        : String(s.id), // FM802対策
        name      : s.name,
        ascii_name: s.ascii_name,
        areafree  : s.areafree,
        timefree  : s.timefree,
        logo      : s.logo[2]['#text'],
        banner    : s.banner,
        area_id   : s.area_id,
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
    const currentAreaID = this.myAreaId ?? '';
    var allowedStations = areaData.get(currentAreaID)?.stations.map(String) ?? [];
    if (this.loginState) {
      for (const id of this.areaIDs) {
        for (const station of areaData.get(id)?.stations.map(String) ?? []) {
          if (!allowedStations.includes(station)) {
            allowedStations = allowedStations.concat(station);
          }
        }
      }
    }

    // 3. regionData をもとに stations を構成
    for (const region of regionData) {
      for (const station of region.stations) {
        if (allowedStations.includes(station.id)) {
          const areaName = areaData.get(station.area_id)?.areaName?.replace(' JAPAN', '') ?? '';
          const areaKanji = getI18nString(`RADIKO_AREA.${station.area_id}`);
          const logoFile = this.saveStationLogoCache(station.logo, `${station.id}_logo.png`);
          this.stations.set(station.id, {   // 'TBS'
            RegionName: region.region_name, // '関東'
            BannerURL : station.banner,     // 'http://radiko.jp/res/banner/radiko_banner.png'
            LogoURL   : logoFile,           // 'https://radiko.jp/v2/static/station/logo/TBS/448x200.png
            AreaId    : station.area_id,    // 'JP13'
            AreaName  : areaName,           // 'TOKYO'
            AreaKanji : areaKanji,          // '東京'
            Name      : station.name,       // 'TBSラジオ'
            AsciiName : station.ascii_name, // 'TBS RADIO'
            AreaFree  : station.areafree,   // '1'
            TimeFree  : station.timefree    // '1'
          });
        }
      }
    }

    const endTime = Date.now();
    const processingTime = endTime - startTime;
    this.logger.info(`JP_Radio::Radiko.getStations: ## COMPLETED ${processingTime}ms ##`);
  }

  private saveStationLogoCache(logoUrl: string, logoFile: string): string {
    const logoPath = `music_service/jp_radio/dist/assets/images/${logoFile}`;
    const fullPath = '/data/plugins/' + logoPath;
    try {
      fs.statSync(fullPath); // ファイルの存在確認
    } catch(e) {
      // 透過PNGは見栄えが悪いので白バックPNGに変換して保存
      execFile('ffmpeg', ['-n', '-i', logoUrl, fullPath,
          '-filter_complex', 'color=white,format=rgb24[c];[c][0]scale2ref[c][i];[c][i]overlay=format=auto:shortest=1,setsar=1'], (err: any) => {
        if (err)  return logoUrl;
      });
      this.logger.info(`JP_Radio::Radiko.saveStationLogoCache: ${logoUrl} => ${logoFile}`);
    }
    return `/albumart?sourceicon=${logoPath}`;
  }

  public getStationInfo(stationId: string): StationInfo | undefined {
    return this.stations?.get(stationId);
  }

  public getStationName(stationId: string): string {
    return this.stations?.get(stationId)?.Name ?? this.getStationAsciiName(stationId);
  }

  public getStationAsciiName(stationId: string): string {
    return this.stations?.get(stationId)?.AsciiName ?? '';
  }

//-----------------------------------------------------------------------

  public async play(stationId: string, query: any): Promise<ChildProcess | null> {
    if (!this.stations?.has(stationId)) {
      this.logger.warn(`JP_Radio::Station not found: ${stationId}`);
      return null;
    }
    var url = format(PLAY_LIVE_URL, stationId);
    var aac = '';
    if (query.ft && query.to) {
      const ft = RadioTime.addTime(RadioTime.revConvertRadioTime(query.ft), query.seek);
      const to = RadioTime.revConvertRadioTime(query.to);
      url = format(PLAY_TIMEFREE_URL, stationId, ft, to);
      //aac = !query.seek ? `/data/INTERNAL/${stationId}_${query.ft}-${query.to}.aac` : '';
    }
    this.logger.info(`JP_Radio::Radiko.play: url=${url}`);

    let m3u8: string | null = null;
    for (let i = 0; i < MAX_RETRY_COUNT; i++) {
      if (!this.token) [this.token, this.myAreaId] = await this.getToken();
      m3u8 = await this.genTempChunkM3u8URL(url, this.token);
      if (m3u8) break;
      this.logger.info('JP_Radio::Retrying stream fetch with new token');
      this.token = '';
    }
    
    if (m3u8) {
      const args = ['-y', '-headers', `X-Radiko-Authtoken:${this.token}`, '-i', m3u8, //'-ss', `${query.seek ?? 0}`,
        '-acodec', 'copy', '-f', 'adts', '-loglevel', 'error', 'pipe:1'];
      if (aac) args.push(aac);
      //this.logger.info(`JP_Radio::Radiko.play: ffmpeg ${args}`);
      return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore', 'ipc'], detached: true });
    } else {
      this.logger.error('JP_Radio::Failed to get playlist URL');
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
      //this.logger.info(`JP_Radio::Radiko.genTempChunkM3u8URL: ${res.body}`);
      return res.body.split('\n').find(line => line.startsWith('http') && line.endsWith('.m3u8')) ?? null;
    } catch (error) {
      this.logger.error('JP_Radio::genTempChunkM3u8URL error');
      return null;
    }
  }
}
