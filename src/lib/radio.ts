"use strict";
import express, { Application, Request, Response } from 'express';
//import { parse as queryParse } from 'querystring';
import cron from 'node-cron';
import RdkProg from './prog';
import Radiko from './radiko';
import libQ from 'kew';
import type { LoginAccount } from './models/AuthModel';
import type { BrowseItem, BrowseList, BrowseResult } from './models/BrowseResultModel';
import type { StationInfo } from './models/StationModel';
import type { RadikoProgramData } from './models/RadikoProgramModel';

import { getI18nString, getI18nStringFormat } from './i18nStrings';
import { RadioTime } from './radioTime';
//import { time } from 'console';

export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;
  private readonly logger: Console;
  private readonly acct: LoginAccount | null;
  private readonly confParam: any;
  private readonly commandRouter: any;
  private prg: RdkProg | null = null;
  private rdk: Radiko | null = null;
  private myInfo = { areaId: '', areafree: '', member_type: '', cntStations: 0 };
  private playing = { stationId: '', timeFree: '', seek: '' };
  
  private readonly serviceName: any;

  constructor(acct: LoginAccount | null, confParam: any, logger: Console, commandRouter: any, serviceName: any) {
    this.app = express();
    this.acct = acct;
    this.confParam = confParam;
    this.logger = logger;
    this.commandRouter = commandRouter;
    this.serviceName = serviceName;

    // 番組表データ更新（毎日04:59）
    this.task1 = cron.schedule('59 4 * * *', this.#pgupdate.bind(this), {
      scheduled: false
    });
    // 再生画面更新（60s間隔; conf.delayに対して1sずらし）
    RadioTime.setDelay(this.confParam.delay);
    this.task2 = cron.schedule(`${(this.confParam.delay + 1) % 60} * * * * *`, this.pushSongState.bind(this), {
      scheduled: false
    });

    this.#setupRoutes();
  }

  #setupRoutes(): void {
    this.logger.info('JP_Radio::JpRadio.#setupRoutes');

    this.app.get('/radiko/play/:stationID', async (req: Request, res: Response): Promise<void> => {
      this.logger.info(`JP_Radio::JpRadio.#setupRoutes.get=> req.url=${req.url}`);
      // url(Live)     = /radiko/play/TBS
      // url(TimeFree) = /radiko/play/TBS?ft=##&to=##&seek=##
      const stationId: string = req.params['stationID'];
      if (!this.rdk || !this.rdk.stations?.has(stationId)) {
        const msg = !this.rdk
                  ? 'JP_Radio::Radiko instance not initialized'
                  : `JP_Radio::${stationId} not in available stations`;
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }
      this.startStream(res, stationId, req.query);
    });

    this.app.get('/radiko/', (_req: Request, res: Response) => {
      res.send("Hello, world. You're at the radiko_app index.");
    });
  }

  private async startStream(res: Response, stationId: string, query: any): Promise<void> {
    this.logger.info(`JP_Radio::JpRadio.startStream: stationId=${stationId}, query=[${Object.entries(query)}]`);
    try {
      const ffmpeg = await this.rdk!.play(stationId, query);
      if (!ffmpeg || !ffmpeg.stdout) {
        this.logger.error('JP_Radio::JpRadio.startStream: ffmpeg start failed or stdout is null');
        res.status(500).send('Stream start error');
        return;
      }

      let ffmpegExited = false;
      ffmpeg.on('exit', () => {
        ffmpegExited = true;
        this.logger.debug(`JP_Radio::JpRadio.startStream: ffmpeg process ${ffmpeg.pid} exited.`);
      });
      ffmpeg.stdout.pipe(res);
      this.logger.info(`JP_Radio::JpRadio.startStream: ffmpeg.pid=${ffmpeg.pid}`);

      this.playing.stationId = stationId;
      this.playing.timeFree = (query.ft && query.to) ? `${query.ft}-${query.to}` : '';
      this.playing.seek = query.seek ?? '';

      // max60sも待ちたくないのですぐ呼ぶ
      setTimeout(this.pushSongState.bind(this), 3000);
      this.task2.start();

      res.on('close', () => {
        this.task2.stop();
        this.logger.info('JP_Radio::JpRadio.startStream: res.on(close)');
        if (ffmpeg.pid && !ffmpegExited) {
          try {
            //process.kill(-ffmpeg.pid, 'SIGTERM');
            process.kill(-ffmpeg.pid, 'SIGKILL'); // seek時に'SIGTERM'ではkillされずに残るので'SIGKILL'に変えてみた
            this.logger.info(`JP_Radio::JpRadio.startStream: SIGTERM sent to ffmpeg group ${ffmpeg.pid}`);
          } catch (e: any) {
            this.logger.warn(`JP_Radio::JpRadio.startStream: Kill ffmpeg failed: ${e.code === 'ESRCH' ? 'Already exited' : e.message}`);
          }
        }
      });
      this.logger.info('JP_Radio::JpRadio.startStream: Streaming started');

    } catch (err) {
      this.logger.error('JP_Radio::JpRadio.startStream: Stream error', err);
      res.status(500).send('Internal server error');
    }
  }

  //-----------------------------------------------------------------------

  public async pushSongState(forceUpdate: boolean = false): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();
    //this.logger.info(`JP_Radio::JpRadio.pushSongState: [${state.status}:${Math.round(state.seek/1000)}/${state.duration}] ${state.title}`);
    if (this.playing.timeFree) {
      // タイムフリー：１回のみ
      if (state.status == 'play') {
        const stationName = this.rdk?.getStationName(this.playing.stationId);
        const [ft, to] = this.playing.timeFree.split('-');
        const time = RadioTime.formatTimeString2([ft, to], '$1:$2-$4:$5');  // HH:mm-HH:mm
        const date = RadioTime.formatDateString(ft, this.confParam.dateFmt);
        const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
        state.title = queueItem.name + (queueItem.album ? ` - ${queueItem.album}` : '');
        state.artist = `${stationName} / ${time} @${date} (TimeFree)`;
        if (!state.duration) {
          state.duration = RadioTime.getTimeSpan(ft, to);  // sec
          this.commandRouter.stateMachine.currentSongDuration = state.duration;
        }
        if (this.playing.seek) {
          state.seek = Number(this.playing.seek) * 1000;  // msec
          this.commandRouter.stateMachine.currentSeek = state.seek;
          this.playing.seek = '';
        }
        this.commandRouter.servicePushState(state, 'mpd');
        this.task2.stop();
      }
    } else {
      // ライブ：番組の切り替わりで更新
      if (state.seek >= state.duration * 1000 || forceUpdate) {
        const progData = await this.prg?.getCurProgram(this.playing.stationId);
        if (progData) {
          const stationName = this.rdk?.getStationName(this.playing.stationId);
          const time = RadioTime.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5'); // HH:mm-HH:mm
          const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
          queueItem.name = progData.title;
          queueItem.album = progData.pfm;
          queueItem.artist = `${stationName} / ${time}`;
          queueItem.albumart = this.selectAlbumart(state.albumart, state.albumart, progData.img);
          queueItem.duration = RadioTime.getTimeSpan(progData.ft, progData.to);  // sec
          state.title = progData.title + (progData.pfm ? ` - ${progData.pfm}` : '');
          state.artist = `${queueItem.artist} (Live)`;
          state.albumart = queueItem.albumart;
          state.duration = queueItem.duration
          state.seek = RadioTime.getTimeSpan(progData.ft, RadioTime.getCurrentRadioTime()) * 1000;  // msec
          this.commandRouter.stateMachine.currentSeek = state.seek;
          this.commandRouter.stateMachine.currentSongDuration = state.duration;
          this.commandRouter.servicePushState(state, 'mpd');
        }
        await this.prg?.clearOldProgram();
      }
      this.updateQueueInfo();
    }
  }

  private async updateQueueInfo(): Promise<void> {
    //const currentTime = RadioTime.formatTimeString(RadioTime.getCurrentRadioTime(), '$1:$2:$3');
    //this.logger.info(`JP_Radio::JpRadio.updateQueueInfo: [${currentTime}]`);
    var arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    var changeFlag = false;
    for (const i in arrayQueue) {
      const queueItem = arrayQueue[i];
      if (queueItem.uri.includes('?'))  continue;
      // uri = http://localhost:9000/radiko/play/TBS
      const stationId = queueItem.uri.split('/').pop();
      const progData = await this.prg?.getCurProgram(stationId);
      if (progData) {
        const stationAndTime = queueItem.artist;
        const progTime = RadioTime.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5');
        if (!stationAndTime.endsWith(progTime)) {
          queueItem.name = progData.title;
          queueItem.album = progData.pfm;
          queueItem.artist = stationAndTime.replace(/\d+:\d+-\d+:\d+\s?/, progTime);
          queueItem.albumart = this.selectAlbumart(queueItem.albumart, queueItem.albumart, progData.img);
          //this.logger.info(`JP_Radio::JpRadio.updateQueueInfo: [${currentTime}] Queue[${i}]=${Object.values(queueItem)}`);
          changeFlag = true;
        }
      }
    }
    if (changeFlag) {
      this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
      //this.commandRouter.stateMachine.playQueue.saveQueue();
      this.commandRouter.volumioPushQueue(arrayQueue);
    }
  }

