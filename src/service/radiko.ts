import 'date-utils';
import { format } from 'util';
import got from 'got';
import { spawn, execFile, ChildProcess } from 'child_process';
import { CookieJar } from 'tough-cookie';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';
import fs from 'fs';

// 定数のインポート
import {
 STATION_AREA_URL, STATION_FULL_URL, PLAY_LIVE_URL, PLAY_TIMEFREE_URL,
 MAX_RETRY_COUNT
} from '@/constants/radiko-urls.constants';

// Modelのインポート
import type { StationInfo, RegionData } from '@/models/station.model';
import type { LoginAccount, LoginState } from '@/models/auth.model';

// Logicのインポート
import { RadikoAuthLogic } from '@/logic/radiko-auth.logic';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { MessageHelper } from '@/utils/message-helper.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';

const xmlParser = new XMLParser({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  removeNSPrefix: true,
  allowBooleanAttributes: true,
});

export default class RadikoService {
  private readonly logger: LoggerEx;
  private readonly messageHelper: MessageHelper;
  private readonly authLogic: RadikoAuthLogic;
  private token: string = '';
  private myAreaId: string = '';
  private loginState: LoginState | null = null;

  public stations: Map<string, StationInfo> = new Map();
  public areaData: Map<string, { areaName: string; stations: string[] }> = new Map();
  private areaIDs: string[];

  constructor(logger: LoggerEx, messageHelper: MessageHelper, areaIDs: string[]) {
    this.logger = logger;
    this.messageHelper = messageHelper;
    this.areaIDs = areaIDs;
    this.authLogic = new RadikoAuthLogic(logger);
  }

  /**
   * 初期化処理
   * @param acct ログインアカウント
   * @param forceGetStations 強制的に局情報取得
   */
  public async init(acct: LoginAccount | null = null, forceGetStations = false):
    Promise<string[]> {
    this.logger.info('RADI0001I0001');

    if (acct) {
      this.logger.info('RADI0001I0002');
      let loginOK = await this.authLogic.checkLogin();
      if (!loginOK) {
        await this.authLogic.login(acct);
        loginOK = await this.authLogic.checkLogin();
      }
      this.loginState = loginOK;
    }

    if (forceGetStations || !this.myAreaId) {
      [this.token, this.myAreaId] = await this.authLogic.getToken();
      await this.getStations();
    }

    return [this.myAreaId, this.loginState?.areafree ?? '', this.loginState?.member_type.type ?? ''];
  }

  /**
   * 局情報取得・パース
   */
  private async getStations(): Promise<void> {
    this.logger.info('RADI0001I0011');
    const startTime = Date.now();
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
        id: String(s.id), // FM802対策
        name: s.name,
        ascii_name: s.ascii_name,
        areafree: s.areafree,
        timefree: s.timefree,
        logo: s.logo[2]['#text'],
        banner: s.banner,
        area_id: s.area_id,
      })),
    }));

    // 2. 並列数制限付きで47エリア分の取得を並列化
    const limit = pLimit(5);
    const areaIDs = Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
    await Promise.all(
      areaIDs.map(areaId =>
        limit(async() => {
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

    // 3. エリアに応じた許可局の決定
    const areaData = this.areaData;
    const currentAreaID = this.myAreaId ?? '';
    let allowedStations = areaData.get(currentAreaID)?.stations.map(String) ?? [];
    if (this.loginState) {
      for (const id of this.areaIDs) {
        for (const station of areaData.get(id)?.stations.map(String) ?? []) {
          if (!allowedStations.includes(station)) {
            allowedStations.push(station);
          }
        }
      }
    }

    // 4. regionData をもとに stations を構成
    for (const region of regionData) {
      for (const station of region.stations) {
        if (allowedStations.includes(station.id)) {
          const areaName = areaData.get(station.area_id)?.areaName?.replace(' JAPAN', '') ?? '';
          const areaKanji = this.messageHelper.get(`RADIKO_AREA.${station.area_id}`);
          const logoFile = this.saveStationLogoCache(station.logo, `${station.id}_logo.png`);
          this.stations.set(
            // 'TBS'
            station.id, {
              // '関東'
              RegionName: region.region_name,
              // 'http://radiko.jp/res/banner/radiko_banner.png'
              BannerURL: station.banner,
              // 'https://radiko.jp/v2/static/station/logo/TBS/448x200.png
              LogoURL: logoFile,
              // 'JP13'
              AreaId: station.area_id,
              // 'TOKYO'
              AreaName: areaName,
              // '東京'
              AreaKanji: areaKanji,
              // 'TBSラジオ'
              Name: station.name,
              // 'TBS RADIO'
              AsciiName: station.ascii_name,
              // '1'
              AreaFree: station.areafree,
              // '1'
              TimeFree: station.timefree
          });
        }
      }
    }

    const endTime = Date.now();
    this.logger.info('RADI0001I0012', endTime - startTime);
  }

  private saveStationLogoCache(logoUrl: string, logoFile: string): string {
    const logoPath = `music_service/jp_radio/dist/assets/images/${logoFile}`;
    const fullPath = '/data/plugins/' + logoPath;
    try {
      // ファイルの存在確認
      fs.statSync(fullPath);
    } catch (e) {
      // 透過PNGは見栄えが悪いので白バックPNGに変換して保存
      execFile('ffmpeg', ['-n', '-i', logoUrl, fullPath,
        '-filter_complex',
        'color=white,format=rgb24[c];[c][0]scale2ref[c][i];[c][i]overlay=format=auto:shortest=1,setsar=1'
      ], (err: any) => {
        if (err) return logoUrl;
      });
      this.logger.info('RADI0001I0013', logoUrl, logoFile);
    }
    return `/albumart?sourceicon=${logoPath}`;
  }

  // --- Station Info ---
  public getStationInfo(stationId: string): StationInfo | undefined {
    return this.stations?.get(stationId);
  }

  public getStationName(stationId: string): string {
    return this.stations?.get(stationId)?.Name ?? this.getStationAsciiName(stationId);
  }

  public getStationAsciiName(stationId: string): string {
    return this.stations?.get(stationId)?.AsciiName ?? '';
  }

  // --- Play ---
  public async play(stationId: string, query: any): Promise<ChildProcess | null> {
    if (!this.stations?.has(stationId)) {
      this.logger.warn('RADI0001W0001', stationId);
      return null;
    }

    let url = format(PLAY_LIVE_URL, stationId);
    let aac = '';
    if (query.ft && query.to) {
      const ft = broadcastTimeConverter.addTime(broadcastTimeConverter.revConvertRadioTime(query.ft), query.seek);
      const to = broadcastTimeConverter.revConvertRadioTime(query.to);
      url = format(PLAY_TIMEFREE_URL, stationId, ft, to);
    }
    this.logger.info('RADI0001I0014', url);

    let m3u8: string | null = null;
    for (let i = 0; i < MAX_RETRY_COUNT; i++) {
      if (!this.token) [this.token, this.myAreaId] = await this.authLogic.getToken();
      m3u8 = await this.genTempChunkM3u8URL(url, this.token);
      if (m3u8) break;
      this.logger.info('RADI0001I0015');
      this.token = '';
    }

    if (!m3u8) {
      this.logger.error('RADI0001E0003');
      return null;
    }

    const args = [
      '-y',
      '-headers', `X-Radiko-Authtoken:${this.token}`,
      '-i', m3u8,
      '-acodec', 'copy',
      '-f', 'adts',
      '-loglevel', 'error',
      'pipe:1'
    ];
    if (aac) args.push(aac);
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
    } catch (error) {
      this.logger.error('RADI0001E0004');
      return null;
    }
  }
}
