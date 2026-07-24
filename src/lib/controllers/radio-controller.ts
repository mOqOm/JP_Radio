import express, { Application, Request, Response } from 'express';
import cron from 'node-cron';
import RdkProg from '@/services/prog-service';
import Radiko from '@/services/radiko-service';
import StreamSession from '@/services/stream-session-service';
import type { BrowseItem, BrowseList, BrowseResult } from '@/models/browse-result-model';
import type { StationInfo } from '@/models/station-model';
import type { LoginAccount } from '@/models/auth-model';
import type { TrackMeta } from '@/models/track-meta-model';
import type { TimefreeQuery } from '@/models/timefree-query-model';
import type { ProgInfoData } from '@/models/prog-info-model';

import { DELAY_SEC, getCurrentRadioTime, formatTimeString, formatHourMinute, getTimeSpan, isWithinTimefreeWindow, revCnvRadioTime, addSecondsToTimeString } from '@/utils/radio-time';
import { resolveAreaIdArray } from '@/logic/area-resolver';
import { messageCatalog } from '@/utils/message-catalog';


/**
 * RadikoストリーミングのためのExpress HTTPサーバ兼コントローラ。
 * {@link Radiko}(Model)から局一覧・番組データを取得してVolumioのBrowse/再生用データに変換し、
 * `/radiko/play/:stationID`へのリクエストごとに{@link StreamSession}でffmpegストリームを開始する。
 */