//-----------------------------------------------------------------------

  private makeBrowseItem(mode: string, stationId: string, stationInfo: StationInfo | undefined, progData: RadikoProgramData | undefined): BrowseItem {
    //this.logger.info(`JP_Radio::JpRadio.makeBrowseItem: mode=${mode}, stationId=${stationId}`);
    const areaName = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName = stationInfo ? stationInfo.Name : stationId;
    const areaStation = `${areaName} / ${stationName}`;
    if (mode.startsWith('timefree')) {
      // mode = timefree or timefree_today
      const albumart = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, stationInfo?.LogoURL);
      const item: BrowseItem = {  // ブラウズ画面に表示する情報
        service : this.serviceName,   // handleBrowseUriを呼び出す先のサービス名
        type    : 'radio-category',   // このタイプはhandleBrowseUriを呼び出す
        title   : stationName,        // 局名
        artist  : areaStation,        // エリア名 / 局名
        albumart: albumart,           // ロゴURL
        uri     : `radiko/${mode.replace('free', 'table')}/${stationId}`
      };
      return item;

    } else {
      // mode = live or timetable or timetable_today
      const progTitle = progData ? progData.title : '?';
      const progPfm   = progData ? progData.pfm! : '';
      const progTime  = progData ? RadioTime.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5') : '';  // HH:mm-HH:mm
      const albumart = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, progData?.img);
      const uri = `radiko/play/${stationId}`
                + '?' + encodeURIComponent(progTitle)
                + '&' + encodeURIComponent(progPfm)
                + '&' + encodeURIComponent(`${stationName} / ${progTime}`)
                + '&' + encodeURIComponent(albumart);
      const item: BrowseItem = {  // ブラウズ画面に表示する情報
        service : this.serviceName,               // explodeUriを呼び出す先のサービス名
        type    : 'song',                         // 再生キューに複数リストアップ
      //type    : 'webradio',                     // 再生キューに１つのみ
        title   : progTitle,                      // 番組タイトル
        album   : progPfm,                        // パーソナリティ名
        artist  : `${areaStation} / ${progTime}`, // エリア名 / 局名 / 時間
        albumart: albumart,                       // 番組画像URL
        uri     : uri                             // 再生URI
      };

      if (mode.includes('table')) {
        // タイムテーブル
        if (!progData || !progData.ft || !progData.to || !stationInfo)
          item.title = '？';
        else {
          const check = RadioTime.checkProgramTime(progData.ft, progData.to, RadioTime.getCurrentRadioTime());
          if (check == 0)     item.title = '★';  // ライブ
          else if (check > 0) item.title = '⬜︎';  // 配信前
          else {
            const check = RadioTime.checkProgramTime(progData.ft, progData.to, RadioTime.getCurrentRadioDate() + '050000') / 86400;
            if (check >= -7)  item.title = '▷';   // タイムフリー（TODO: タイムフリー30はどうする？）
            else              item.title = '×';   // 配信終了
          }
        }
        const time = progData ? RadioTime.formatFullString2([progData.ft, progData.to], this.confParam.timeFmt) : '';
        const duration = progData ? RadioTime.getTimeSpan(progData.ft, progData.to) : 0;  // sec
        item.title += ` ${time} / ${progTitle}`;  // 日時 / 番組タイトル
        item.artist = areaStation;                // エリア名 / 局名
        item.duration = duration;                 // 番組時間
        item.uri += (progData && progData.ft && progData.to) ? `&${progData.ft}&${progData.to}` : '';
      }
      return item;
    }
  }

  public async radioStations(mode: string): Promise<BrowseResult> {
    this.logger.info('JP_Radio::JpRadio.radioStations');
    const defer = libQ.defer();
    if (!this.rdk?.stations) {
      defer.resolve({
        navigation: {
          prev: {
            uri: 'radiko'
          },
          lists: [{
            title: mode, // 'live' or 'timefree'
            availableListViews: ['grid', 'list'],
            items: []
          }]
        }
      });
      return defer.promise;
    }

    const entries = Array.from(this.rdk.stations.entries());
    // 地域名ごとにグループ化
    const grouped: Record<string, BrowseItem[]> = {};
    const stationPromises = entries.map(async ([stationId, stationInfo]) => {
      try {
        const region = stationInfo.RegionName || 'others';
        if (!grouped[region]) {
          grouped[region] = [];
        }
        const progData = await this.prg?.getCurProgram(stationId);
        const item = this.makeBrowseItem(mode, stationId, stationInfo, progData);
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
            prev: {
              uri: 'radiko'
            },
            lists
          }
        });
      })
      .fail((err: any) => {
        this.logger.error('[JP_Radio] radioStations error: ' + err);
        defer.reject(err);
      });

    return defer.promise;
  }

  public async radioFavouriteStations(mode: string): Promise<BrowseResult> {
    this.logger.info(`JP_Radio::JpRadio.radioFavouriteStations: ${mode}`);
    const defer = libQ.defer();
    // TODO: お気に入り
    return defer.promise;
  }

  public async radioTimeTable(mode: string): Promise<BrowseResult> {
    this.logger.info(`JP_Radio::JpRadio.radioTimeTable: mode=${mode}`);
    const defer = libQ.defer();
    // mode = timetabel/-7~0/TBS
    const [baseMode, begin, end, stationId] = mode.split(/[/~]/);
    const stationInfo = this.rdk?.getStationInfo(stationId);
    if (stationInfo && this.prg) {
      var lists = [];
      const PROGRAM_COUNT_MAX = 100;
      const week = RadioTime.getRadioWeek(begin, end);
      var flagToastMsg = (week.length <= 1);
      for (var i=0; i<week.length; i++) {
        const wDate = week[i];
        var time = '0500';
        var items = [];
        do {  // 一日分（05:00～29:00）の番組表
          const progData = await this.prg.findProgram(stationId, `${wDate.date}${time}`);
          if (progData) {
            const item = this.makeBrowseItem(baseMode, stationId, stationInfo, progData);
            items.push(item);
            time = progData.to.slice(8, 12);  // HHmm
          } else {
            if (time == '0500') {
              // 過去の番組データ取得
              if (!flagToastMsg) {
                this.commandRouter.pushToastMessage('info', 'JP Radio',
                  getI18nStringFormat('MESSAGE.PROGRAM_DATA_GETTING2', stationInfo.Name));
                flagToastMsg = true;
              }
            //const result = await this.prg.getDailyStationPrograms(stationId, wDate.date);
            const result = (wDate.index == -7)
                ? await this.prg.getWeeklyStationPrograms(stationId)
                : await this.prg.getDailyStationPrograms(stationId, wDate.date);
              if (!result.has(stationId)) break;
            } else {
              // 番組表が途切れている場合 ⇒１分ずつ進めてみる
              // ダミーで埋めたのでないはず
              time = RadioTime.convertRadioTime(
                RadioTime.addTime(RadioTime.revConvertRadioTime(`${wDate.date}${time}00`), 60)
              ).slice(8, 12); // HHmm
            }
          }
        } while(time < '2900' && items.length < PROGRAM_COUNT_MAX);

        const title = wDate.kanji.slice(5) + ((wDate.index == 0) ? getI18nString('BROWSER.TODAY') : '');
        lists.push({ title, availableListViews: ['list'], items });
      } // for

      const response = {
        navigation: {
          prev: {
            uri: 'radiko'
          },
          lists
        }
      };
      defer.resolve(response);

    } else { // if (stationInfo && this.prg)
      defer.reject();
    }
    return defer.promise;
  }

