import express, { Application, Request, Response } from 'express';
import { parse as queryParse } from 'querystring';
import cron from 'node-cron';
import libQ from 'kew';

// Serviceのインポート
import RdkProg from '@/service/prog';
import Radiko from '@/service/radiko';

// Modelのインポート
import type { LoginAccount } from '@/models/auth.model';
import type { BrowseItem, BrowseList, BrowseResult } from '@/models/browse-result.model';
import type { StationInfo } from '@/models/station.model';
import type { RadikoProgramData } from '@/models/radiko-program.model';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { MessageHelper } from '@/utils/message-helper.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';

export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;
  private readonly logger: LoggerEx;
  private readonly acct: LoginAccount | null;
  private readonly confParam: any;
  private readonly commandRouter: any;
  private prg: RdkProg | null = null;
  private rdk: Radiko | null = null;
  private myInfo = {
    areaId: '',
    areafree: '',
    member_type: '',
    cntStations: 0
  };
  private playing = {
    stationId: '',
    timeFree: '',
    seek: ''
  };
  private readonly messageHelper: MessageHelper;

  private readonly serviceName: any;

  constructor(acct: LoginAccount | null, confParam: any, logger: LoggerEx, commandRouter: any, serviceName: any, messageHelper: MessageHelper) {
    this.app = express();
    this.acct = acct;
    this.confParam = confParam;
    this.logger = logger;
    this.commandRouter = commandRouter;
    this.serviceName = serviceName;
    this.messageHelper = messageHelper;

    // 番組表データ更新（毎日04:59）
    this.task1 = cron.schedule('59 4 * * *', this.#pgupdate.bind(this), {
      scheduled: false
    });
    // 再生画面更新（60s間隔; conf.delayに対して1sずらし）
    broadcastTimeConverter.setDelay(this.confParam.delay);
    this.task2 = cron.schedule(`${(this.confParam.delay + 1) % 60} * * * * *`, this.pushSongState.bind(this), { scheduled: false });

    this.#setupRoutes();
  }

  #setupRoutes(): void {
    this.logger.info('JRADI01SI0001');

    this.app.get('/radiko/play/:stationID', async(req: Request, res: Response):
      Promise<void> => {
        this.logger.info('JRADI01SI0002', req.url);
        // url(Live)     = /radiko/play/TBS
        // url(TimeFree) = /radiko/play/TBS?ft=##&to=##&seek=##
        const stationId: string = req.params['stationID'];
        if (!this.rdk || !this.rdk.stations?.has(stationId)) {
          const msg = !this.rdk ?
            '[JpRadio]Radiko instance not initialized' :
            `[JpRadio]${stationId} not in available stations`;
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

  private async startStream(res: Response, stationId: string, query: any):
    Promise<void> {
      this.logger.info('JRADI01SI0003');
      try {
        const ffmpeg = await this.rdk!.play(stationId, query);
        if (!ffmpeg || !ffmpeg.stdout) {
          this.logger.error('JRADI01SE0002');
          res.status(500).send('Stream start error');
          return;
        }

        let ffmpegExited = false;
        ffmpeg.on('exit', () => {
          ffmpegExited = true;
          this.logger.info('JRADI01SI0004', ffmpeg.pid);
        });
        ffmpeg.stdout.pipe(res);
        this.logger.info('JRADI01SI0005', ffmpeg.pid);

        this.playing.stationId = stationId;
        this.playing.timeFree = (query.ft && query.to) ? `${query.ft}-${query.to}` : '';
        this.playing.seek = query.seek ?? '';

        // max60sも待ちたくないのですぐ呼ぶ
        setTimeout(this.pushSongState.bind(this), 3000);
        this.task2.start();

        res.on('close', () => {
          this.task2.stop();
          this.logger.info('JRADI01SI0006');
          if (ffmpeg.pid && !ffmpegExited) {
            try {
              //process.kill(-ffmpeg.pid, 'SIGTERM');
              // seek時に'SIGTERM'ではkillされずに残るので'SIGKILL'に変えてみた
              process.kill(-ffmpeg.pid, 'SIGKILL');
              this.logger.info('JRADI01SI0007', ffmpeg.pid);
            } catch (e: any) {
              this.logger.warn('JRADI01SW0001', (e.code === 'ESRCH' ? 'Already exited' : e.message));
            }
          }
        });
        this.logger.info('JRADI01SI0008');

      } catch (error) {
        this.logger.error('JRADI01SE0003');
        res.status(500).send('Internal server error');
      }
    }

  public async pushSongState(forceUpdate: boolean = false): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();
    if (this.playing.timeFree) {
      // タイムフリー：１回のみ
      if (state.status == 'play') {
        const stationName = this.rdk?.getStationName(this.playing.stationId);
        const [ft, to] = this.playing.timeFree.split('-');
        const progData = await this.prg?.getProgramData(this.playing.stationId, ft, true);

        if (progData) {

        }

        const time = broadcastTimeConverter.formatTimeString2([ft, to], '$1:$2-$4:$5'); // HH:mm-HH:mm
        const date = broadcastTimeConverter.formatDateString(ft, this.confParam.dateFmt);
        const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
        state.title = queueItem.name + (queueItem.album ? ` - ${queueItem.album}` : '');
        state.artist = `${stationName} / ${time} @${date} (TimeFree)`;

        if (!state.duration) {
          state.duration = broadcastTimeConverter.getTimeSpan(ft, to); // sec
          this.commandRouter.stateMachine.currentSongDuration = state.duration;
        }

        if (this.playing.seek) {
          state.seek = Number(this.playing.seek) * 1000; // msec
          this.commandRouter.stateMachine.currentSeek = state.seek;
          this.playing.seek = '';
        }

        this.commandRouter.servicePushState(state, 'mpd');
        this.task2.stop();
      }
    } else {
      // ライブ：番組の切り替わりで更新
      if (state.seek >= state.duration * 1000 || forceUpdate) {
        const progData = await this.prg?.getCurProgramData(this.playing.stationId, true);
        if (progData) {
          const stationName = this.rdk?.getStationName(this.playing.stationId);
          const time = broadcastTimeConverter.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5'); // HH:mm-HH:mm
          const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
          queueItem.name = progData.title;
          queueItem.album = progData.pfm;
          queueItem.artist = `${stationName} / ${time}`;
          queueItem.albumart = this.selectAlbumart(state.albumart, state.albumart, progData.img);
          queueItem.duration = broadcastTimeConverter.getTimeSpan(progData.ft, progData.to); // sec
          state.title = progData.title + (progData.pfm ? ` - ${progData.pfm}` : '');
          state.artist = `${queueItem.artist} (Live)`;
          state.albumart = queueItem.albumart;
          state.duration = queueItem.duration
          state.seek = broadcastTimeConverter.getTimeSpan(progData.ft, broadcastTimeConverter.getCurrentRadioTime()) * 1000; // msec
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
    //const currentTime = broadcastTimeConverter.formatTimeString(broadcastTimeConverter.getCurrentRadioTime(), '$1:$2:$3');
    //this.logger.info(`JP_Radio::JpRadio.updateQueueInfo: [${currentTime}]`);
    var arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    var changeFlag = false;
    for (const i in arrayQueue) {
      const queueItem = arrayQueue[i];
      if (queueItem.uri.includes('?')) continue;
      // uri = http://localhost:9000/radiko/play/TBS
      const stationId = queueItem.uri.split('/').pop();
      const progData = await this.prg?.getCurProgramData(stationId, true);
      if (progData) {
        const stationAndTime = queueItem.artist;
        const progTime = broadcastTimeConverter.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5');
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

  public async radioStations(mode: string): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0009', mode);
    const defer = libQ.defer();
    // mode = live or timefree or timefree_today
    if (this.rdk?.stations) {
      // 地域名ごとにグループ化
      const grouped: Record<string, BrowseItem[]> = {};
      const stationEntries = Array.from(this.rdk.stations.entries());
      const stationPromises = stationEntries.map(async([stationId, stationInfo]) => {
        try {
          const region = stationInfo.RegionName || 'others';
          if (!grouped[region]) grouped[region] = [];
          grouped[region].push(
            mode.startsWith('timefree')
              ? this.makeBrowseItem_TimeFree(mode.replace('free', 'table'), stationId, stationInfo)
              : this.makeBrowseItem_Live('play', stationId, stationInfo, await this.prg?.getCurProgramData(stationId, false))
          );
        } catch (err) {
          //this.logger.error('JRADI01SE0004', stationId, err);
          this.logger.error('JRADI01SE0004', stationId);
        }
      });

      libQ.all(stationPromises)
        .then(() => {
          const lists: BrowseList[] = Object.entries(grouped).map(([regionName, items]) =>
            this.makeBrowseList(regionName, ['grid', 'list'], items));
          defer.resolve(this.makeBrowseResult(lists));
        })
        .fail((err: any) => {
          this.logger.error('JRADI01SE0005', err);
          defer.reject(err);
        });

    } else {
      defer.resolve(this.makeBrowseResult([]));
    }
    return defer.promise;
  }

  public async radioFavouriteStations(mode: string): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0010', mode);
    const defer = libQ.defer();
    const items: BrowseItem[][] = await this.commonRadioFavouriteStations(mode);
    if (mode.startsWith('live')) {
      defer.resolve(this.makeBrowseResult([
        this.makeBrowseList(this.messageHelper.get('BROWSER.FAVOURITES_LIVE'), ['grid', 'list'], items[0])
      ]));
    } else if (mode.startsWith('timefree')) {
      defer.resolve(this.makeBrowseResult([
        this.makeBrowseList(this.messageHelper.get('BROWSER.FAVOURITES_STATION'), ['grid', 'list'], items[0]),
        this.makeBrowseList(this.messageHelper.get('BROWSER.FAVOURITES_TIMEFREE'), ['list'], items[1])
      ]));
    }
    return defer.promise;
  }

  public async radioTimeTable(mode: string, stationId: string, begin: string | number, end: string | number): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0011', mode, stationId, begin, end);
    const defer = libQ.defer();
    const stationInfo = this.rdk?.getStationInfo(stationId);
    if (stationInfo && this.prg) {
      const lists: BrowseList[] = [];
      const week = broadcastTimeConverter.getRadioWeek(begin, end, 'M月d日(E)');
      if (week.length > 1)
        this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('MESSAGE.PROGRAM_DATA_GETTING2', stationInfo.Name));

      const weekPromises = week.map(async(wDate: any) => {
        // 日付毎に並列化
        var time = '0500';
        var items: BrowseItem[] = [];
        do {
          // 一日分（05:00～29:00）の番組表
          const progData = await this.prg!.getProgramData(stationId, `${wDate.date}${time}`, true);
          if (progData) {
            const item = this.makeBrowseItem_TimeTable('play', stationId, stationInfo, progData);
            if (mode.startsWith('prog')) {
              item.type = 'radio-category';
              item.uri = item.uri.replace(/\/play\//, '/proginfo/');
            }
            items.push(item);
            // 次の番組(HHmm)
            time = progData.to.slice(8, 12);
          } else {
            break;
          }
        } while (time<'2900');

        const title = (mode.startsWith('prog') ? this.messageHelper.get('BROWSER.PROG_INFO') : '') + wDate.kanji + ((wDate.index == 0) ? this.messageHelper.get('BROWSER.TODAY') : '');
        lists.push(this.makeBrowseList(title, ['list'], items, wDate.date));
      });

      libQ.all(weekPromises).then(async() => {
        // '日付'でソート
        lists.sort((a, b) => {
          return a.sortKey!.localeCompare(b.sortKey!);
        });

        // <<前へ，次へ>>
        const space = '　'.repeat(mode.startsWith('time') ? 9 : 6);
        const uri = `radiko/${mode}/${stationId}`;

        lists.unshift(this.makeBrowseList('<<', ['list'], [
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSER.PREV_WEEK'), `${uri}/${Number(begin)-7}~${Number(end  )-7}`),
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSER.PREV_DAY'), `${uri}/${Number(begin)-1}~${Number(begin)-1}`)
        ]));

        lists.push(this.makeBrowseList('>>', ['list'], [
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSER.NEXT_DAY'), `${uri}/${Number(end  )+1}~${Number(end)+1}`),
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSER.NEXT_WEEK'), `${uri}/${Number(begin)+7}~${Number(end)+7}`)
        ]));

        if (mode.startsWith('prog')) {
          // 下段にお気に入り局
          const [items]: BrowseItem[][] = await this.commonRadioFavouriteStations('timefree', true);
          items.forEach((item) =>
            item.uri = item.uri.replace('timetable', 'progtable') + `/${begin}~${end}`
          );
          lists.push(this.makeBrowseList(this.messageHelper.get('BROWSER.PROG_FAVOURITES'), ['grid', 'list'], items));
        }
        defer.resolve(this.makeBrowseResult(lists));
      });
    } else {
      defer.resolve([]);
    }
    return defer.promise;
  }

  private async commonRadioFavouriteStations(mode: string, skipPrograms = false): Promise<BrowseItem[][]> {
    this.logger.info('JRADI01SI0012', mode);
    const defer = libQ.defer();
    // mode = live or timefree
    const items: BrowseItem[][] = [[], []];
    const favouriteStations = await this.commandRouter.playListManager.getRadioFavouritesContent();
    const stationPromises = favouriteStations.map(async(data: any) => {
      // uri = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
      const [liveUri, timefree] = data.uri.split('?');
      if (liveUri.includes('/radiko/play/')) {
        const stationId = liveUri.split('/').pop();
        const stationInfo = this.rdk?.getStationInfo(stationId);
        if (mode.startsWith('live')) {
          // ライブ
          if (!timefree) { // タイムフリー番組は無視
            const progData = await this.prg?.getCurProgramData(stationId, false);
            const item = this.makeBrowseItem_Live('play', stationId, stationInfo, progData);
            item.favourite = true;
            items[0].push(item);
          }
        } else if (mode.startsWith('timefree')) {
          // タイムフリー
          if (!timefree) { // 日時指定の有無で放送局・番組に分けて表示
            // 放送局
            items[0].push(this.makeBrowseItem_TimeFree('timetable', stationId, stationInfo));
          } else if (!skipPrograms) {
            // 番組
            const query = queryParse(timefree);
            const ft = query.ft ? String(query.ft) : '';
            const to = query.to ? String(query.to) : '';
            const check1 = broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioDate() + '050000');
            const check2 = broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioTime());
            // 配信期間内だけリトライする
            const retry = (-7 * 86400 <= check1 && check2 < 0);
            const progData = await this.prg?.getProgramData(stationId, ft, retry);
            const item = this.makeBrowseItem_TimeTable('play', stationId, stationInfo,
              progData ? progData : {
                stationId, progId: '', ft, to, title: data.title, info:
                  '', pfm: '', img: data.albumart
              });
            item.favourite = true;
            items[1].push(item);
          }
        }
      }
    });

    libQ.all(stationPromises).then(() => {
      // 'エリア名/局名'でソート
      items[0].sort((a, b) => {
        return a.artist!.localeCompare(b.artist!);
      });

      // '日時'でソート
      items[1].sort((a, b) => {
        return a.time!.localeCompare(b.time!);
      });

      defer.resolve(items);
    });

    return defer.promise;
  }

  private makeBrowseItem_Live(mode: string, stationId: string, stationInfo: StationInfo | undefined, progData: RadikoProgramData | undefined): BrowseItem {
    //this.logger.info(`JP_Radio::JpRadio.makeBrowseItem_Live: stationId=${stationId}`);
    const areaName = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName = stationInfo ? stationInfo.Name : stationId;
    const areaStation = `${areaName} / ${stationName}`;
    const progTitle = progData ? progData.title : '?';
    const progPfm = progData ? progData.pfm! : '';
    const progTime = progData ? broadcastTimeConverter.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5') : ''; // HH:mm-HH:mm
    const albumart = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, progData?.img);
    return { // ブラウズ画面に表示する情報
      // explodeUriを呼び出す先のサービス名
      service: this.serviceName,
      // 再生キューに複数リストアップ
      type: 'song',
      //type    : 'webradio',       // 再生キューに１つのみ
      // 番組タイトル
      title: progTitle,
      // パーソナリティ名
      album: progPfm,
      // エリア名 / 局名 / 時間
      artist: `${areaStation} / ${progTime}`,
      albumart: this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, progData?.img),
      uri: `radiko/${mode}/${stationId}` + '?' + encodeURIComponent(progTitle) +
        '&' + encodeURIComponent(progPfm) + '&' + encodeURIComponent(
          `${stationName} / ${progTime}`) + '&' + encodeURIComponent(albumart)
    };
  }

  private makeBrowseItem_TimeFree(mode: string, stationId: string, stationInfo: StationInfo | undefined): BrowseItem {
    //this.logger.info(`JP_Radio::JpRadio.makeBrowseItem_TimeFree: stationId=${stationId}`);
    const areaName = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName = stationInfo ? stationInfo.Name : stationId;
    const albumart = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, stationInfo?.LogoURL);
    return { // ブラウズ画面に表示する情報
      // handleBrowseUriを呼び出す先のサービス名
      service: this.serviceName,
      // このタイプはhandleBrowseUriを呼び出す
      type: 'radio-category',
      title: stationName,
      artist: `${areaName} / ${stationName}`,
      albumart: albumart,
      uri: `radiko/${mode}/${stationId}`
    };
  }

  private makeBrowseItem_TimeTable(mode: string, stationId: string, stationInfo: StationInfo | undefined, progData: RadikoProgramData | undefined): BrowseItem {
    //this.logger.info(`JP_Radio::JpRadio.makeBrowseItem_TimeTable: stationId=${stationId}`);
    const item = this.makeBrowseItem_Live(mode, stationId, stationInfo, progData);
    const areaName = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName = stationInfo ? stationInfo.Name : stationId;
    const areaStation = `${areaName} / ${stationName}`;
    const progTitle = progData ? progData.title : '?';
    if (progData?.ft && progData?.to) {
      const check = broadcastTimeConverter.checkProgramTime(progData.ft,
        progData.to, broadcastTimeConverter.getCurrentRadioTime());
      if (check == 0)
        item.title = '★'; // ライブ
      else if (check> 0)
        item.title = '⬜︎'; // 配信前
      else {
        const check = broadcastTimeConverter.checkProgramTime(progData.ft,
          progData.to, broadcastTimeConverter.getCurrentRadioDate() +
          '050000');
        if (check >= -7 * 86400)
          item.title = '▷'; // タイムフリー（TODO: タイムフリー30はどうする？）
        else item.title = '×'; // 配信終了
      }
      item.uri += `&${progData.ft}&${progData.to}`;
    } else item.title = '？';
    const time = progData ? broadcastTimeConverter.formatFullString2([
      progData.ft, progData.to
    ], this.confParam.timeFmt) : '';
    const duration = progData ? broadcastTimeConverter.getTimeSpan(progData.ft, progData.to) : 0; // sec
    // 日時 / 番組タイトル
    item.title += ` ${time} / ${progTitle}`;
    item.time = progData ? progData.ft : '';
    // エリア名 / 局名
    item.artist = areaStation;
    // 番組時間
    item.duration = duration;
    return item;
  }

  private makeBrowseItem_NoMenu(title: string, uri: string): BrowseItem {
    const service = this.serviceName;
    const type = 'item-no-menu';
    return {
      service, type, title, uri
    };
  }

  private makeBrowseList(title: string, availableListViews: string[], items:
    BrowseItem[], sortKey: string = ''): BrowseList {
    return {
      title, availableListViews, items, sortKey
    };
  }

  private makeBrowseResult(lists: BrowseList[]): BrowseResult {
    return {
      navigation: {
        prev: {
          uri: 'radiko'
        },
        lists
      }
    };
  }

  public async start(): Promise<void> {
    this.logger.info('JRADI01SI0013');
    if (this.server) {
      this.logger.info('JRADI01SI0014');
      this.commandRouter.pushToastMessage('warning', 'JP Radio', this.messageHelper.get('MESSAGE.ALREADY_STARTED'));
      return;
    }
    // 起動を通知
    this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('MESSAGE.BOOT_STARTING'));

    this.prg = new RdkProg(this.logger, this.messageHelper);
    this.rdk = new Radiko(this.logger, this.messageHelper, this.confParam.areaIds);
    await this.#init();
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.confParam.port, () => {
          this.logger.info('JRADI01SI0015',this.confParam.port);
          /*this.commandRouter.servicePushState({ // ここでPLAY再開は無理では？
              status : 'play',
            //service: this.serviceName,
              service: 'webradio',
              title  : 'Radiko starting...',
              uri    : ''
            }, this.serviceName);*/
          this.task1.start();
          const areaName = this.messageHelper.get(`RADIKO_AREA.${this.myInfo.areaId}`)
          const areaFree = this.myInfo.areafree ? ` / ${this.messageHelper.get('MESSAGE.AREA_FREE')}` : '';
          const msg1 = this.messageHelper.get('MESSAGE.BOOT_COMPLETED');
          const msg2 = this.messageHelper.get('MESSAGE.AREA_INFO', areaName + areaFree, this.myInfo.cntStations);
          this.commandRouter.pushToastMessage('success', 'JP Radio', msg1 + msg2);
          resolve();
        })
        .on('error', (err: any) => {
          this.logger.error('JRADI01SE0006', err);
          this.commandRouter.pushToastMessage('error', this.messageHelper
            .get('MESSAGE.ERR_BOOT_FAIL'), err.message || this.messageHelper
            .get('MESSAGE.ERR_UNKNOWN'));
          reject(err);
        });
    });
  }

  public async stop(): Promise<void> {
    this.logger.info('JRADI01SI0016');
    if (this.server) {
      this.task1.stop();
      this.task2.stop();
      this.server.close();
      this.server = null;

      await this.prg?.dbClose();
      this.prg = null;
      this.rdk = null;
      //this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('MESSAGE.STOPED'));
    }
  }

  async #init(): Promise<void> {
    this.logger.info('JRADI01SI0017');
    if (this.rdk)[this.myInfo.areaId, this.myInfo.areafree, this.myInfo.member_type] = await this.rdk.init(this.acct);
    await this.#pgupdate(true);
    this.logger.info('JRADI01SI0018', this.myInfo);
  }

  async #pgupdate(whenBoot = false): Promise<void> {
    this.logger.info('JRADI01SI0019');
    if (this.prg) {
      const updateStartTime = Date.now();
      const areaIdArray = (this.myInfo.areafree) ? this.confParam.areaIds : [this.myInfo.areaId];
      this.myInfo.cntStations = await this.prg.updatePrograms(areaIdArray, whenBoot);
      await this.prg.clearOldProgram();
      const updateEndTime = Date.now();
      const processingTime = updateEndTime - updateStartTime;
      this.logger.info('JRADI01SI0020', processingTime);
    }
  }

  public getAreaStations(areaId: string, woZenkoku: boolean = true): string[] {
    const item = this.rdk?.areaData.get(areaId);
    //this.logger.info(`JP_Radio::JpRadio.getAreaStations: ${areaId}=${item?.areaName}/${item?.stations}`);
    if (woZenkoku) {
      var stations: string[] = [];
      item?.stations.forEach((stationId) => {
        const info = this.rdk?.stations.get(stationId);
        if (info?.RegionName != '全国') stations.push(stationId);
      });
      return stations;
    }
    return item?.stations ?? [];
  }

  public selectAlbumart(banner: string | undefined, logo: string | undefined,
    prog: string | undefined): string {
    var result;
    switch (this.confParam.aaType) {
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
    return result ? result :
      '/albumart?sourceicon=music_service/jp_radio/dist/assets/images/app_radiko.svg';
  }

  public getMyInfo(): any {
    return this.myInfo;
  }

  public getPrg(): RdkProg | null {
    return this.prg;
  }
}
