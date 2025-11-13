import { format } from 'util';
import got from 'got';
import { spawn, execFile, ChildProcess } from 'child_process';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';
import fs from 'fs';

// 定数のインポート
import {
  STATION_AREA_URL, STATION_FULL_URL, PLAY_LIVE_URL, PLAY_TIMEFREE_URL,
  MAX_RETRY_COUNT
} from '@/constants/radiko-urls.constants';
import { RADIKO_XML_PARSER_OPTIONS } from '@/constants/radiko-xml.constants';

// Modelのインポート
import type { StationInfo } from '@/models/station.model';
import type { LoginAccount, LoginState } from '@/models/auth.model';
import type { RegionDataParsed, StationParsed } from '@/models/radiko-xml-full-station.model';
import type { RadikoMyInfo } from '@/models/radiko-myinfo.model';

import type { DateOnly, DateTime } from '@/types/date-time.types';

// Logicのインポート
import { RadikoAuthLogic } from '@/logic/radiko-auth.logic';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';
import { parseFullStationXML } from '@/utils/radiko-xml-parser.util';
import { getPrefKanji, getPrefRomaji } from '@/utils/radiko-area.util';


export default class RadikoService {
  // LoggerEx はプロジェクト全体のグローバルから取得
  private readonly logger: LoggerEx = (globalThis as any).JP_RADIO_LOGGER;

  private readonly authLogic: RadikoAuthLogic;
  private token: string = '';
  /** JPXX （例: JP13） */
  private myAreaId: string = '';
  private loginState: LoginState | null = null;

  private stations: Map<string, StationInfo> = new Map();
  public areaData: Map<string, { areaName: string; stations: string[] }> = new Map();
  private readonly areaIdArray: string[];
  private readonly xmlParser: XMLParser = new XMLParser(RADIKO_XML_PARSER_OPTIONS);

  constructor(areaIdArray: string[]) {
    this.areaIdArray = areaIdArray;
    // 認証系
    this.authLogic = new RadikoAuthLogic(this.logger);
  }

  /**
   * 初期化処理
   * @param loginAccount ログインアカウント
   * @param forceGetStations 強制的に局情報取得
   */
  public async init(loginAccount: LoginAccount | null = null, forceGetStations = false): Promise<RadikoMyInfo> {
    this.logger.info('JRADI03SI0001');

    // ログインアカウントがある場合はログイン処理
    if (loginAccount) {
      this.logger.info('JRADI03SI0002');

      try {
        await this.authLogic.login(loginAccount);
        //this.loginState = loginState;
        this.logger.info('JRADI03SI0003');
      } catch (error: any) {
        // Radikoのログイン失敗でプラグイン全体の処理を止めないようにするのでエラーを握りつぶす
        if (error.response.statusCode === 401) {
          // パスワード/メールアドレス間違い
          this.logger.warn('JRADI03SW0001');
        } else {
          // TODO:ポップアップでログインできない旨を表示
          this.logger.error('JRADI03SE0005', error);
        }
      }
    }

    this.loginState = await this.authLogic.checkLogin();

    // 再生用のトークン取得・局情報取得
    if (forceGetStations === true || !this.myAreaId) {
      [this.token, this.myAreaId] = await this.authLogic.getToken();
      await this.getRadikoServerStationsInfo();
    }

    const radikoMyInfo: RadikoMyInfo = {
      /** JPXX （例: JP13） */
      areaId: this.myAreaId,
      /** エリアフリー: 0 =不可, 1 =可 */
      areafree: this.loginState?.areafree ?? '',
      /** 会員種別: 'free' | 'premium' など */
      member_type: this.loginState?.member_type.type ?? '',
      /** 受信可能局数 */
      cntStations: this.loginState?.cntStations ?? 0
    }

    return radikoMyInfo;
  }

  // Radikoから取得して保持している局情報を返す
  public getStations(): Map<string, StationInfo> {
    return this.stations;
  }

  /**
   * Radikoから局情報取得・パース
   */
  private async getRadikoServerStationsInfo(): Promise<void> {
    this.logger.info('JRADI03SI0011');

    const startTime = Date.now();

    // 1. フル局データを取得・パース
    const fullResponse = await got(STATION_FULL_URL);
    const regionDataArray: RegionDataParsed[] = parseFullStationXML(fullResponse.body);

    // 2. 並列数制限付きで47エリア分の取得を並列化
    const limit = pLimit(5);
    const areaIdArray: string[] = Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);

    await Promise.all(
      areaIdArray.map(areaId =>
        limit(async () => {
          const res = await got(format(STATION_AREA_URL, areaId));
          const parsed = this.xmlParser.parse(res.body);
          const stations: string[] = parsed.stations.station.map((s: any) => s.id);

          this.areaData.set(areaId, {
            areaName: parsed.stations['@area_name'],
            stations,
          });
        })
      )
    );

    // 3. エリアに応じた許可局の決定
    const areaData = this.areaData;

    let currentAreaId: string = '';
    if (this.myAreaId !== undefined && this.myAreaId !== null) {
      currentAreaId = this.myAreaId;
    }


    let allowedStations: string[] = areaData.get(currentAreaId)?.stations.map(String) ?? [];

    // ログイン済みの場合のみ
    if (this.loginState !== null) {
      for (const areaId of this.areaIdArray as string[]) {
        for (const station of areaData.get(areaId)?.stations.map(String) ?? []) {
          if (!allowedStations.includes(station)) {
            allowedStations.push(station);
          }
        }
      }
    }