//-----------------------------------------------------------------------

public async start(): Promise<void> {
    this.logger.info(`JP_Radio::JpRadio.start`);
    if (this.server) {
      this.logger.info('JP_Radio::JpRadio.start: Already started');
      this.commandRouter.pushToastMessage('warning', 'JP Radio', getI18nString('MESSAGE.ALREADY_STARTED'));
      return;
    }
    this.commandRouter.pushToastMessage('info', 'JP Radio', getI18nString('MESSAGE.BOOT_STARTING'));

    this.prg = new RdkProg(this.logger);
    this.rdk = new Radiko(this.logger, this.confParam.areaIds);
    await this.#init();
 
    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.confParam.port, () => {
          this.logger.info(`JP_Radio::start: Listening on port ${this.confParam.port}`);
          this.commandRouter.servicePushState({
            status: 'play',
            service: this.serviceName,
            title: 'Radiko starting...',
            uri: ''
          });
          this.task1.start();
          const areaName = getI18nString(`RADIKO_AREA.${this.myInfo.areaId}`)
          const areaFree = this.myInfo.areafree ? ` / ${getI18nString('MESSAGE.AREA_FREE')}` : '';
          const msg1 = getI18nString('MESSAGE.BOOT_COMPLETED');
          const msg2 = getI18nStringFormat('MESSAGE.AREA_INFO', areaName + areaFree, this.myInfo.cntStations);
          this.commandRouter.pushToastMessage('success', 'JP Radio', msg1 + msg2);
          resolve();
        })
        .on('error', (err: any) => {
          this.logger.error('JP_Radio::start: App error:', err);
          this.commandRouter.pushToastMessage('error', getI18nString('MESSAGE.ERR_BOOT_FAIL'), err.message || getI18nString('MESSAGE.ERR_UNKNOWN'));
          reject(err);
        });
    });
  }

  public async stop(): Promise<void> {
    this.logger.info(`JP_Radio::JpRadio.stop`);
    if (this.server) {
      this.task1.stop();
      this.task2.stop();
      this.server.close();
      this.server = null;

      await this.prg?.dbClose();
      this.prg = null;
      this.rdk = null;
    //this.commandRouter.pushToastMessage('info', 'JP Radio', getI18nString('MESSAGE.STOPED'));
    }
  }

