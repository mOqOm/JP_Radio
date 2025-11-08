import express, { Application, Request, Response } from 'express';

import { parse } from 'querystring';
import type { ParsedQs } from 'qs';
import path from 'path';

import cron from 'node-cron';
import libQ from 'kew';

// Serviceのインポート
import RdkProg from '@/service/prog';
import RadikoService from '@/service/radiko';

// Modelのインポート
import type { LoginAccount } from '@/models/auth.model';
import type { BrowseItem, BrowseList, BrowseResult } from '@/models/browse-result.model';
import type { StationInfo } from '@/models/station.model';
import type { RadikoProgramData } from '@/models/radiko-program.model';
import type { RadikoMyInfo } from '@/models/radiko-myinfo.model';
import type { JpRadioConfig } from '@/models/jp-radio-config.model';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { MessageHelper } from '@/utils/message-helper.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';
import { getRegionByPref } from '@/utils/radiko-area.util';

/**
 * JpRadioクラスは、ラジオストリーミングサービスを提供するための主要な機能を実装します。
 * このクラスは、ラジオ局のストリームを開始し、再生状態を管理し、番組表データを更新します。
 *
 * @class JpRadio
 *
 * @param {LoginAccount | null} acct - ログインアカウント情報。
 * @param {any} confParam - 設定パラメータ。
 * @param {any} commandRouter - コマンドルーターインスタンス。
 * @param {MessageHelper} messageHelper - メッセージヘルパーインスタンス。
 *
 * @property {Application} app - Expressアプリケーションインスタンス。
 * @property {ReturnType<Application['listen']> | null} server - サーバーインスタンス。
 * @property {ReturnType<typeof cron.schedule>} task1 - 番組表データ更新タスク。
 * @property {ReturnType<typeof cron.schedule>} task2 - 再生画面更新タスク。
 * @property {LoggerEx} logger - グローバルロガーインスタンス。
 * @property {string} serviceName - サービス名。
 * @property {LoginAccount | null} acct - ログインアカウント。
 * @property {any} confParam - 設定パラメータ。
 * @property {any} commandRouter - コマンドルーター。
 * @property {RdkProg | null} rdkProg - RdkProgインスタンス。
 * @property {RadikoService | null} radikoService - Radikoサービスインスタンス。
 * @property {RadikoMyInfo} myInfo - ユーザー情報。
 * @property {object} playing - 現在再生中の情報。
 * @property {MessageHelper} messageHelper - メッセージヘルパーインスタンス。
 *
 * @method #setupRoutes - ルートを設定します。
 * @method startStream - 指定されたラジオ局の音声ストリームを開始します。
 * @method pushSongState - 現在の曲の状態を更新します。
 * @method radioStations - ラジオ局の情報を取得します。
 * @method radioFavouriteStations - お気に入りのラジオ局を取得します。
 * @method radioTimeTable - 指定されたラジオ局の番組表を取得します。
 */