    // 4. regionData をもとに stations を構成
    for (const regionData of regionDataArray as RegionDataParsed[]) {
      // 各地域の局ごとに処理
      for (const station of regionData.stations as StationParsed[]) {
        // 許可局の場合のみ登録
        if (allowedStations.includes(station.id) === true) {
          // 都道府県名のローマ字
          const areaName: string = getPrefRomaji(station.area_id);
          // 都道府県名の漢字
          const areaKanji: string = getPrefKanji(station.area_id);
          // ロゴ
          const logoFile: string = this.saveStationLogoCache(station.logos[2].url, `${station.id}_logo.png`);

          this.stations.set(station.id, {
            // '関東'
            RegionName: regionData.region_name,
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
    this.logger.info('JRADI03SI0012', endTime - startTime);
  }

  private saveStationLogoCache(logoUrl: string, logoFile: string): string {
    // path.resolve(process.cwd(), 'hoge');←を使うように
    const logoPath: string = `music_service/jp_radio/assets/images/${logoFile}`;
    const fullPath: string = `/data/plugins/${logoPath}`;

    try {
      // ファイルの存在確認
      fs.statSync(fullPath);
    } catch (e) {
      // 透過PNGは見栄えが悪いので白バックPNGに変換して保存
      execFile('ffmpeg', ['-n', '-i', logoUrl, fullPath,
        '-filter_complex',
        'color=white,format=rgb24[c];[c][0]scale2ref[c][i];[c][i]overlay=format=auto:shortest=1,setsar=1'
      ], (err: any) => {
        if (err) {
          return logoUrl;
        }
      });

      this.logger.info('JRADI03SI0013', logoUrl, logoFile);
    }

    return `/albumart?sourceicon=${logoPath}`;
  }

  // --- Station Info ---
  public getStationInfo(stationId: string): StationInfo {
    if (this.stations !== undefined && this.stations !== null && this.stations.has(stationId) === true) {
      const stationInfoMap: Map<string, StationInfo> = this.getStations();

      const stationInfo: StationInfo | undefined = stationInfoMap.get(stationId);

      if (stationInfo !== undefined && stationInfo !== null) {
        return stationInfo;
      }
    }
    // 該当局情報が存在しない場合は空オブジェクトを返す
    return {} as StationInfo;
  }

  public getStationName(stationId: string): string {
    return this.stations?.get(stationId)?.Name ?? this.getStationAsciiName(stationId);
  }

  public getStationAsciiName(stationId: string): string {
    return this.stations?.get(stationId)?.AsciiName ?? '';
  }

  // --- Play ---
  public async play(stationId: string, query: any): Promise<ChildProcess> {
    // this.stationsに再生時のStationIdが含まれているか確認
    if (!this.stations?.has(stationId)) {
      // StationIdが含まれていなければLogにWarnとして書き込む
      this.logger.warn('JRADI03SW0001', stationId);
      throw new Error(`Station ID ${stationId} is not available for playback.`);
    }

    let url: string = format(PLAY_LIVE_URL, stationId);
    //let aac: string = '';

    if (query.ft && query.to) {
      let ftDateTime: DateTime = broadcastTimeConverter.parseStringToDateTime(query.ft);
      let toDateTime: DateTime = broadcastTimeConverter.parseStringToDateTime(query.to);
      let seekSeconds: number = query.seek ? parseInt(query.seek, 10) : 0;

      // Seekが指定されている場合、開始時間を調整
      const adjustedStartDateTime: DateTime = broadcastTimeConverter.addSecondsTime(ftDateTime, seekSeconds);

      const ftDateTimeStr: string = format(adjustedStartDateTime, 'yyyyMMddhhmmss');
      const toDateTimeStr: string = format(toDateTime, 'yyyyMMddhhmmss');


      url = format(PLAY_TIMEFREE_URL, stationId, ftDateTimeStr, toDateTimeStr);
    }
    this.logger.info('JRADI03SI0014', url);

    let m3u8: string = '';

    for (let i = 0; i < MAX_RETRY_COUNT; i++) {
      // トークンがなければ取得
      if (this.token === undefined || this.token === null || this.token === '') {
        [this.token, this.myAreaId] = await this.authLogic.getToken();
      }

      try {
        m3u8 = await this.genTempChunkM3u8URL(url, this.token);
        break;
      } catch (error: any) {
        if (MAX_RETRY_COUNT > i) {
          // 再試行
          this.logger.info('JRADI03SI0015');
          this.token = '';
          this.logger.error('JRADI03SE0001', error);
        } else {
          // 最大再試行回数到達したので例外をスロー
          this.logger.error('JRADI03SE0001', error);
          throw error;
        }
      }
    }

    // M3U8が空の場合のエラー
    if (m3u8 === '') {
      this.logger.error('JRADI03SE0001');
      throw new Error('M3U8 URL not found');
    }

    const args: string[] = [
      '-y',
      '-headers', `X-Radiko-Authtoken:${this.token}`,
      '-i', m3u8,
      '-acodec', 'copy',
      '-f', 'adts',
      '-loglevel', 'error',
      'pipe:1'
    ];

    /*if (aac) {
      args.push(aac);
    }*/

    return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore', 'ipc'], detached: true });
  }

  private async genTempChunkM3u8URL(url: string, token: string): Promise<string> {
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

      const m3u8Line: string | undefined = res.body.split('\n').find((line: string) => line.startsWith('http') && line.endsWith('.m3u8'));

      // M3U8行が見つからない場合のエラー
      if (m3u8Line === undefined || m3u8Line === null || m3u8Line === '') {
        this.logger.error('JRADI03SE0003');
        throw new Error('M3U8 URL not found in response');
      }

      return m3u8Line;
    } catch (error: any) {
      this.logger.error('JRADI03SE0002', error);
      throw error;
    }
  }
}