//-----------------------------------------------------------------------

  async #init(): Promise<void> {
    this.logger.info('JP_Radio::JpRadio.#init start...');
    if (this.rdk) [this.myInfo.areaId, this.myInfo.areafree, this.myInfo.member_type] = await this.rdk.init(this.acct);
    await this.#pgupdate(true);
    this.logger.info(`JP_Radio::JpRadio.#init: ## COMPLETED myInfo=${Object.entries(this.myInfo)} ##`);
  }

  async #pgupdate(whenBoot = false): Promise<void> {
    this.logger.info('JP_Radio::JpRadio.#pgupdate: Updating program listings...');
    if (this.prg) {
      const updateStartTime = Date.now();
      const areaIdArray = (this.myInfo.areafree) ? this.confParam.areaIds : [ this.myInfo.areaId ];
      this.myInfo.cntStations = await this.prg.updatePrograms(areaIdArray, whenBoot);
      await this.prg.clearOldProgram();
      const updateEndTime = Date.now();
      const processingTime = updateEndTime - updateStartTime;
      this.logger.info(`JP_Radio::JpRadio.#pgupdate: ## COMPLETED ${processingTime}ms} ##`);
    }
  }

//-----------------------------------------------------------------------

  public getAreaStations(areaId: string, woZenkoku: boolean = true): string[] {
    const item = this.rdk?.areaData.get(areaId);
    //this.logger.info(`JP_Radio::JpRadio.getAreaStations: ${areaId}=${item?.areaName}/${item?.stations}`);
    if (woZenkoku) {
      var stations: string[] = [];
      item?.stations.forEach((stationId) => {
        const info = this.rdk?.stations.get(stationId);
        if (info?.RegionName != '全国')  stations.push(stationId) ;
      });
      return stations;
    }
    return item?.stations ?? [];
  }

  public selectAlbumart(banner: string | undefined, logo: string | undefined, prog: string | undefined): string {
    var result;
    switch(this.confParam.aaType) {
      case 'type1':
        result = banner;
        break;
      case 'type2':
        result = logo;
        break;
      case 'type3':
        result = prog ? prog : logo;
        break;
    }
    return result ? result : '/albumart?sourceicon=music_service/jp_radio/dist/assets/images/app_radiko.svg';
  }

  public getMyInfo(): any {
    return this.myInfo;
  }
}
