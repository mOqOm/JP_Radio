import express, { Application, Request, Response } from 'express';
import cron from 'node-cron';
import { capitalize } from 'lodash';
import RdkProg from './prog';
import Radiko from './radiko';
import libQ from 'kew';
import type { BrowseItem, BrowseList, BrowseResult } from './models/BrowseResultModel';
import type { StationInfo } from './models/StationModel';

import { DELAY_sec, getCurrentRadioTime, formatTimeString, getTimeSpan } from './radioTime';


export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;
  private readonly port: number;
  private readonly logger: Console;
  private readonly acct: any;
  private readonly commandRouter: any;
  private prg: RdkProg | null = null;
  private rdk: Radiko | null = null;
  private station: string = '';
  private task2Cnt: number = 0;

  private readonly serviceName: any;

  constructor(port = 0, logger: Console, acct: any = null, commandRouter: any, serviceName: any) {
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
    if (this.rdk) {
      try {
        //const icyMetadata = new IcyMetadata();
        const ffmpeg = await this.rdk.play(this.station);

        if (!ffmpeg || !ffmpeg.stdout) {
          this.logger.error('JP_Radio::JpRadio.#startStream: ffmpeg start failed or stdout is null');
          res.status(500).send('Stream start error');
          return;
        }

        let ffmpegExited = false;
        ffmpeg.on('exit', () => {
          ffmpegExited = true;
          this.logger.debug(`JP_Radio::JpRadio.#startStream: ffmpeg process ${ffmpeg.pid} exited.`);
        });
        ffmpeg.stdout.pipe(res);
        this.logger.info(`JP_Radio::JpRadio.#startStream: ffmpeg=${ffmpeg.pid}`);
        // max60sも待ちたくないのですぐ呼ぶ
        setTimeout(this.#pushSongState.bind(this), 3000);
        this.task2.start();

        res.on('close', () => {
          this.task2.stop();
          this.logger.info('JP_Radio::JpRadio.#startStream: res.on(close)');
          if (ffmpeg.pid && !ffmpegExited) {
            try {
              process.kill(-ffmpeg.pid, 'SIGTERM');
              this.logger.info(`JP_Radio::JpRadio.#startStream: SIGTERM sent to ffmpeg group ${ffmpeg.pid}`);
            } catch (e: any) {
              this.logger.warn(`JP_Radio::JpRadio.#startStream: Kill ffmpeg failed: ${e.code === 'ESRCH' ? 'Already exited' : e.message}`);
            }
          }
        });
        this.logger.info('JP_Radio::JpRadio.#startStream: Streaming started');

      } catch (err) {
        this.logger.error('JP_Radio::JpRadio.#startStream: Stream error', err);
        res.status(500).send('Internal server error');
      }
    }
  }


  async #pushSongState(): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();
    // 番組の切り替わりで更新
    if (state.seek >= state.duration * 1000 || --this.task2Cnt <= 0) {
      this.task2Cnt = 10;  // 念のため10分間隔で強制更新
      const progData = await this.prg?.getCurProgram(this.station);
      if (progData) {
        const stationName = await this.rdk?.getStationName(this.station);
        const performer = progData.pfm ? ` - ${progData.pfm}` : '';
        const t0 = formatTimeString(progData.ft);
        const t1 = formatTimeString(progData.tt);
        const now = formatTimeString(getCurrentRadioTime());
        const stationAndTime = `${stationName} ${t0.substring(0, 5)}-${t1.substring(0, 5)}`;

        this.logger.info(`JP_Radio::JpRadio.#pushSongState: ${state.position}:"${stationAndTime}", now=${now}`);

        state.title = progData.title + performer;
        state.artist = stationAndTime;
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
      }
    }
    this.#updateQueuInfo();
  }

  async #updateQueuInfo(): Promise<void> {
    var arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    var changeFlag = false;
    for(var i in arrayQueue) {
      const queueItem = arrayQueue[i];
      const uris = queueItem.uri.split('/');
      const progData = await this.prg?.getCurProgram(uris[5]);
      if (progData) {
        const stationAndTime = queueItem.artist;
        const t0 = formatTimeString(progData.ft);
        const t1 = formatTimeString(progData.tt);
        const progTime = `${t0.substring(0, 5)}-${t1.substring(0, 5)}`;
        if(!stationAndTime.endsWith(progTime)) {
          changeFlag = true;
          const performer = progData.pfm ? ` - ${progData.pfm}` : '';
          queueItem.name = progData.title + performer;
          queueItem.artist = stationAndTime.replace(/(\d+):(\d+)-(\d+):(\d+)/, progTime);
          queueItem.albumart = progData.img || queueItem.albumart
          this.logger.info(`JP_Radio::JpRadio.#updateQueuInfo: arrayQueue[${i}]=${Object.values(queueItem)}`);
        }
      }
    }
    if(changeFlag) {
      this.commandRouter.stateMachine.playQueue.saveQueue();
      this.commandRouter.volumioPushQueue(arrayQueue);
    }
  }

  async radioStations(): Promise<BrowseResult> {
    this.logger.info('JP_Radio::JpRadio.radioStations');
    const defer = libQ.defer();

    if (!this.rdk?.stations) {
      defer.resolve({
        navigation: {
          lists: [{
            title: 'LIVE',
            availableListViews: ['grid', 'list'],
            items: []
          }]
        },
        uri: 'radiko'
      });
      return defer.promise;
    }

    const entries = Array.from(this.rdk.stations.entries());
    // 地域名ごとにグループ化
    const grouped: Record<string, BrowseItem[]> = {};

    const stationPromises = entries.map(async ([stationId, stationInfo]) => {
      try {
        const progData = await this.prg?.getCurProgram(stationId);
        const progTitle = progData ? progData.title : '';
        const progPfm   = progData ? progData.pfm : '';
      //  const title     = progTitle + (progPfm ? ` - ${progPfm}` : '');
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
/*
        const item: BrowseItem = {
          // explodeUriを呼び出す先のサービス名
          service: this.serviceName,
          type: 'song',
          // 番組タイトル
          title: progData ? `${progData.title || ''}` : '',
          // 地域名 / 局名
          album: `${capitalize(stationInfo.AreaName)} / ${stationInfo.Name}`,
          // パーソナリティ名
          artist: progData?.pfm || ' ',
          // 番組画像URL
          albumart: progData?.img || '',
          // 再生URI
          uri: `http://localhost:${this.port}/radiko/play/${stationId}`,
          // サンプルレート（未使用）
          samplerate: '',
          // ビット深度（未使用）
          bitdepth: 0,
          // チャンネル数（未使用）
          channels: 0
        };
*/
        const region = stationInfo.RegionName || 'その他';
        if (!grouped[region]) {
          grouped[region] = [];
        }
        grouped[region].push(item);
      } catch (err) {
        this.logger.error(`[JP_Radio] Error getting program for ${stationId}: ${err}`);
      }
    });

    libQ.all(stationPromises)
      .then(() => {
        const lists: BrowseList[] = Object.entries(grouped).map(([regionName, items]) => ({
          title: regionName,
          availableListViews: ['grid', 'list'],
          items
        }));

        defer.resolve({
          navigation: {
            lists
          },
          uri: 'radiko'
        });
      })
      .fail((err: any) => {
        this.logger.error('[JP_Radio] radioStations error: ' + err);
        defer.reject(err);
      });

    return defer.promise;
  }

  async start(): Promise<void> {
    this.logger.info(`JP_Radio::JpRadio.start`);
    if (this.server) {
      this.logger.info('JP_Radio::JpRadio.start: Already started');
      this.commandRouter.pushToastMessage('info', 'JP Radio', 'すでに起動しています');
      return;
    }

    this.prg = new RdkProg(this.logger);
    this.rdk = new Radiko(this.port, this.logger, this.acct);
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
        this.commandRouter.pushToastMessage('info', 'JP Radio', '番組表：取得中...');
      }

      // TODO: 設定画面で取得エリアを絞り込めるようにしたい
      const myAreaId = await this.rdk?.getMyAreaId();  // JP**/AreaFree
      const ids = myAreaId ? myAreaId.split('/') : [];
      const areaIdArray = (ids[1] == 'AreaFree')
                        ? Array.from({ length: 47 }, (_, i) => `JP${i + 1}`)
                        : (ids[0] != 'JP13') ? [ ids[0], 'JP13' ] :  [ ids[0] ];
//      const　areaIdArray = new Array('JP13', 'JP27') // デバッグ用(東京/大阪)
//      const　areaIdArray = new Array('JP13', 'JP40') // デバッグ用(東京/福岡)

      const stationsMap = this.rdk?.stations ?? new Map<string, StationInfo>();

      const updateStartTime = Date.now();
      const [cntStation, cntProgram] = await this.prg.updatePrograms(areaIdArray, stationsMap, whenBoot);
      //await this.prg.clearOldProgram();
      const updateEndTime = Date.now();
      const processingTime = updateEndTime - updateStartTime;

      if (whenBoot) {
        this.commandRouter.pushToastMessage('success', 'JP Radio',
            `番組表：完了！ ${cntStation}局 ${cntProgram}番組 ${Math.round(processingTime/1000)}秒`);
      }

      this.logger.info(`JP_Radio::JpRadio.#pgupdate: complete. ### ${cntStation}局 ${cntProgram}番組 ${processingTime}ms ###`);
    }
  }
}