import express, { Application, Request, Response } from 'express';
import cron from 'node-cron';
import RdkProg from '@/services/prog-service';
import Radiko from '@/services/radiko-service';
import StreamSession from '@/services/stream-session-service';
import type { BrowseItem, BrowseList, BrowseResult } from '@/models/browse-result-model';
import type { StationInfo } from '@/models/station-model';
import type { LoginAccount } from '@/models/auth-model';
import type { TrackMeta } from '@/models/track-meta-model';

import { DELAY_SEC, getCurrentRadioTime, formatTimeString, formatHourMinute, getTimeSpan } from '@/utils/radio-time';
import { resolveAreaIdArray } from '@/logic/area-resolver';


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

  constructor(port = 0, logger: Console, acct: LoginAccount | null = null, commandRouter: any, serviceName: string) {
    this.app = express();
    this.port = port;
    this.logger = logger;
    this.acct = acct;
    this.commandRouter = commandRouter;
    this.serviceName = serviceName;

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

      const session = new StreamSession(
        this.rdk,
        this.station,
        this.logger,
        () => {
          // max60sも待ちたくないのですぐ呼ぶ
          setTimeout(this.#pushSongState.bind(this), 3000);
          this.task2.start();
        },
        () => this.task2.stop(),
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
   * 局一覧をVolumioのBrowse画面用データ(地域名ごとにグループ化したリスト)に変換して返す。
   */
  async radioStations(): Promise<BrowseResult> {
    this.logger.info('JP_Radio::JpRadio.radioStations');

    if (this.rdk?.stations === undefined) {
      return {
        navigation: {
          lists: [{
            title: 'LIVE',
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
   * 指定局IDの現在のトラック情報を返す(explodeUriから呼ばれる)。
   * URIには局IDのみを載せ、タイトルやアルバムアートなどの表示用メタデータは
   * 再生選択のたびにここで最新の状態を取得し直す(長い日本語テキストをURIに含めないため)。
   * @returns 局が存在しない場合はnull。
   */
  async getTrackMeta(stationId: string): Promise<TrackMeta | null> {
    const stationInfo = this.rdk?.stations.get(stationId);
    if (stationInfo === undefined) {
      return null;
    }
    return this.#buildTrackMeta(stationId, stationInfo);
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
      this.commandRouter.pushToastMessage('info', 'JP Radio', 'すでに起動しています');
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
          this.commandRouter.pushToastMessage('success', 'JP Radio', '起動しました');
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
          this.commandRouter.pushToastMessage('error', 'JP Radio 起動失敗', error.message || 'エラー');
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
      this.server.close();
      this.server = null;

      await this.prg?.dbClose();
      this.prg = null;
      this.rdk = null;

      this.commandRouter.pushToastMessage('info', 'JP Radio', '停止しました');
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
        this.commandRouter.pushToastMessage('info', 'JP Radio', '番組データ：取得中...');
      }

      // TODO: 設定画面で取得エリアを絞り込めるようにしたい
      // JP**/AreaFree
      const myAreaId = await this.rdk?.getMyAreaId();
      let stationsMap = this.rdk?.stations;
      if (stationsMap === undefined) {
        stationsMap = new Map<string, StationInfo>();
      }

      // エリアフリーでない場合も、局一覧(関東圏の他エリア局など)に実際に含まれる全エリアの番組表を取得する
      // (自分のエリアだけだとBAYFM78/NACK5/YFMのような他エリアの局の番組情報が取れないため)
      const stationAreaIds = Array.from(new Set(Array.from(stationsMap.values()).map((s) => s.areaId)));
      const areaIdArray = resolveAreaIdArray(myAreaId, stationAreaIds);
      //const areaIDs = new Array('JP13', 'JP27') // デバッグ用(東京/大阪だけ)

      const updateStartTime = new Date();
      await this.prg.updatePrograms(areaIdArray, stationsMap, whenBoot);
      //await this.prg.clearOldProgram();
      const updateEndTime = new Date();
      const processingTime = updateEndTime.getTime() - updateStartTime.getTime();

      if (whenBoot === true) {
        this.commandRouter.pushToastMessage('success', 'JP Radio', `番組データ：取得完了！ ${processingTime}ms`);
      }

      this.logger.info(`JP_Radio::JpRadio.#pgupdate: complete. ### ${processingTime}ms ###`);
    }
  }
}
