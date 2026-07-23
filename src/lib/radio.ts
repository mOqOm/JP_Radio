import express, { Application, Request, Response } from 'express';
import cron from 'node-cron';
import got from 'got';
import type { ChildProcess } from 'child_process';
import RdkProg from './prog';
import Radiko from './radiko';
import type { BrowseItem, BrowseList, BrowseResult } from './models/browse-result-model';
import type { StationInfo } from './models/station-model';
import type { LoginAccount } from './models/auth-model';

import { DELAY_sec, getCurrentRadioTime, formatTimeString, getTimeSpan } from './radio-time';


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
    this.task2 = cron.schedule(`${DELAY_sec + 1} * * * * *`, this.#pushSongState.bind(this), {
      scheduled: false
    });

    this.#setupRoutes();
  }

  #setupRoutes(): void {
    this.logger.info('JP_Radio::JpRadio.#setupRoutes');

    this.app.get('/radiko/all/stations', async (_req, res) => {
      try {
        const data = await this.prg?.allData();
        res.json(data); // 自動で JSON に変換
      } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve station data' });
      }
    });


    // ffmpegのHLSデマルチプレクサはプレイリストのreload時に-headersを引き継がないため、
    // プレイリスト取得はここを経由させ、毎回正しいRadikoヘッダーを付けて中継する
    this.app.get('/radiko/medialist-proxy', async (req: Request, res: Response): Promise<void> => {
      const upstreamUrl = String(req.query['url'] || '');
      const token = String(req.query['token'] || '');
      const startedAt = Date.now();
      try {
        const upstreamRes = await got(upstreamUrl, {
          headers: {
            'X-Radiko-AuthToken': token,
            'X-Radiko-App': 'pc_html5',
            'X-Radiko-App-Version': '0.0.1',
            'X-Radiko-User': 'dummy_user',
            'X-Radiko-Device': 'pc',
          },
          responseType: 'buffer',
        });
        // ローカルプロキシは応答が速すぎてffmpegのリロード間隔計算を狂わせるため、最低待機時間を設ける
        // (5sだと体感の遅延が大きいため2sに短縮)
        const minDurationMs = 2000;
        const elapsed = Date.now() - startedAt;
        if (elapsed < minDurationMs) {
          await new Promise(resolve => setTimeout(resolve, minDurationMs - elapsed));
        }
        res.set('Content-Type', String(upstreamRes.headers['content-type'] || 'application/vnd.apple.mpegurl'));
        res.send(upstreamRes.body);
      } catch (err: any) {
        this.logger.error(`JP_Radio::medialist-proxy error: ${err?.message || err}`);
        res.status(502).send('proxy error');
      }
    });

    this.app.get('/radiko/play/:stationID', async (req: Request, res: Response): Promise<void> => {
      this.station = String(req.params['stationID']);   // FM802対策
      this.logger.info(`JP_Radio::JpRadio.#setupRoutes.get=> req.originalUrl=${req.originalUrl}`);

      if (!this.rdk || !this.rdk.stations?.has(this.station)) {
        const msg = !this.rdk
          ? 'JP_Radio::Radiko instance not initialized'
          : `JP_Radio::${this.station} not in available stations`;
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }

      this.#startStream(res)
    });

    this.app.get('/radiko/', (_req, res) => {
      res.send("Hello, world. You're at the radiko_app index.");
    });
  }

  async #startStream(res: Response): Promise<void> {
    this.logger.info('JP_Radio::JpRadio.#startStream');
    if (!this.rdk) return;

    let stopped = false;
    let currentFfmpeg: ChildProcess | null = null;
    let firstAttempt = true;

    res.on('close', () => {
      stopped = true;
      this.task2.stop();
      this.logger.info('JP_Radio::JpRadio.#startStream: res.on(close)');
      if (currentFfmpeg?.pid) {
        try {
          process.kill(-currentFfmpeg.pid, 'SIGTERM');
          this.logger.info(`JP_Radio::JpRadio.#startStream: SIGTERM sent to ffmpeg group ${currentFfmpeg.pid}`);
        } catch (e: any) {
          this.logger.warn(`JP_Radio::JpRadio.#startStream: Kill ffmpeg failed: ${e.code === 'ESRCH' ? 'Already exited' : e.message}`);
        }
      }
    });
    res.on('error', (err) => {
      this.logger.error(`JP_Radio::JpRadio.#startStream: res error: ${err.message}`);
    });

    // Radiko側のライブHLSプレイリスト更新の都合でffmpegが数十秒おきに正常終了(code=0)してしまうことがあるため、
    // クライアント(MPD)が接続を切っていない限り同じ局へ自動的に繋ぎ直す
    const spawnFfmpeg = async (): Promise<void> => {
      if (stopped || !this.rdk) return;

      try {
        const ffmpeg = await this.rdk.play(this.station);

        if (!ffmpeg || !ffmpeg.stdout) {
          this.logger.error('JP_Radio::JpRadio.#startStream: ffmpeg start failed or stdout is null');
          if (firstAttempt && !res.headersSent) res.status(500).send('Stream start error');
          return;
        }

        currentFfmpeg = ffmpeg;

        ffmpeg.on('exit', (code, signal) => {
          this.logger.info(`JP_Radio::JpRadio.#startStream: ffmpeg process ${ffmpeg.pid} exited. code=${code} signal=${signal}`);
          if (!stopped) {
            this.logger.info('JP_Radio::JpRadio.#startStream: stream still connected, restarting ffmpeg');
            setTimeout(spawnFfmpeg, 500);
          }
        });
        ffmpeg.stderr?.on('data', (chunk: Buffer) => {
          this.logger.error(`JP_Radio::JpRadio.#startStream: ffmpeg stderr: ${chunk.toString().trim()}`);
        });
        ffmpeg.stdout.pipe(res, { end: false });
        this.logger.info(`JP_Radio::JpRadio.#startStream: ffmpeg=${ffmpeg.pid}`);

        if (firstAttempt) {
          firstAttempt = false;
          // max60sも待ちたくないのですぐ呼ぶ
          setTimeout(this.#pushSongState.bind(this), 3000);
          this.task2.start();
          this.logger.info('JP_Radio::JpRadio.#startStream: Streaming started');
        }
      } catch (err) {
        this.logger.error('JP_Radio::JpRadio.#startStream: Stream error', err);
        if (firstAttempt && !res.headersSent) res.status(500).send('Internal server error');
      }
    };

    await spawnFfmpeg();
  }


  async #pushSongState(): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();
    // 番組の切り替わりで更新
    if (state.seek >= state.duration * 1000 || --this.task2Cnt <= 0) {
      this.task2Cnt = 10;  // 念のため10分間隔で強制更新
      const progData = await this.prg?.getCurProgram(this.station);
      if (progData) {
        const stationName = await this.rdk?.getStationName(this.station);
        const t0 = formatTimeString(progData.ft);
        const t1 = formatTimeString(progData.tt);
        const now = formatTimeString(getCurrentRadioTime());
        const artist = `${stationName} / ${t0.substring(0, 5)}-${t1.substring(0, 5)}`;
        this.logger.info(`JP_Radio::JpRadio.#pushSongState: ${t0}-${t1}`);
        this.logger.info(`JP_Radio::JpRadio.#pushSongState: "${artist}", now=${now}`);

        state.title = progData.title;
        state.artist = artist;
        state.albumart = progData.img || state.albumart;
        state.duration = getTimeSpan(t0, t1);      // sec
        state.seek = getTimeSpan(t0, now) * 1000;  // msec

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

  async radioStations(): Promise<BrowseResult> {
    this.logger.info('JP_Radio::JpRadio.radioStations');

    if (!this.rdk?.stations) {
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
        const progData = await this.prg?.getCurProgram(stationId);
        const progTitle = progData ? progData.title : '';
        const progPfm   = progData ? progData.pfm : '';
        const areaName  = stationInfo.AreaKanji || stationInfo.AreaName;
        const progImg   = progData ? progData.img : '';
        const albumart  = progImg || stationInfo.BannerURL || '';
        const t0 = progData ? formatTimeString(progData.ft).substr(0,5) : '';
        const t1 = progData ? formatTimeString(progData.tt).substr(0,5) : '';
        const stationAndTime = `${stationInfo.Name} ${t0}-${t1}`;
      
        const uri = `http://localhost:${this.port}/radiko/play/${stationId}`
                  + '/' + encodeURIComponent(progTitle)
                  + '/' + encodeURIComponent(stationAndTime)
                  + '/' + encodeURIComponent(albumart)
      
        const item: BrowseItem = {
          // explodeUriを呼び出す先のサービス名
          service   : this.serviceName,
          type      : 'song',
          // 番組タイトル
          title     : progTitle,
          // パーソナリティ名
          album: progPfm,
          // 地域名 / 局名
          artist    : `${areaName} / ${stationAndTime}`,
          // 番組画像URL
          albumart  : albumart,
          // 再生URI
          uri       : uri,
          // サンプルレート（未使用）
          samplerate: '',
          // ビット深度（未使用）
          bitdepth  : 0,
          // チャンネル数（未使用）
          channels  : 0
        };
        const region = stationInfo.RegionName || 'その他';
        if (!grouped[region]) {
          grouped[region] = [];
        }
        grouped[region].push(item);
      } catch (err) {
        this.logger.error(`[JP_Radio] Error getting program for ${stationId}: ${err}`);
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

  async start(): Promise<void> {
    this.logger.info(`JP_Radio::JpRadio.start`);
    if (this.server) {
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
        .on('error', (err: any) => {
          this.logger.error('JP_Radio::App error:', err);
          this.commandRouter.pushToastMessage('error', 'JP Radio 起動失敗', err.message || 'エラー');
          reject(err);
        });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
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

  async #init(): Promise<void> {
    this.logger.info('JP_Radio::JpRadio.#init');
    if (this.rdk) await this.rdk.init(this.acct);
    await this.#pgupdate(true);
  }

  async #pgupdate(whenBoot = false): Promise<void> {
    if (this.prg) {
      this.logger.info('JP_Radio::JpRadio.#pgupdate: Updating program listings...');
      if (whenBoot) {
        this.commandRouter.pushToastMessage('info', 'JP Radio', '番組データ：取得中...');
      }

      // TODO: 設定画面で取得エリアを絞り込めるようにしたい
      const myAreaId = await this.rdk?.getMyAreaId();  // JP**/AreaFree
      const ids = myAreaId ? myAreaId.split('/') : [];
      const stationsMap = this.rdk?.stations ?? new Map<string, StationInfo>();

      // エリアフリーでない場合も、局一覧(関東圏の他エリア局など)に実際に含まれる全エリアの番組表を取得する
      // (自分のエリアだけだとBAYFM78/NACK5/YFMのような他エリアの局の番組情報が取れないため)
      const stationAreaIds = Array.from(new Set(Array.from(stationsMap.values()).map((s) => s.AreaId)));
      const areaIdArray = (ids[1] === 'AreaFree')
                        ? Array.from({ length: 47 }, (_, i) => `JP${i + 1}`)
                        : (stationAreaIds.length > 0 ? stationAreaIds : [ids[0], 'JP13']);
      //const areaIDs = new Array('JP13', 'JP27') // デバッグ用(東京/大阪だけ)

      const updateStartTime = new Date();
      await this.prg.updatePrograms(areaIdArray, stationsMap, whenBoot);
      //await this.prg.clearOldProgram();
      const updateEndTime = new Date();
      const processingTime = updateEndTime.getTime() - updateStartTime.getTime();

      if (whenBoot) {
        this.commandRouter.pushToastMessage('success', 'JP Radio', `番組データ：取得完了！ ${processingTime}ms`);
      }

      this.logger.info(`JP_Radio::JpRadio.#pgupdate: complete. ### ${processingTime}ms ###`);
    }
  }
}