export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;

  // LoggerEx はプロジェクト全体のグローバルから取得
  private readonly logger: LoggerEx = (globalThis as any).JP_RADIO_LOGGER;
  // サービス名はプロジェクト全体のグローバルから取得
  private readonly serviceName: string = (globalThis as any).JP_RADIO_SERVICE_NAME;

  private readonly acct: LoginAccount | null;
  private readonly jpRadioConfig: any;
  private readonly commandRouter: any;
  private rdkProg: RdkProg | null = null;
  private radikoService: RadikoService | null = null;
  private myInfo: RadikoMyInfo = {
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

  constructor(acct: LoginAccount | null, jpRadioConfig: JpRadioConfig, commandRouter: any, messageHelper: MessageHelper) {
    this.app = express();
    this.acct = acct;
    this.jpRadioConfig = jpRadioConfig;
    this.commandRouter = commandRouter;
    this.messageHelper = messageHelper;

    // テンプレートエンジン設定 (EJS)
    this.app.set('views', path.join(process.cwd(), 'assets', 'templates'));
    this.app.set('view engine', 'ejs');

    // 番組表データ更新（毎日04:59）
    this.task1 = cron.schedule('59 4 * * *', this.#pgupdate.bind(this), {
      scheduled: false
    });

    // 再生画面更新（60s間隔; conf.delayに対して1sずらし）
    broadcastTimeConverter.setDelay(this.jpRadioConfig.delay);
    this.task2 = cron.schedule(`${(this.jpRadioConfig.delay + 1) % 60} * * * * *`, this.pushSongState.bind(this), { scheduled: false });

    this.#setupRoutes();
  }

  #setupRoutes(): void {
    this.logger.info('JRADI01SI0001');

    // 再生時URI
    this.app.get('/radiko/play/:stationID', async (req: Request, res: Response): Promise<void> => {
      this.logger.info('JRADI01SI0002', req.url);
      // url(Live)     = /radiko/play/TBS
      // url(TimeFree) = /radiko/play/TBS?ft=##&to=##&seek=##
      const stationId: string = req.params['stationID'];
      // radikoServiceの初期化 または 指定された局が存在しない場合はエラー
      if (this.radikoService === undefined || this.radikoService === null || !this.radikoService.getStations()?.has(stationId)) {
        const msg: string = !this.radikoService ?
          '[JpRadio]Radiko instance not initialized' :
          `[JpRadio]${stationId} not in available stations`;
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }
      // ストリーム開始
      this.startStream(res, stationId, req.query);
      this.playing.stationId = stationId;
      const ft = req.query['ft'] as string | undefined;
      const to = req.query['to'] as string | undefined;
      this.playing.timeFree = (ft && to) ? `${ft}-${to}` : '';
      //this.playing.seek = req.query.seek ?? '';
      //this.playing.seek = req.query.seek ?? '';
    });

    this.app.get('/radiko/dev/', (_req: Request, res: Response) => {
      if (!this.radikoService) {
        res.status(500).send('Radiko service not initialized');
        return;
      }
      const stations: Map<string, StationInfo> = this.radikoService.getStations();
      // Map → 配列
      const rows = Array.from(stations.entries()).map(([id, info]) => ({
        stationId: id,
        name: info.Name,
        region: info.RegionName || '-',
        area: info.AreaName || '-'
      }));
      res.render('radiko-stations', { rows });
    });

    this.app.get('/radiko/', (_req: Request, res: Response) => {
      res.send(`Hello, world. You're at the radiko_app index.`);
    });
  }

  /**
   * ラジオストリーミングを開始し、レスポンスにパイプします。
   *
   * このメソッドは指定されたラジオ局のストリーミングを開始し、
   * ffmpegを使用してオーディオデータをHTTPレスポンスにパイプします。
   * ストリーム開始時のエラーハンドリング、プロセス管理、
   * およびクライアント切断時のクリーンアップ処理を行います。
   *
   * @param res - HTTPレスポンスオブジェクト。オーディオストリームが書き込まれます
   * @param stationId - 再生するラジオ局のID
   * @param query - ストリーミングのパラメータを含むクエリオブジェクト
   * @returns Promise<void> - 非同期処理の完了を示すPromise
   *
   * @throws Radikoサービスが初期化されていない場合、500エラーを返します
   * @throws ffmpegプロセスの開始に失敗した場合、500エラーを返します
   * @throws 内部サーバーエラーが発生した場合、500エラーを返します
   *
   * @remarks
   */
  private async startStream(res: Response, stationId: string, query: ParsedQs): Promise<void> {
    this.logger.info('JRADI01SI0003', stationId, query);
    // Radikoサービスが初期化されていない場合のエラーハンドリング
    if (this.radikoService === undefined || this.radikoService === null) {
      this.logger.error('JRADI01SE0002');
      res.status(500).send('Radiko service not initialized');
      return;
    }

    try {
      // ストリームを開始するためにRadikoサービスを呼び出す
      const ffmpeg = await this.radikoService.play(stationId, query);
      // ffmpegが正しく初期化されていない場合のエラーハンドリング
      if (ffmpeg === undefined || ffmpeg === null
        || ffmpeg.stdout === undefined || ffmpeg.stdout === null) {

        this.logger.error('JRADI01SE0002');
        res.status(500).send('Stream start error');
        return;
      }

      let ffmpegExited: boolean = false;

      // ffmpegプロセスが終了したときの処理
      ffmpeg.on('exit', () => {
        ffmpegExited = true;
        this.logger.info('JRADI01SI0004', ffmpeg.pid);
      });

      // ffmpegプロセスでエラーが発生したときの処理
      ffmpeg.on('error', (err: any) => {
        this.logger.error('JRADI01SE0003', err);
        if (res.writableEnded === false) {
          res.status(500).end();
        }
      });

      // レスポンスでエラーが発生したときの処理
      res.on('error', (err: any) => {
        this.logger.warn('JRADI01SW0001', err);
      });

      // ffmpegの標準出力でエラーが発生したときの処理
      ffmpeg.stdout.on('error', (err: any) => {
        this.logger.error('JRADI01SE0003', err);
        if (res.writableEnded === false) {
          res.status(500).end();
        }
      });

      // レスポンスヘッダーの設定
      res.set({
        'Cache-Control': 'no-cache, no-store',
        'Content-Type': 'audio/aac',
        Connection: 'keep-alive'
      });

      // ffmpegの標準出力をレスポンスにパイプする
      ffmpeg.stdout.pipe(res);
      this.logger.info('JRADI01SI0005', ffmpeg.pid);

      //setTimeout(this.pushSongState.bind(this), 3000);
      //this.task2.start();

      // レスポンスがクローズされたときの処理
      res.on('close', () => {
        //this.task2.stop();
        this.logger.info('JRADI01SI0006');
        if (ffmpeg.pid && ffmpegExited === false) {
          try {
            // ffmpegプロセスを終了させる
            process.kill(-ffmpeg.pid, 'SIGTERM');
            setTimeout(() => {
              try {
                // まだ生きていれば強制終了
                process.kill(-ffmpeg.pid, 0); // 存在確認
                process.kill(-ffmpeg.pid, 'SIGKILL');
              } catch { /* 既に終了 */ }
            }, 1000);
            this.logger.info('JRADI01SI0007', ffmpeg.pid);
          } catch (error: any) {
            this.logger.warn('JRADI01SW0001', (error.code === 'ESRCH' ? 'Already exited' : error.message));
          }
        }
      });
      this.logger.info('JRADI01SI0008');

    } catch (error: any) {
      // 内部サーバーエラーの処理
      this.logger.error('JRADI01SE0003', error);
      res.status(500).send('Internal server error');
    }
  }

  public async pushSongState(forceUpdate: boolean = false): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();

    if (this.playing.timeFree) {
      // タイムフリー：１回のみ
      if (state.status === 'play') {
        const stationName = this.radikoService?.getStationName(this.playing.stationId);
        const [ft, to] = this.playing.timeFree.split('-');
        const progData = await this.rdkProg?.getProgramData(this.playing.stationId, ft, true);

        if (progData) {

        }

        const time = broadcastTimeConverter.formatTimeString2([ft, to], '$1:$2-$4:$5'); // HH:mm-HH:mm
        const date = broadcastTimeConverter.formatDateString(ft, this.jpRadioConfig.dateFmt);
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
        const progData = await this.rdkProg?.getCurProgramData(this.playing.stationId, true);
        if (progData) {
          const stationName = this.radikoService?.getStationName(this.playing.stationId);
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

        await this.rdkProg?.clearOldProgram();
      }

      this.updateQueueInfo();
    }
  }

  private async updateQueueInfo(): Promise<void> {
    //const currentTime = broadcastTimeConverter.formatTimeString(broadcastTimeConverter.getCurrentRadioTime(), '$1:$2:$3');
    //this.logger.info(`JP_Radio::JpRadio.updateQueueInfo: [${currentTime}]`);
    let arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    let changeFlag: boolean = false;

    for (const i in arrayQueue) {
      const queueItem = arrayQueue[i];
      if (queueItem.uri.includes('?')) {
        continue;
      }

      // uri = http://localhost:9000/radiko/play/TBS
      const stationId = queueItem.uri.split('/').pop();
      const progData = await this.rdkProg?.getCurProgramData(stationId, true);
      if (progData) {
        const stationAndTime = queueItem.artist;
        const progTime = broadcastTimeConverter.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5');

        if (!stationAndTime.endsWith(progTime)) {
          queueItem.name = progData.title;
          queueItem.album = progData.pfm;
          queueItem.artist = stationAndTime.replace(/\d+:\d+-\d+:\d+\s?/, progTime);
          // アルバムアート
          queueItem.albumart = this.selectAlbumart(queueItem.albumart, queueItem.albumart, progData.img);
          //this.logger.info(`JP_Radio::JpRadio.updateQueueInfo: [${currentTime}] Queue[${i}]=${Object.values(queueItem)}`);

          changeFlag = true;
        }
      }
    }

    if (changeFlag === true) {
      this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
      //this.commandRouter.stateMachine.playQueue.saveQueue();
      this.commandRouter.volumioPushQueue(arrayQueue);
    }
  }

  public async radioStations(mode: string): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0009', mode);
    const defer = libQ.defer();

    // mode = live or timefree or timefree_today
    if (this.radikoService !== null) {
      // RadikoServiceから局情報を取得
      const stations: Map<string, StationInfo> = this.radikoService.getStations();

      // 地域名ごとにグループ化
      const grouped: Record<string, BrowseItem[]> = {};

      const stationEntries = Array.from(stations);

      const stationPromises = stationEntries.map(async ([stationId, stationInfo]) => {
        try {
          const region: string = stationInfo.RegionName || 'others';
          if (!grouped[region]) {
            grouped[region] = [];
          }

          grouped[region].push(
            mode.startsWith('timefree')
              ? this.makeBrowseItem_TimeFree(mode.replace('free', 'table'), stationId, stationInfo)
              : this.makeBrowseItem_Live('play', stationId, stationInfo, await this.rdkProg?.getCurProgramData(stationId, false))
          );
        } catch (error: any) {
          this.logger.error('JRADI01SE0004', stationId, error);
        }
      });

      libQ.all(stationPromises)
        .then(() => {
          const lists: BrowseList[] = Object.entries(grouped).map(([regionName, items]) =>
            this.makeBrowseList(regionName, ['grid', 'list'], items));
          defer.resolve(this.makeBrowseResult(lists));
        })
        .fail((error: any) => {
          this.logger.error('JRADI01SE0005', error);
          defer.reject(error);
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
        this.makeBrowseList(this.messageHelper.get('FAVOURITES_LIVE'), ['grid', 'list'], items[0])
      ]));
    } else if (mode.startsWith('timefree')) {
      defer.resolve(this.makeBrowseResult([
        this.makeBrowseList(this.messageHelper.get('BROWSE_TITLE_FAVOURITES_STATION'), ['grid', 'list'], items[0]),
        this.makeBrowseList(this.messageHelper.get('BROWSE_TITLE_FAVOURITES_TIMEFREE'), ['list'], items[1])
      ]));
    }

    return defer.promise;
  }

  public async radioTimeTable(mode: string, stationId: string, begin: string | number, end: string | number): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0011', mode, stationId, begin, end);

    const defer = libQ.defer();
    const stationInfo = this.radikoService?.getStationInfo(stationId);

    if (stationInfo && this.rdkProg) {
      const lists: BrowseList[] = [];
      const week = broadcastTimeConverter.getRadioWeek(begin, end, 'M月d日(E)');

      if (week.length > 1) {
        this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('PROGRAM_DATA_GETTING2', stationInfo.Name));
      }

      const weekPromises = week.map(async (wDate: any) => {
        // 日付毎に並列化
        let time = '0500';
        let items: BrowseItem[] = [];
        do {
          // 一日分（05:00～29:00）の番組表
          const progData = await this.rdkProg!.getProgramData(stationId, `${wDate.date}${time}`, true);

          if (progData) {
            const item: BrowseItem = this.makeBrowseItem_TimeTable('play', stationId, stationInfo, progData);

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
        } while (time < '2900');

        const title: string = (mode.startsWith('prog') ? this.messageHelper.get('PROGINFO_PROG_INFO') : '') + wDate.kanji + ((wDate.index == 0) ? this.messageHelper.get('BROWSE_BUTTON_TODAY') : '');
        lists.push(this.makeBrowseList(title, ['list'], items, wDate.date));
      });

      libQ.all(weekPromises).then(async () => {
        // '日付'でソート
        lists.sort((a, b) => {
          return a.sortKey!.localeCompare(b.sortKey!);
        });

        // <<前へ，次へ>>
        const space = '　'.repeat(mode.startsWith('time') ? 9 : 6);
        const uri: string = `radiko/${mode}/${stationId}`;

        lists.unshift(this.makeBrowseList('<<', ['list'], [
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSE_BUTTON_PREV_WEEK'), `${uri}/${Number(begin) - 7}~${Number(end) - 7}`),
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSE_BUTTON_PREV_DAY'), `${uri}/${Number(begin) - 1}~${Number(begin) - 1}`)
        ]));

        lists.push(this.makeBrowseList('>>', ['list'], [
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSE_BUTTON_NEXT_DAY'), `${uri}/${Number(end) + 1}~${Number(end) + 1}`),
          this.makeBrowseItem_NoMenu(space + this.messageHelper.get('BROWSE_BUTTON_NEXT_WEEK'), `${uri}/${Number(begin) + 7}~${Number(end) + 7}`)
        ]));

        if (mode.startsWith('prog')) {
          // 下段にお気に入り局
          const [items]: BrowseItem[][] = await this.commonRadioFavouriteStations('timefree', true);
          items.forEach((item) =>
            item.uri = item.uri.replace('timetable', 'progtable') + `/${begin}~${end}`
          );
          lists.push(this.makeBrowseList(this.messageHelper.get('BROWSE_PROG_FAVOURITES'), ['grid', 'list'], items));
        }
        defer.resolve(this.makeBrowseResult(lists));
      });
    } else {
      defer.resolve([]);
    }
    return defer.promise;
  }

  private async commonRadioFavouriteStations(mode: string, skipPrograms: boolean = false): Promise<BrowseItem[][]> {
    this.logger.info('JRADI01SI0012', mode);

    const defer = libQ.defer();
    // mode = live or timefree
    const items: BrowseItem[][] = [[], []];
    const favouriteStations = await this.commandRouter.playListManager.getRadioFavouritesContent();

    const stationPromises = favouriteStations.map(async (data: any) => {
      // uri = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
      const [liveUri, timefree] = data.uri.split('?');

      if (liveUri.includes('/radiko/play/')) {
        const stationId = liveUri.split('/').pop();
        const stationInfo = this.radikoService?.getStationInfo(stationId);

        if (mode.startsWith('live')) {
          // ライブ
          if (!timefree) { // タイムフリー番組は無視
            const progData = await this.rdkProg?.getCurProgramData(stationId, false);
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
            const query = parse(timefree);

            const ft: string = query.ft ? String(query.ft) : '';
            const to: string = query.to ? String(query.to) : '';

            const check1: number = broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioDate() + '050000');
            const check2: number = broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioTime());

            // 配信期間内だけリトライする
            const retry: boolean = (-7 * 86400 <= check1 && check2 < 0);
            const progData = await this.rdkProg?.getProgramData(stationId, ft, retry);
            const item: BrowseItem = this.makeBrowseItem_TimeTable('play', stationId, stationInfo,
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
    const areaName: string = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName: string = stationInfo ? stationInfo.Name : stationId;
    const areaStation: string = `${areaName} / ${stationName}`;
    const progTitle: string = progData ? progData.title : '?';
    const progPfm: string = progData ? progData.pfm! : '';
    const progTime: string = progData ? broadcastTimeConverter.formatTimeString2([progData.ft, progData.to], '$1:$2-$4:$5') : ''; // HH:mm-HH:mm
    const albumart: string = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, progData?.img);

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
    const areaName: string = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName: string = stationInfo ? stationInfo.Name : stationId;
    const albumart: string = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, stationInfo?.LogoURL);

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
    const item: BrowseItem = this.makeBrowseItem_Live(mode, stationId, stationInfo, progData);
    const areaName: string = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName: string = stationInfo ? stationInfo.Name : stationId;
    const areaStation: string = `${areaName} / ${stationName}`;
    const progTitle: string = progData ? progData.title : '?';

    if (progData?.ft && progData?.to) {
      const check = broadcastTimeConverter.checkProgramTime(progData.ft,
        progData.to, broadcastTimeConverter.getCurrentRadioTime());
      if (check == 0) {
        // ライブ
        item.title = '★';
      } else if (check > 0) {
        // 配信前
        item.title = '⬜︎';
      } else {
        const check = broadcastTimeConverter.checkProgramTime(progData.ft,
          progData.to, broadcastTimeConverter.getCurrentRadioDate() +
        '050000');
        if (check >= -7 * 86400) {
          // タイムフリー（TODO: タイムフリー30はどうする？）
          item.title = '▷';
        } else {
          // 配信終了
          item.title = '×';
        }
      }
      item.uri += `&${progData.ft}&${progData.to}`;
    } else {
      item.title = '？';
    }

    const time: string = progData ? broadcastTimeConverter.formatFullString2([
      progData.ft, progData.to
    ], this.jpRadioConfig.timeFmt) : '';

    const duration: number = progData ? broadcastTimeConverter.getTimeSpan(progData.ft, progData.to) : 0; // sec

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
    const service: string = this.serviceName;
    const type = 'item-no-menu';

    return {
      service, type, title, uri
    };
  }

  private makeBrowseList(title: string, availableListViews: string[], items: BrowseItem[], sortKey: string = ''): BrowseList {
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
      // すでに起動している旨を通知
      this.commandRouter.pushToastMessage('warning', 'JP Radio', this.messageHelper.get('ALREADY_STARTED'));
      return;
    }

    // 起動を通知
    this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('BOOT_STARTING'));

    this.rdkProg = new RdkProg();
    this.radikoService = new RadikoService(this.jpRadioConfig.areaIdArray);

    await this.#init();

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.jpRadioConfig.port, () => {
        this.logger.info('JRADI01SI0015', this.jpRadioConfig.port);

        this.task1.start();
        // JPxxからエリア名(北海道・東北、関東など)を取得
        const areaName: string = getRegionByPref(this.myInfo.areaId);

        const areaFree: string = this.myInfo.areafree ? ` / ${this.messageHelper.get('AREA_FREE')}` : '';

        const msg1: string = this.messageHelper.get('BOOT_COMPLETED');
        const msg2: string = this.messageHelper.get('AREA_INFO', areaName + areaFree, this.myInfo.cntStations);

        this.commandRouter.pushToastMessage('success', 'JP Radio', msg1 + msg2);
        resolve();

      }).on('error', (error: any) => {
        this.logger.error('JRADI01SE0006', error);
        this.commandRouter.pushToastMessage('error', this.messageHelper
          .get('ERR_BOOT_FAIL'), error.message || this.messageHelper
            .get('ERR_UNKNOWN'));
        reject(error);
      });
    });
  }

  // プラグインの終了時の処理
  public async stop(): Promise<void> {
    this.logger.info('JRADI01SI0016');
    // サーバーが起動中であれば以下の処理実施
    if (this.server !== null) {
      this.task1.stop();
      this.task2.stop();
      this.server.close();
      this.server = null;

      await this.rdkProg?.dbClose();
      this.rdkProg = null;
      this.radikoService = null;
      //this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('STOPED'));
    }
  }

  async #init(): Promise<void> {
    this.logger.info('JRADI01SI0017');
    if (this.radikoService !== null) {
      this.logger.info('RadioTest0001');
      [this.myInfo.areaId, this.myInfo.areafree, this.myInfo.member_type] = await this.radikoService.init(this.acct);
    }
    await this.#pgupdate(true);
    this.logger.info('JRADI01SI0018', JSON.stringify(this.myInfo));
  }

  // 番組表の更新
  async #pgupdate(whenBoot = false): Promise<void> {
    this.logger.info('JRADI01SI0019');
    if (this.rdkProg) {
      // 処理開始を記録
      const updateStartTime = Date.now();

      const areaIdArray = (this.myInfo.areafree) ? this.jpRadioConfig.areaIdArray : [this.myInfo.areaId];

      // 番組表の更新
      this.myInfo.cntStations = await this.rdkProg.updatePrograms(areaIdArray, whenBoot);

      // 古い番組表を削除
      await this.rdkProg.clearOldProgram();

      // 処理終了を記録
      const updateEndTime = Date.now();

      // 処理にかかった時間をLogに出力
      const processingTime = updateEndTime - updateStartTime;
      this.logger.info('JRADI01SI0020', processingTime);
    }
  }

  public getAreaStations(areaId: string, woZenkoku: boolean = true): string[] {
    const item = this.radikoService?.areaData.get(areaId);
    //this.logger.info(`JP_Radio::JpRadio.getAreaStations: ${areaId}=${item?.areaName}/${item?.stations}`);
    if (woZenkoku === true) {
      let stations: string[] = [];

      item?.stations.forEach((stationId) => {
        const info = this.radikoService?.getStations().get(stationId);

        if (info?.RegionName !== '全国') {
          stations.push(stationId);
        }

      });
      return stations;
    }
    return item?.stations ?? [];
  }

  // アルバムアート
  private selectAlbumart(banner: string | undefined, logo: string | undefined, prog: string | undefined): string {
    let result;
    switch (this.jpRadioConfig.aaType) {
      case 'type1':
        // バナー
        result = banner;
        break;
      case 'type2':
        // 放送局ロゴ
        result = logo;
        break;
      case 'type3':
        // 番組画像
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
    return this.rdkProg;
  }
}