export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;
  private readonly port: number;
  private readonly logger: Console;
  private readonly acct: LoginAccount | null;
  private readonly commandRouter: any;
  private prg: RdkProg | null = null;
  private rdk: Radiko | null = null;
  private station: string = '';
  private task2Cnt: number = 0;

  private readonly serviceName: string;
  private readonly browseMode1: string;
  private readonly browseMode2: string;
  private readonly radikoAreaIdArray: string[];
  private readonly tempo: number;

  /** タイムフリー再生の途中再開用の進捗(局・番組・再生位置)。同じ番組を選び直した時だけ使う。 */
  private timefreeProgress: { station: string; ft: string; to: string; positionSec: number } | null = null;
  private timefreeProgressTimer: ReturnType<typeof setInterval> | null = null;

  constructor(port = 0, logger: Console, acct: LoginAccount | null = null, commandRouter: any, serviceName: string, browseMode1 = 'type1', browseMode2 = 'type1', radikoAreaIdArray: string[] = [], tempo = 1) {
    this.app = express();
    this.port = port;
    this.logger = logger;
    this.acct = acct;
    this.commandRouter = commandRouter;
    this.serviceName = serviceName;
    this.browseMode1 = browseMode1;
    this.browseMode2 = browseMode2;
    this.radikoAreaIdArray = radikoAreaIdArray;
    this.tempo = tempo;

    // 番組表データ更新（6h間隔）
    this.task1 = cron.schedule('0 5,11,17,23 * * *', this.#pgupdate.bind(this), {
      scheduled: false
    });
    // 再生画面更新（60s間隔;getCurrentRadioTimeに対して1sずらし）
    this.task2 = cron.schedule(`${DELAY_SEC + 1} * * * * *`, this.#pushSongState.bind(this), {
      scheduled: false
    });

    this.#setupRoutes();
  }

  /**
   * Express上に局一覧取得・プレイリストプロキシ・再生ストリーム配信の各ルートを登録する。
   */
  #setupRoutes(): void {
    this.logger.info('JP_Radio::JpRadio.#setupRoutes');

    this.app.get('/radiko/all/stations', async (_req: Request, res: Response) => {
      try {
        const data = await this.prg?.allData();
        // 自動で JSON に変換
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: 'Failed to retrieve station data' });
      }
    });


    // ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がないため、
    // プレイリスト取得はここを経由させ、Radiko(Model)側で毎回正しいヘッダーを付けて中継する
    this.app.get('/radiko/medialist-proxy', async (req: Request, res: Response): Promise<void> => {
      if (this.rdk === null) {
        res.status(500).send('JP_Radio::Radiko instance not initialized');
        return;
      }
      const upstreamUrl = String(req.query['url'] || '');
      const token = String(req.query['token'] || '');
      const startedAt = Date.now();
      try {
        const { contentType, body } = await this.rdk.fetchMedialist(upstreamUrl, token);
        // ローカルプロキシは応答が速すぎてffmpegのリロード間隔計算を狂わせるため、最低待機時間を設ける
        // (5sだと体感の遅延が大きいため2sに短縮)
        const minDurationMs = 2000;
        const elapsed = Date.now() - startedAt;
        if (elapsed < minDurationMs) {
          await new Promise(resolve => setTimeout(resolve, minDurationMs - elapsed));
        }
        res.set('Content-Type', contentType);
        res.send(body);
      } catch (error: any) {
        this.logger.error(`JP_Radio::medialist-proxy error: ${error?.message || error}`);
        res.status(502).send('proxy error');
      }
    });

    this.app.get('/radiko/play/:stationID', async (req: Request, res: Response): Promise<void> => {
      // FM802対策
      this.station = String(req.params['stationID']);
      this.logger.info(`JP_Radio::JpRadio.#setupRoutes.get=> req.originalUrl=${req.originalUrl}`);

      if (this.rdk === null || this.rdk.stations?.has(this.station) === false) {
        let msg: string;
        if (this.rdk === null) {
          msg = 'JP_Radio::Radiko instance not initialized';
        } else {
          msg = `JP_Radio::${this.station} not in available stations`;
        }
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }

      const ft = req.query['ft'];
      const to = req.query['to'];
      let timefreeQuery: TimefreeQuery | undefined;
      if (typeof ft === 'string' && typeof to === 'string') {
        timefreeQuery = { ft, to };
      } else {
        timefreeQuery = undefined;
      }

      let resumeSeek: string | undefined;
      let resumePositionSec = 0;
      if (timefreeQuery !== undefined) {
        const resume = this.#resolveResume(this.station, timefreeQuery);
        resumeSeek = resume.seek;
        resumePositionSec = resume.positionSec;
      }

      const session = new StreamSession(
        this.rdk,
        this.station,
        this.logger,
        () => {
          if (timefreeQuery === undefined) {
            // max60sも待ちたくないのですぐ呼ぶ
            setTimeout(this.#pushSongState.bind(this), 3000);
            this.task2.start();
          } else {
            setTimeout(() => this.#pushTimefreeState(timefreeQuery, resumePositionSec), 3000);
            this.#startTimefreeProgressTracking();
          }
        },
        () => {
          if (timefreeQuery === undefined) {
            this.task2.stop();
          } else {
            this.#stopTimefreeProgressTracking();
          }
        },
        timefreeQuery,
        this.tempo,
        resumeSeek,
      );
      session.start(res);
    });

    this.app.get('/radiko/', (_req: Request, res: Response) => {
      res.send("Hello, world. You're at the radiko_app index.");
    });
  }

  /**
   * 現在の番組情報を取得し、Volumioのステートマシンへ曲名・アーティスト・再生位置を反映する。
   */
  async #pushSongState(): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();
    // 番組の切り替わりで更新
    if (state.seek >= state.duration * 1000 || --this.task2Cnt <= 0) {
      // 念のため10分間隔で強制更新
      this.task2Cnt = 10;
      const progData = await this.prg?.getCurProgram(this.station);
      if (progData !== undefined) {
        const stationName = await this.rdk?.getStationName(this.station);
        const t0 = formatTimeString(progData.ft);
        const t1 = formatTimeString(progData.tt);
        const now = formatTimeString(getCurrentRadioTime());
        const artist = `${stationName} / ${formatHourMinute(progData.ft)}-${formatHourMinute(progData.tt)}`;
        this.logger.info(`JP_Radio::JpRadio.#pushSongState: ${t0}-${t1}`);
        this.logger.info(`JP_Radio::JpRadio.#pushSongState: "${artist}", now=${now}`);

        state.title = progData.title;
        state.artist = artist;
        state.albumart = progData.img || state.albumart;
        // sec
        state.duration = getTimeSpan(t0, t1);
        // msec
        state.seek = getTimeSpan(t0, now) * 1000;

        // workaround to allow state to be pushed when not in a volatile state
        const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
        queueItem.name = state.title;
        queueItem.artist = state.artist;
        queueItem.albumart = state.albumart;
        queueItem.duration = state.duration;

        // reset volumio internal timer
        this.commandRouter.stateMachine.currentSeek = state.seek;
        this.commandRouter.stateMachine.currentSongDuration = state.duration;

        // volumio push state
        this.commandRouter.servicePushState(state, 'mpd');
        return;

      }
    }
  }

  /**
   * タイムフリー再生の途中再開位置を解決する。直前に再生していたのと同じ局・同じ番組(`ft`/`to`が一致)を
   * 選び直した場合のみ、前回の再生位置(`positionSec`)からの再開に必要な`seek`(実時刻)を返す。
   * それ以外(別の局・別の番組を選んだ場合)は進捗を0にリセットし、先頭から再生する。
   */
  #resolveResume(station: string, query: TimefreeQuery): { seek?: string; positionSec: number } {
    const progress = this.timefreeProgress;
    if (
      progress !== null &&
      progress.station === station &&
      progress.ft === query.ft &&
      progress.to === query.to &&
      progress.positionSec > 0
    ) {
      const seek = addSecondsToTimeString(revCnvRadioTime(query.ft), progress.positionSec);
      return { seek, positionSec: progress.positionSec };
    }
    this.timefreeProgress = { station, ft: query.ft, to: query.to, positionSec: 0 };
    return { seek: undefined, positionSec: 0 };
  }

  /**
   * タイムフリー再生開始直後に1回だけ、番組の長さと再生位置(途中再開時のみ0以外)をVolumioへ反映する。
   * ライブと異なり、以降は自然に増えていくmpd側の再生位置をそのまま使うため、継続的な上書きは行わない。
   */
  #pushTimefreeState(query: TimefreeQuery, resumePositionSec: number): void {
    const state = this.commandRouter.stateMachine.getState();
    const t0 = formatTimeString(query.ft);
    const t1 = formatTimeString(query.to);
    state.duration = getTimeSpan(t0, t1);
    state.seek = resumePositionSec * 1000;

    const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
    queueItem.duration = state.duration;

    this.commandRouter.stateMachine.currentSeek = state.seek;
    this.commandRouter.stateMachine.currentSongDuration = state.duration;
    this.commandRouter.servicePushState(state, 'mpd');
  }

  /**
   * タイムフリー再生中、`this.timefreeProgress.positionSec`を定期的に更新する。
   * ストリームが停止した後も最後の値が残るため、次に同じ番組を選んだ時の途中再開に使える。
   */
  #startTimefreeProgressTracking(): void {
    this.#stopTimefreeProgressTracking();
    this.timefreeProgressTimer = setInterval(() => {
      if (this.timefreeProgress === null) {
        return;
      }
      const state = this.commandRouter.stateMachine.getState();
      if (typeof state.seek === 'number') {
        this.timefreeProgress.positionSec = Math.floor(state.seek / 1000);
      }
    }, 5000);
  }

  /**
   * タイムフリー再生の進捗更新タイマーを止める(進捗の値自体は次回の途中再開のために残す)。
   */
  #stopTimefreeProgressTracking(): void {
    if (this.timefreeProgressTimer !== null) {
      clearInterval(this.timefreeProgressTimer);
      this.timefreeProgressTimer = null;
    }
  }

  /**
   * ルートメニュー(ライブ/タイムフリーの2項目)を返す。各項目は`radio-category`型で、
   * 選択すると{@link radioStations}/{@link timefreeStations}へ遷移する。
   */
  async rootMenu(): Promise<BrowseResult> {
    const items: BrowseItem[] = [
      {
        service: this.serviceName,
        type: 'radio-category',
        title: messageCatalog.get('BROWSE_LABEL_LIVE'),
        uri: 'radiko/live',
      },
      {
        service: this.serviceName,
        type: 'radio-category',
        title: messageCatalog.get('BROWSE_LABEL_TIMEFREE'),
        uri: 'radiko/timefree',
      },
    ];

    return {
      navigation: {
        lists: [{
          title: messageCatalog.get('APP_TITLE'),
          availableListViews: ['list'],
          items
        }]
      },
      uri: 'radiko'
    };
  }

  /**
   * 局一覧をVolumioのBrowse画面用データ(地域名ごとにグループ化したリスト)に変換して返す。
   */
  async radioStations(): Promise<BrowseResult> {
    this.logger.info('JP_Radio::JpRadio.radioStations');

    if (this.rdk?.stations === undefined) {
      return {
        navigation: {
          lists: [{
            title: messageCatalog.get('BROWSE_LABEL_LIVE'),
            availableListViews: ['grid', 'list'],
            items: []
          }]
        },
        uri: 'radiko'
      };
    }

    const entries = Array.from(this.rdk.stations.entries());
    // 地域名ごとにグループ化
    const grouped: Record<string, BrowseItem[]> = {};

    const stationPromises = entries.map(async ([stationId, stationInfo]) => {
      try {
        const meta = await this.#buildTrackMeta(stationId, stationInfo);
        const uri = `http://localhost:${this.port}/radiko/play/${stationId}`;

        const item: BrowseItem = {
          // explodeUriを呼び出す先のサービス名
          service   : this.serviceName,
          type      : 'song',
          // 番組タイトル
          title     : meta.title,
          // パーソナリティ名
          album: meta.album,
          // 地域名 / 局名 / 放送時間
          artist    : meta.artist,
          // 番組画像URL
          albumart  : meta.albumart,
          // 再生URI
          uri       : uri,
          // サンプルレート（未使用）
          samplerate: '',
          // ビット深度（未使用）
          bitdepth  : 0,
          // チャンネル数（未使用）
          channels  : 0
        };
        if (this.browseMode1 === 'type2') {
          // 直接再生ではなく番組情報モーダルを経由させる
          item.type = 'radio-category';
          item.uri = `radiko/proginfo/${stationId}`;
        }
        const region = stationInfo.regionName || 'その他';
        if (grouped[region] === undefined) {
          grouped[region] = [];
        }
        grouped[region].push(item);
      } catch (error: any) {
        this.logger.error(`[JP_Radio] Error getting program for ${stationId}: ${error}`);
      }
    });

    await Promise.all(stationPromises);

    const lists: BrowseList[] = Object.entries(grouped).map(([regionName, items]) => ({
      title: regionName,
      availableListViews: ['grid', 'list'],
      items
    }));

    return {
      navigation: {
        lists
      },
      uri: 'radiko'
    };
  }

  /**
   * タイムフリー用の局一覧をVolumioのBrowse画面用データに変換して返す。
   * 各アイテムは`radio-category`型(直接再生ではなく再度ブラウズを呼び出す)にし、
   * 選択すると{@link stationTimetable}で番組一覧に遷移する。
   */
  async timefreeStations(): Promise<BrowseResult> {
    this.logger.info('JP_Radio::JpRadio.timefreeStations');

    if (this.rdk?.stations === undefined) {
      return {
        navigation: {
          lists: [{
            title: messageCatalog.get('BROWSE_LABEL_TIMEFREE'),
            availableListViews: ['grid', 'list'],
            items: []
          }]
        },
        uri: 'radiko'
      };
    }

    const grouped: Record<string, BrowseItem[]> = {};
    for (const [stationId, stationInfo] of this.rdk.stations.entries()) {
      const areaName = stationInfo.areaKanji || stationInfo.areaName;
      const item: BrowseItem = {
        service: this.serviceName,
        type: 'radio-category',
        title: stationInfo.name,
        artist: `${areaName} / ${stationInfo.name}`,
        albumart: stationInfo.bannerUrl,
        uri: `radiko/timetable/${stationId}`,
        samplerate: '',
        bitdepth: 0,
        channels: 0
      };
      const region = stationInfo.regionName || 'その他';
      if (grouped[region] === undefined) {
        grouped[region] = [];
      }
      grouped[region].push(item);
    }

    const lists: BrowseList[] = Object.entries(grouped).map(([regionName, items]) => ({
      title: regionName,
      availableListViews: ['grid', 'list'],
      items
    }));

    return {
      navigation: {
        lists
      },
      uri: 'radiko'
    };
  }

  /**
   * 指定局のタイムフリー番組一覧(既に放送開始済みのもののみ、新しい順)をBrowse画面用データに変換して返す。
   */
  async stationTimetable(stationId: string): Promise<BrowseResult> {
    this.logger.info(`JP_Radio::JpRadio.stationTimetable: stationId=${stationId}`);

    const stationInfo = this.rdk?.stations.get(stationId);
    let stationName = stationInfo?.name;
    if (stationName === undefined) {
      stationName = stationId;
    }

    let programs = await this.prg?.getStationPrograms(stationId);
    if (programs === undefined) {
      programs = [];
    }

    const currentRadioTime = getCurrentRadioTime();
    const items: BrowseItem[] = programs
      .filter((program) => isWithinTimefreeWindow(program.ft, currentRadioTime))
      .sort((a, b) => {
        if (a.ft < b.ft) {
          return 1;
        }
        return -1;
      })
      .map((program) => {
        const t0 = formatHourMinute(program.ft);
        const t1 = formatHourMinute(program.tt);
        const playUrl = new URL(`http://localhost:${this.port}/radiko/play/${stationId}`);
        playUrl.searchParams.set('ft', program.ft);
        playUrl.searchParams.set('to', program.tt);

        let albumart: string | undefined = program.img;
        if (albumart === '' || albumart === undefined) {
          albumart = stationInfo?.bannerUrl;
          if (albumart === undefined) {
            albumart = '';
          }
        }

        const item: BrowseItem = {
          service: this.serviceName,
          type: 'song',
          title: program.title,
          album: program.pfm,
          artist: `${stationName} ${t0}-${t1}`,
          albumart,
          uri: playUrl.toString(),
          samplerate: '',
          bitdepth: 0,
          channels: 0
        };
        if (this.browseMode2 === 'type2') {
          // 直接再生ではなく番組情報モーダルを経由させる
          item.type = 'radio-category';
          item.uri = `radiko/proginfo/${stationId}?ft=${program.ft}&to=${program.tt}`;
        }
        return item;
      });

    return {
      navigation: {
        lists: [{
          title: stationName,
          availableListViews: ['grid', 'list'],
          items
        }]
      },
      uri: `radiko/timetable/${stationId}`
    };
  }

  /**
   * 指定局IDの現在のトラック情報を返す(explodeUriから呼ばれる)。
   * URIには局IDのみを載せ、タイトルやアルバムアートなどの表示用メタデータは
   * 再生選択のたびにここで最新の状態を取得し直す(長い日本語テキストをURIに含めないため)。
   * @param timefreeQuery 指定するとタイムフリー再生時の番組情報を、指定しなければ現在放送中の情報を返す。
   * @returns 局が存在しない場合はnull。
   */
  async getTrackMeta(stationId: string, timefreeQuery?: TimefreeQuery): Promise<TrackMeta | null> {
    const stationInfo = this.rdk?.stations.get(stationId);
    if (stationInfo === undefined) {
      return null;
    }
    if (timefreeQuery !== undefined) {
      return this.#buildTimefreeTrackMeta(stationId, stationInfo, timefreeQuery);
    }
    return this.#buildTrackMeta(stationId, stationInfo);
  }

  /**
   * 番組情報モーダル表示用のデータを組み立てる(`handleBrowseUri`の`radiko/proginfo/<stationId>`から呼ばれる)。
   * `explodeUri`の返却値と同じ形にして返すことで、モーダルの「再生」「キューに追加」ボタンから
   * このデータをそのままVolumioの再生キューへ渡せるようにする。
   * @returns 局が存在しない場合はnull。
   */
  async progInfo(stationId: string, timefreeQuery?: TimefreeQuery): Promise<ProgInfoData | null> {
    const meta = await this.getTrackMeta(stationId, timefreeQuery);
    if (meta === null) {
      return null;
    }
    const playUrl = new URL(`http://localhost:${this.port}/radiko/play/${stationId}`);
    if (timefreeQuery !== undefined) {
      playUrl.searchParams.set('ft', timefreeQuery.ft);
      playUrl.searchParams.set('to', timefreeQuery.to);
    }
    return {
      service: this.serviceName,
      type: 'song',
      title: meta.title,
      name: meta.title,
      album: meta.album,
      artist: meta.artist,
      albumart: meta.albumart,
      uri: playUrl.toString(),
    };
  }

  /**
   * 自身のエリアID・会員種別を`'JP13/premium'`形式で返す(`Radiko.getMyAreaId()`のパススルー)。
   * エリア選択設定画面で「自分のエリア」を示すために使う。
   */
  async getMyAreaId(): Promise<string> {
    if (this.rdk === null) {
      return '';
    }
    return this.rdk.getMyAreaId();
  }

  /**
   * 指定エリアIDに属する局のID一覧を返す(エリア選択設定画面の説明表示に使う)。
   */
  getAreaStations(areaId: string): string[] {
    const stations = this.rdk?.areaData.get(areaId)?.stations;
    if (stations === undefined) {
      return [];
    }
    return stations;
  }

  /**
   * 指定局・指定区間のタイムフリー番組情報を組み立てる。DBに該当番組が見つからない場合は
   * タイトル等を空のまま返す(URIのft/toから放送時間だけは表示できるようにする)。
   */
  async #buildTimefreeTrackMeta(stationId: string, stationInfo: StationInfo, query: TimefreeQuery): Promise<TrackMeta> {
    const program = await this.prg?.findProgram(stationId, query.ft);
    let title = '';
    let album = '';
    let img = '';
    if (program !== undefined) {
      title = program.title;
      album = program.pfm;
      img = program.img;
    }
    const areaName = stationInfo.areaKanji || stationInfo.areaName;
    const t0 = formatHourMinute(query.ft);
    const t1 = formatHourMinute(query.to);
    const albumart = img || stationInfo.bannerUrl || '';
    const artist = `${areaName} / ${stationInfo.name} ${t0}-${t1}`;
    return { title, album, artist, albumart };
  }

  /**
   * 指定局の現在のトラック情報(タイトル・パーソナリティ名・表示用アーティスト文字列・アルバムアート)を組み立てる。
   * radioStations()とgetTrackMeta()の両方から共通で使う。
   */
  async #buildTrackMeta(stationId: string, stationInfo: StationInfo): Promise<TrackMeta> {
    const progData = await this.prg?.getCurProgram(stationId);
    let title = '';
    let album = '';
    let progImg = '';
    let t0 = '';
    let t1 = '';
    if (progData !== undefined) {
      title = progData.title;
      album = progData.pfm;
      progImg = progData.img;
      t0 = formatHourMinute(progData.ft);
      t1 = formatHourMinute(progData.tt);
    }
    const areaName = stationInfo.areaKanji || stationInfo.areaName;
    const albumart = progImg || stationInfo.bannerUrl || '';
    const stationAndTime = `${stationInfo.name} ${t0}-${t1}`;
    const artist = `${areaName} / ${stationAndTime}`;
    return { title, album, artist, albumart };
  }

  /**
   * HTTPサーバを起動し、局データ・番組表の初期取得と番組表定期更新タスクを開始する。
   */
  async start(): Promise<void> {
    this.logger.info(`JP_Radio::JpRadio.start`);
    if (this.server !== null) {
      this.logger.info('JP_Radio::JpRadio.start: Already started');
      this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('ALREADY_STARTED'));
      return;
    }

    this.prg = new RdkProg(this.logger);
    this.rdk = new Radiko(this.logger, this.port);
    // ここで時間かかり過ぎて，
    //   Plugin music_service jp_radio failed to complete 'onStart' in a timely fashion
    // って怒られるので，awaitを外してみた。
    // BOOTは早くなるし問題なさそうなのでこれでいいんじゃない？
    //await this.#init();
    this.#init();

    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, () => {
          this.logger.info(`JP_Radio::Listening on port ${this.port}`);
          this.commandRouter.pushToastMessage('success', messageCatalog.get('APP_TITLE'), messageCatalog.get('BOOT_COMPLETED'));
          this.commandRouter.servicePushState({
            status: 'play',
            service: this.serviceName,
            title: 'Radiko 起動中',
            uri: ''
          });
          this.task1.start();
          resolve();
        })
        .on('error', (error: any) => {
          this.logger.error('JP_Radio::App error:', error);
          this.commandRouter.pushToastMessage(
            'error',
            messageCatalog.get('ERROR_START_FAILED_TITLE'),
            error.message || messageCatalog.get('ERROR_GENERIC'),
          );
          reject(error);
        });
    });
  }

  /**
   * 定期更新タスクとHTTPサーバを停止し、Model層(Radiko/RdkProg)の参照を破棄する。
   */
  async stop(): Promise<void> {
    if (this.server !== null) {
      this.task1.stop();
      this.task2.stop();
      this.#stopTimefreeProgressTracking();
      this.server.close();
      this.server = null;

      await this.prg?.dbClose();
      this.prg = null;
      this.rdk = null;

      this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('STOPPED'));
    }
  }

  /**
   * 起動直後にRadikoへログイン・局一覧を取得し、番組表を初回更新する。
   */
  async #init(): Promise<void> {
    this.logger.info('JP_Radio::JpRadio.#init');
    if (this.rdk !== null) {
      await this.rdk.init(this.acct);
    }
    await this.#pgupdate(true);
  }

  /**
   * 番組表を最新化する。エリアフリーでない場合も、局一覧に実際に含まれる全エリア分を対象にする
   * ことで、隣接エリア局(BAYFM78/NACK5/YFMなど)の番組情報が欠落しないようにしている。
   * @param whenBoot trueの場合は起動時呼び出しとしてトースト通知を出す。
   */
  async #pgupdate(whenBoot = false): Promise<void> {
    if (this.prg !== null) {
      this.logger.info('JP_Radio::JpRadio.#pgupdate: Updating program listings...');
      if (whenBoot === true) {
        this.commandRouter.pushToastMessage('info', messageCatalog.get('APP_TITLE'), messageCatalog.get('PROGRAM_DATA_GETTING'));
      }

      // JP**/AreaFree
      const myAreaId = await this.rdk?.getMyAreaId();
      let stationsMap = this.rdk?.stations;
      if (stationsMap === undefined) {
        stationsMap = new Map<string, StationInfo>();
      }

      // エリアフリーでない場合も、局一覧(関東圏の他エリア局など)に実際に含まれる全エリアの番組表を取得する
      // (自分のエリアだけだとBAYFM78/NACK5/YFMのような他エリアの局の番組情報が取れないため)
      const stationAreaIdArray = Array.from(new Set(Array.from(stationsMap.values()).map((s) => s.areaId)));
      const areaIdArray = resolveAreaIdArray(myAreaId, stationAreaIdArray, this.radikoAreaIdArray);
      //const areaIDs = new Array('JP13', 'JP27') // デバッグ用(東京/大阪だけ)

      const updateStartTime = new Date();
      await this.prg.updatePrograms(areaIdArray, stationsMap, whenBoot);
      //await this.prg.clearOldProgram();
      const updateEndTime = new Date();
      const processingTime = updateEndTime.getTime() - updateStartTime.getTime();

      if (whenBoot === true) {
        this.commandRouter.pushToastMessage(
          'success',
          messageCatalog.get('APP_TITLE'),
          messageCatalog.get('PROGRAM_DATA_DONE', processingTime),
        );
      }

      this.logger.info(`JP_Radio::JpRadio.#pgupdate: complete. ### ${processingTime}ms ###`);
    }
  }
}
