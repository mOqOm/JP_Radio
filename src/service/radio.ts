import express, { Application, Request, Response } from 'express';

import { parse } from 'querystring';
import type { ParsedQs } from 'qs';
import path from 'path';

import cron from 'node-cron';
import libQ from 'kew';

import { format, addDays } from 'date-fns';

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

import type { DateOnly, DateTime } from '@/types/date-time.types';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { MessageHelper } from '@/utils/message-helper.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';
import { getPrefKanji } from '@/utils/radiko-area.util';

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
 * @method radioFavouriteStations - お気に入りのラジオ局を取得します。
 */
export default class JpRadio {
  private readonly app: Application;
  private server: ReturnType<Application['listen']> | null = null;
  private readonly task1: ReturnType<typeof cron.schedule>;
  private readonly task2: ReturnType<typeof cron.schedule>;
  // 番組表の再取得リトライ上限回数
  private readonly geProgramsRetryLimit: number = 2;

  // LoggerEx はプロジェクト全体のグローバルから取得
  private readonly logger: LoggerEx = (globalThis as any).JP_RADIO_LOGGER;
  // サービス名はプロジェクト全体のグローバルから取得
  private readonly serviceName: string = (globalThis as any).JP_RADIO_SERVICE_NAME;

  private readonly loginAccount: LoginAccount | null;
  private readonly jpRadioConfig: JpRadioConfig;
  private readonly commandRouter: any;
  private rdkProg: RdkProg | null = null;
  private radikoService: RadikoService | null = null;
  private radikoMyInfo: RadikoMyInfo = {
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
  //private readonly baseDir: string = path.resolve(process.cwd(), 'assets', 'templates');
  private readonly baseDir: string = path.resolve(__dirname, '..', '..', 'assets', 'templates');

  constructor(loginAccount: LoginAccount | null, jpRadioConfig: JpRadioConfig, commandRouter: any, messageHelper: MessageHelper) {
    this.app = express();
    this.loginAccount = loginAccount;
    this.jpRadioConfig = jpRadioConfig;
    this.commandRouter = commandRouter;
    this.messageHelper = messageHelper;

    // 静的ファイル配信設定（CSS/JS/画像）
    this.app.use('/assets', express.static(this.baseDir));

    // テンプレートエンジン設定 (EJS)
    this.app.set('views', this.baseDir);
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
      // 局ID取得
      const stationId: string = req.params['stationID'];

      // radikoServiceの初期化されていない場合はエラー
      if (this.radikoService === undefined || this.radikoService === null) {
        const msg = '[JpRadio]Radiko instance not initialized';
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }

      // 指定された局が存在しない場合はエラー
      if (!this.radikoService.getStations()?.has(stationId)) {
        const msg = `[JpRadio]${stationId} not in available stations`;
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }

      try {
        // ストリーム開始
        this.startStream(res, stationId, req.query);

        this.playing.stationId = stationId;
        const ft = req.query['ft'] as string | undefined;
        const to = req.query['to'] as string | undefined;
        this.playing.timeFree = (ft && to) ? `${ft}-${to}` : '';
        //this.playing.seek = req.query.seek ?? '';
        //this.playing.seek = req.query.seek ?? '';
      } catch (error: any) {
        const msg = `[JpRadio]Stream start error: ${error?.message || error}`;
        this.logger.error(msg);
        res.status(500).send(msg);
        return;
      }
    });

    /**
     * Debug/Test 用
     * 放送局情報一覧の表示用
     * API endpoint for station data (JSON)
     */
    this.app.get('/api/radiko/stations', (_req: Request, res: Response) => {
      // radikoServiceの初期化されていない場合はエラー
      if (this.radikoService === undefined || this.radikoService === null) {
        res.status(500).json({ error: 'Radiko service not initialized' });
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

      res.json({ stations: rows });
    });

    /**
     * Debug/Test 用
     * 現在日時で放送中の番組情報をDBから検索する
     * API endpoint: stations + current program from DB
     */
    this.app.get('/api/radiko/stations/with-program', async (_req: Request, res: Response) => {
      if (!this.radikoService || !this.rdkProg) {
        res.status(500).json({ error: 'Service not initialized' });
        return;
      }

      try {
        const stations = this.radikoService.getStations();

        const rows = await Promise.all(
          Array.from(stations.entries()).map(async ([stationId, info]) => {
            try {
              // DBから指定した放送局IDの現在放送中の番組情報を取得
              const radikoProgramData: RadikoProgramData = await this.rdkProg!.getDbCurProgramData(stationId);

              const ftDateStr: string = radikoProgramData.ft.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
              const toDateStr: string = radikoProgramData.to.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });


              return {
                stationId: stationId,
                name: info.Name,
                region: info.RegionName || '-',
                area: info.AreaName || '-',
                program: radikoProgramData
                  ? {
                    progId: radikoProgramData.progId || '',
                    title: radikoProgramData.title,
                    pfm: radikoProgramData.pfm || '',
                    ft: ftDateStr,
                    to: toDateStr,
                    img: radikoProgramData.img || null
                  }
                  : null
              };
            } catch {
              return {
                stationId: stationId,
                name: info.Name,
                region: info.RegionName || '-',
                area: info.AreaName || '-',
                program: null
              };
            }
          })
        );

        res.json({ stations: rows });
      } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Unknown error' });
      }
    });

    /**
     * Debug/Test 用
     * 指定の放送局IDを用いて番組表情報をDBから検索する
     * ft/toは string 型でJSTに変換して返す
     * API endpoint: program list from DB by station and date (radio-day 05:00-29:00)
     */
    this.app.get('/api/radiko/stations/:stationId/programs', async (req: Request, res: Response) => {
      if (!this.radikoService || !this.rdkProg) {
        res.status(500).json({ error: 'Service not initialized' });
        return;
      }

      const stationId = req.params['stationId'];
      if (!this.radikoService.getStations()?.has(stationId)) {
        res.status(404).json({ error: 'Unknown stationId' });
        return;
      }

      // yyyyMMdd 形式の日付文字列を取得
      const dateStr: string = req.query['date'] as string;
      if (dateStr === undefined || dateStr === null || dateStr === '' || dateStr.length !== 8) {
        res.status(400).json({ error: 'Invalid date format. Use yyyyMMdd.' });
        return;
      }

      // yyyyMMdd → DateOnly オブジェクトに変換
      const dateOnly: DateOnly = broadcastTimeConverter.parseDateToDateOnly(dateStr);

      try {
        const programs: Array<{
          progId: string;
          ft: string;
          to: string;
          dur: string;
          title: string;
          pfm: string;
          img: string | null;
        }> = [];

        const radikoProgramDataArray: RadikoProgramData[] = await this.rdkProg.getDbRadikoProgramData(stationId, dateOnly);

        if (radikoProgramDataArray.length > 0) {
          for (const radikoProgramData of radikoProgramDataArray) {

            // ft/to を HH:mm の時分だけの文字列に変換して格納
            const ftTimeStr: string = broadcastTimeConverter.formatDateTime(radikoProgramData.ft, 'HH:mm');
            const toTimeStr: string = broadcastTimeConverter.formatDateTime(radikoProgramData.to, 'HH:mm');
            // 再生時間（秒）
            const dur: number = radikoProgramData.dur;
            // 表示用の再生時間文字列
            let durationDescription: string = '';

            if (dur <= 0) {
              durationDescription = '0分';
            } else {
              // 分単位に変換
              const durMinutes: number = Math.floor(dur / 60);
              // 時間と分に分割
              const hours: number = Math.floor(durMinutes / 60);
              const minutes: number = durMinutes % 60;

              if (hours > 0) {
                durationDescription = minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
              } else {
                durationDescription = `${minutes}分`;
              }
            }

            programs.push({
              progId: radikoProgramData.progId || '',
              ft: ftTimeStr,
              to: toTimeStr,
              dur: durationDescription,
              title: radikoProgramData.title,
              pfm: radikoProgramData.pfm || '',
              img: radikoProgramData.img || null
            });
          }
        }
        res.json({ stationId, date: dateOnly, programs });
      } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Failed to read programs' });
      }
    });

    // View endpoint for dev page
    this.app.get('/radiko/dev/', (_req: Request, res: Response) => {
      // 拡張子を付けずにビュー名を指定（radiko_dev.ejs を使用）
      res.render('radiko_dev', { apiEndpoint: '/api/radiko/stations' });
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

    // Radikoサービスが初期化されていない場合のエラー
    if (this.radikoService === undefined || this.radikoService === null) {
      this.logger.error('JRADI01SE0002');
      res.status(500).send('Radiko service not initialized');
      throw new Error('Radiko service not initialized');
    }

    try {
      // ストリームを開始するためにRadikoサービスを呼び出す
      const ffmpeg = await this.radikoService.play(stationId, query);
      // ffmpegが正しく初期化されていない または Stdoutが存在しない場合のエラー
      if (ffmpeg === undefined || ffmpeg === null
        || ffmpeg.stdout === undefined || ffmpeg.stdout === null) {

        this.logger.error('JRADI01SE0002');
        res.status(500).send('Stream start error');
        throw new Error('Stream start error');
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
            throw error;
          }
        }
      });
      this.logger.info('JRADI01SI0008');

    } catch (error: any) {
      // 内部サーバーエラーの処理
      this.logger.error('JRADI01SE0003', error);
      res.status(500).send('Internal server error');
      throw error;
    }
  }

  public async pushSongState(forceUpdate: boolean = false): Promise<void> {
    const state = this.commandRouter.stateMachine.getState();

    if (this.playing.timeFree) {
      // タイムフリー：１回のみ
      if (state.status === 'play') {
        const stationName = this.radikoService?.getStationName(this.playing.stationId);
        // 'yyyyMMddHHmm-yyyyMMddHHmm'形式の文字列を分割
        const [ftStr, toStr]: string[] = this.playing.timeFree.split('-');

        // yyyyMMddHHmm形式のDateTimeオブジェクトに変換
        const ftDateTime: DateTime = broadcastTimeConverter.parseStringToDateTime(ftStr);
        const toDateTime: DateTime = broadcastTimeConverter.parseStringToDateTime(toStr);

        // DBから番組情報を取得
        const progData = await this.rdkProg?.getProgramData(this.playing.stationId, ftDateTime, true);

        if (progData) {

        }

        // HH:mm-HH:mmの形式で取得
        const timeStr: string = broadcastTimeConverter.formatDateTimeRange(ftDateTime, toDateTime, 'HH:mm', 'HH:mm');

        // yyyyMMdd形式の形式で取得
        //const date: string = broadcastTimeConverter.formatDateString(ftStr, this.jpRadioConfig.dateFmt);
        const dateStr: string = broadcastTimeConverter.parseDateTimeToStringDate(ftDateTime);

        const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];
        state.title = queueItem.name + (queueItem.album ? ` - ${queueItem.album}` : '');
        state.artist = `${stationName} / ${timeStr} @${dateStr} (TimeFree)`;

        if (!state.duration) {
          state.duration = broadcastTimeConverter.getTimeSpanByDateTime(ftDateTime, toDateTime); // sec
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
        const progData: RadikoProgramData | undefined = await this.rdkProg?.getCurProgramData(this.playing.stationId, true);
        if (progData !== undefined && progData !== null) {
          const stationName = this.radikoService?.getStationName(this.playing.stationId);

          const ftDateTime: DateTime = progData.ft;
          const toDateTime: DateTime = progData.to;
          const currentTime: DateTime = broadcastTimeConverter.getCurrentRadioTime();

          // HH:mm-HH:mm の形式で取得
          const time: string = broadcastTimeConverter.formatDateTimeRange(ftDateTime, toDateTime, 'HH:mm', 'HH:mm');
          const queueItem = this.commandRouter.stateMachine.playQueue.arrayQueue[state.position];

          queueItem.name = progData.title;
          queueItem.album = progData.pfm;
          queueItem.artist = `${stationName} / ${time}`;
          queueItem.albumart = this.selectAlbumart(state.albumart, state.albumart, progData.img);
          queueItem.duration = broadcastTimeConverter.getTimeSpanByDateTime(ftDateTime, toDateTime); // sec

          state.title = progData.title + (progData.pfm ? ` - ${progData.pfm}` : '');
          state.artist = `${queueItem.artist} (Live)`;
          state.albumart = queueItem.albumart;
          state.duration = queueItem.duration
          state.seek = broadcastTimeConverter.getTimeSpanByDateTime(ftDateTime, currentTime) * 1000; // msec

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
    let arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    let changeFlag: boolean = false;

    for (const i in arrayQueue) {
      const queueItem = arrayQueue[i];
      if (queueItem.uri.includes('?') === true) {
        continue;
      }

      // uri = http://localhost:9000/radiko/play/TBS
      const stationId = queueItem.uri.split('/').pop();
      const progData = await this.rdkProg?.getCurProgramData(stationId, true);
      if (progData !== undefined && progData !== null) {
        const stationAndTime = queueItem.artist;
        // HH:mm-HH:mm 形式で取得
        const progTime: string = broadcastTimeConverter.formatDateTimeRange(progData.ft, progData.to, 'HH:mm', 'HH:mm');

        if (stationAndTime.endsWith(progTime) === false) {
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

  /**
   * 指定された再生モードに基づいてラジオ局を取得します。
   *
   * @param playMode - ラジオ局の再生モード（例: 'live', 'timefree'）
   * @returns ラジオ局のリストを含むBrowseResultを解決するPromise
   */
  public async radioStations(playMode: string): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0009', playMode);
    const defer = libQ.defer();

    // playMode = live or timefree or timefree_today
    if (this.radikoService !== undefined && this.radikoService !== null) {
      // RadikoServiceから局情報を取得
      const stations: Map<string, StationInfo> = this.radikoService.getStations();

      // 地域名ごとにグループ化
      const grouped: Record<string, BrowseItem[]> = {};

      const stationEntries = Array.from(stations);

      const stationPromises = stationEntries.map(async ([stationId, stationInfo]) => {
        try {
          const region: string = stationInfo.RegionName || 'others';

          if (grouped[region] === undefined || grouped[region] === null) {
            grouped[region] = [];
          }

          if (playMode === 'timefree') {
            const modeReplaceData: string = playMode.replace('free', 'table');
            // タイムフリー再生用BrowseItemを作成
            const browseItem: BrowseItem = this.createBrowseItemTimeFree(modeReplaceData, stationId, stationInfo);
            // グループに追加
            grouped[region].push(browseItem);
          } else {
            if (this.rdkProg !== undefined && this.rdkProg !== null) {
              // ライブ番組情報を取得
              const radikoProgramData: RadikoProgramData = await this.rdkProg.getCurProgramData(stationId, false);
              // ライブ再生用BrowseItemを作成
              const browseItem: BrowseItem = this.createBrowseItemLive('play', stationId, stationInfo, radikoProgramData);
              // グループに追加
              grouped[region].push(browseItem);
            }
          }
        } catch (error: any) {
          this.logger.error('JRADI01SE0004', stationId, error);
          throw error;
        }
      });

      libQ.all(stationPromises).then(() => {
        // BrowseList配列を作成
        const browseList: BrowseList[] = Object.entries(grouped).map(([regionName, items]) =>
          this.createBrowseList(regionName, ['grid', 'list'], items)
        );
        // BrowseResultを作成して返す
        return this.createBrowseResult(browseList);
      }).then((result: any) => {
        defer.resolve(result);
      }).fail((error: any) => {
        this.logger.error('JRADI01SE0005', error);
        defer.reject(error);
      });
    } else {
      defer.resolve(this.createBrowseResult([]));
    }

    return defer.promise;
  }

  public async radioFavouriteStations(mode: string): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0010', mode);
    const defer = libQ.defer();
    const items: BrowseItem[][] = await this.commonRadioFavouriteStations(mode);

    if (mode.startsWith('live') === true) {
      defer.resolve(this.createBrowseResult([
        this.createBrowseList(this.messageHelper.get('FAVOURITES_LIVE'), ['grid', 'list'], items[0])
      ]));
    } else if (mode.startsWith('timefree') === true) {
      defer.resolve(this.createBrowseResult([
        this.createBrowseList(this.messageHelper.get('BROWSE_TITLE_FAVOURITES_STATION'), ['grid', 'list'], items[0]),
        this.createBrowseList(this.messageHelper.get('BROWSE_TITLE_FAVOURITES_TIMEFREE'), ['list'], items[1])
      ]));
    }

    return defer.promise;
  }

  /**
   * 指定されたモードとステーションIDに基づいて、ラジオのタイムテーブルを取得します。
   *
   * @param mode - プログラム情報を取得するモード（例: 'timetable' または 'progtable'）。
   * @param stationId - ラジオステーションのID。
   * @param from - 取得するデータの開始日。
   * @param toDate - 取得するデータの終了日。
   * @returns 指定された期間のラジオプログラム情報を含む BrowseResult オブジェクトの Promise。
   */
  public async radioTimeTableDate(mode: string, stationId: string, fromDateOnly: DateOnly, toDateOnly: DateOnly): Promise<BrowseResult> {
    this.logger.info('JRADI01SI0011', mode, stationId, format(fromDateOnly, 'yyyy-MM-dd'), format(toDateOnly, 'yyyy-MM-dd'));

    const defer = libQ.defer();

    if (this.radikoService === undefined || this.radikoService === null || this.rdkProg === undefined || this.rdkProg === null) {
      const result = this.createBrowseResult([]);
      defer.resolve(result);
      return defer.promise;
    }

    // 放送局情報を取得
    const stationInfo: StationInfo = this.radikoService.getStationInfo(stationId);

    if (stationInfo === undefined || stationInfo === null || stationInfo.AreaId === undefined || stationInfo.AreaId === null) {
      const result = this.createBrowseResult([]);
      defer.resolve(result);
      return defer.promise;
    }

    try {
      const browseListArray: BrowseList[] = [];

      const weekArray: DateOnly[] = [];

      // 指定された日付範囲の日付を配列に追加
      for (let workDateOnly: DateOnly = fromDateOnly; toDateOnly >= workDateOnly; workDateOnly = addDays(workDateOnly, 1) as DateOnly) {
        weekArray.push(workDateOnly);
      }

      // 番組表データ取得開始メッセージ
      if (weekArray.length > 0) {
        this.commandRouter.pushToastMessage('info', 'JP Radio', this.messageHelper.get('PROGRAM_DATA_GETTING2', stationInfo.Name));
      }

      for (let i = 0; i < weekArray.length; i++) {
        // 番組表データ取得の現在のリトライ回数
        let retryCount = 0;

        let radikoProgramDataArray: RadikoProgramData[] = [];

        // 番組表データをDBから取得、存在しない場合は外部ソースから取得を試みる
        do {
          radikoProgramDataArray = await this.rdkProg!.getDbRadikoProgramData(stationId, weekArray[i]);

          // DBにデータが存在しない場合に新しく取得を試みる
          if (radikoProgramDataArray.length === 0) {
            this.logger.warn('JRADI01SW0002', stationId, format(weekArray[i], 'yyyy-MM-dd'));
            // DBにデータが存在しない場合、外部ソースからデータを取得してDBに保存
            await this.rdkProg!.getDailyStationPrograms(stationId, weekArray[i]);
            // リトライ回数をインクリメント
            retryCount++;
          }
        } while (radikoProgramDataArray.length === 0 && retryCount < this.geProgramsRetryLimit);

        const browseItemArray: BrowseItem[] = radikoProgramDataArray.map((radikoProgramData: RadikoProgramData) => {
          const browseItem: BrowseItem = this.createBrowseItemTimeTable(
            mode === 'progtable' ? 'proginfo' : 'play',
            stationId,
            stationInfo,
            radikoProgramData
          );

          if (mode === 'progtable') {
            browseItem.type = 'radio-category';
            browseItem.uri = browseItem.uri.replace(/\/play\//, '/proginfo/');
          }

          return browseItem;
        });

        // 表示の区切りで M月d日(E) を入れる
        let sectionTitle: string = broadcastTimeConverter.formatDateOnly(weekArray[i], 'M月d日(E)');
        if (mode.startsWith('progtable') === false) {
          if (i === (weekArray.length - 1)) {
            // 今日の場合は「（今日）」を追加
            sectionTitle += this.messageHelper.get('BROWSE_BUTTON_TODAY');
          }
        }

        // yyyyMMdd 形式の文字列を生成
        const dateStr: string = broadcastTimeConverter.formatDateOnly(weekArray[i], 'yyyyMMdd');

        const browseList: BrowseList = {
          title: sectionTitle,
          availableListViews: ['list'],
          items: browseItemArray,
          sortKey: dateStr
        };

        browseListArray.push(browseList);
      }

      // ナビゲーションボタンの追加
      const space = '　'.repeat(mode.startsWith('time') ? 9 : 6);
      const uri = `radiko/${mode}/${stationId}`;

      // 前週の日付範囲を計算（現在の from/to から7日前）
      const prevWeekFromDateOnly: DateOnly = addDays(fromDateOnly, -7) as DateOnly;
      const prevWeekToDateOnly: DateOnly = addDays(toDateOnly, -7) as DateOnly;

      // 前日の日付範囲を計算（from の前日）
      const prevDayFromDateOnly: DateOnly = addDays(fromDateOnly, -1) as DateOnly;
      const prevDayToDateOnly: DateOnly = addDays(fromDateOnly, -1) as DateOnly;

      // 次週の日付範囲を計算（現在の from/to から7日後）
      const nextWeekFromDateOnly: DateOnly = addDays(fromDateOnly, 7) as DateOnly;
      const nextWeekToDateOnly: DateOnly = addDays(toDateOnly, 7) as DateOnly;

      // 翌日の日付範囲を計算（to の翌日）
      const nextDayFromDateOnly: DateOnly = addDays(toDateOnly, 1) as DateOnly;
      const nextDayToDateOnly: DateOnly = addDays(toDateOnly, 1) as DateOnly;

      // 前週/前日ボタン（sortKey を '0000' に設定して先頭に配置）
      browseListArray.unshift(
        this.createBrowseList('<<', ['list'], [
          this.createBrowseItemNoMenu(
            space + this.messageHelper.get('BROWSE_BUTTON_PREV_WEEK'),
            `${uri}/${format(prevWeekFromDateOnly, 'yyyy-MM-dd')}~${format(prevWeekToDateOnly, 'yyyy-MM-dd')}`
          ),
          this.createBrowseItemNoMenu(
            space + this.messageHelper.get('BROWSE_BUTTON_PREV_DAY'),
            `${uri}/${format(prevDayFromDateOnly, 'yyyy-MM-dd')}~${format(prevDayToDateOnly, 'yyyy-MM-dd')}`
          )
        ], '0000')
      );

      // 次週/翌日ボタン（sortKey を '9999' に設定して末尾に配置）
      browseListArray.push(
        this.createBrowseList('>>', ['list'], [
          this.createBrowseItemNoMenu(
            space + this.messageHelper.get('BROWSE_BUTTON_NEXT_DAY'),
            `${uri}/${format(nextDayFromDateOnly, 'yyyy-MM-dd')}~${format(nextDayToDateOnly, 'yyyy-MM-dd')}`
          ),
          this.createBrowseItemNoMenu(
            space + this.messageHelper.get('BROWSE_BUTTON_NEXT_WEEK'),
            `${uri}/${format(nextWeekFromDateOnly, 'yyyy-MM-dd')}~${format(nextWeekToDateOnly, 'yyyy-MM-dd')}`
          )
        ], '9999')
      );

      // progtable モードの場合、お気に入り局を追加
      if (mode.startsWith('progtable') === true) {
        const [items] = await this.commonRadioFavouriteStations('timefree', true);
        items.forEach((item) => {
          item.uri = item.uri.replace('timetable', 'progtable') + `/${format(fromDateOnly, 'yyyy-MM-dd')}~${format(toDateOnly, 'yyyy-MM-dd')}`;
        });
        browseListArray.push(
          this.createBrowseList(
            this.messageHelper.get('BROWSE_PROG_FAVOURITES'),
            ['grid', 'list'],
            items,
            'zzzz' // 最後に表示
          )
        );
      }

      const browseResult: BrowseResult = this.createBrowseResult(browseListArray);
      defer.resolve(browseResult);
    } catch (error: any) {
      this.logger.error('JRADI01SE0007', error);
      defer.reject(error);
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

      if (liveUri.includes('/radiko/play/') === true) {
        const stationId = liveUri.split('/').pop();

        if (this.radikoService !== undefined && this.radikoService !== null && this.rdkProg !== undefined && this.rdkProg !== null && stationId !== undefined && stationId !== null) {

          const stationInfo: StationInfo = this.radikoService.getStationInfo(stationId);

          if (mode.startsWith('live') === true) {
            // ライブ
            if (timefree !== undefined && timefree !== null) { // タイムフリー番組は無視
              const progData: RadikoProgramData = await this.rdkProg.getCurProgramData(stationId, false);
              const browseItem: BrowseItem = this.createBrowseItemLive('play', stationId, stationInfo, progData);
              browseItem.favourite = true;
              items[0].push(browseItem);
            }
          } else if (mode.startsWith('timefree') === true) {
            // タイムフリー
            if (!timefree) { // 日時指定の有無で放送局・番組に分けて表示
              // 放送局
              items[0].push(this.createBrowseItemTimeFree('timetable', stationId, stationInfo));
            } else if (!skipPrograms) {
              // 番組
              const query = parse(timefree);

              if (query.ft === undefined || query.ft === null || query.ft === '' || query.to === undefined || query.to === null || query.to === '') {
                return;
              }

              const ftDateTime: DateTime = broadcastTimeConverter.parseStringToDateTime(String(query.ft));
              const toDateTime: DateTime = broadcastTimeConverter.parseStringToDateTime(String(query.to));

              const check1: number = broadcastTimeConverter.checkProgramTime(ftDateTime, toDateTime, broadcastTimeConverter.getCurrentRadioTime());
              const check2: number = broadcastTimeConverter.checkProgramTime(ftDateTime, toDateTime, broadcastTimeConverter.getCurrentRadioTime());

              // 配信期間内だけリトライする
              const retry: boolean = (-7 * 86400 <= check1 && check2 < 0);
              const progData: RadikoProgramData = await this.rdkProg.getProgramData(stationId, ftDateTime, retry);

              const item: BrowseItem = this.createBrowseItemTimeTable('play', stationId, stationInfo, progData);

              item.favourite = true;
              items[1].push(item);
            }
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

  private createBrowseItemLive(mode: string, stationId: string, stationInfo: StationInfo, progData: RadikoProgramData): BrowseItem {
    //this.logger.info(`JP_Radio::JpRadio.makeBrowseItem_Live: stationId=${stationId}`);
    const areaName: string = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName: string = stationInfo ? stationInfo.Name : stationId;
    const areaStation: string = `${areaName} / ${stationName}`;
    const progTitle: string = progData ? progData.title : '?';
    const progPfm: string = progData ? progData.pfm! : '';

    // ft と to が存在するかチェック
    let progTime: string = '';

    if (progData?.ft !== undefined && progData?.ft !== null && progData?.to !== undefined && progData?.to !== null) {
      // HH:mm-HH:mm 形式で取得
      progTime = broadcastTimeConverter.formatDateTimeRange(progData.ft, progData.to, 'HH:mm', 'HH:mm');
    }

    const albumart: string = this.selectAlbumart(stationInfo?.BannerURL, stationInfo?.LogoURL, progData?.img);

    // TODO: URIとしてふさわしくない構造しているので修正必須
    const uri: string = `radiko/${mode}/${stationId}` + '?' + encodeURIComponent(progTitle) +
      '&' + encodeURIComponent(progPfm) + '&' + encodeURIComponent(
        `${stationName} / ${progTime}`) + '&' + encodeURIComponent(albumart);

    const browseItem: BrowseItem = {
      service: 'jp_radio',
      type: 'song',
      // 番組タイトル
      title: progTitle,
      // パーソナリティ名
      album: progPfm,
      // エリア名 / 局名 / 時間
      artist: `${areaStation} / ${progTime}`,
      albumart: albumart,
      uri: uri
    };

    // ブラウズ画面に表示する情報
    return browseItem;
  }

  private createBrowseItemTimeFree(mode: string, stationId: string, stationInfo: StationInfo): BrowseItem {
    let areaName: string = '?';
    let stationName: string = stationId;
    let albumart: string = '';

    if (stationInfo !== undefined && stationInfo !== null) {
      // エリア名と局名を取得
      areaName = stationInfo.AreaKanji || stationInfo.AreaName;
      // 放送局名を取得
      stationName = stationInfo.Name;
      // アルバムアートを選択
      albumart = this.selectAlbumart(stationInfo.BannerURL, stationInfo.LogoURL, stationInfo.LogoURL);
    }

    // ブラウズ画面に表示する情報
    return {
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

  private createBrowseItemTimeTable(mode: string, stationId: string, stationInfo: StationInfo, progData: RadikoProgramData): BrowseItem {
    const browseItem: BrowseItem = this.createBrowseItemLive(mode, stationId, stationInfo, progData);
    const areaName: string = stationInfo ? (stationInfo.AreaKanji || stationInfo.AreaName) : '?';
    const stationName: string = stationInfo ? stationInfo.Name : stationId;
    const areaStation: string = `${areaName} / ${stationName}`;

    let progTitle: string = '?';
    if (progData !== undefined && progData !== null) {
      progTitle = progData.title
    }
    // ft と to が存在するかチェック
    if (progData?.ft && progData?.to) {
      const check: number = broadcastTimeConverter.checkProgramTime(progData.ft, progData.to, broadcastTimeConverter.getCurrentRadioTime());
      if (check === 0) {
        // ライブ
        browseItem.title = '★';
      } else if (check > 0) {
        // 配信前
        browseItem.title = '⬜︎';
      } else {
        const check: number = broadcastTimeConverter.checkProgramTime(progData.ft, progData.to, broadcastTimeConverter.getCurrentRadioTime());
        if (check >= -7 * 86400) {
          // タイムフリー（TODO: タイムフリー30はどうする？）
          browseItem.title = '▷';
        } else {
          // 配信が終了済みの場合は番組タイトルに「×」を追加
          browseItem.title = '×';
        }
      }
      browseItem.uri += `&${progData.ft}&${progData.to}`;
    } else {
      browseItem.title = '？';
    }

    let time: string = ''

    if (progData !== undefined && progData !== null) {
      // 日時フォーマット
      const ftDateTime: DateTime = progData.ft;
      const toDateTime: DateTime = progData.to;
      // フォーマット文字列取得
      //const format: string = this.jpRadioConfig.dateFmt;

      // HH:mm-HH:mm形式で追加
      time = broadcastTimeConverter.formatDateTimeRange(ftDateTime, toDateTime, 'HH:mm', 'HH:mm');
    }

    let duration: number = 0;

    if (progData !== undefined && progData !== null) {
      // secs
      duration = broadcastTimeConverter.getTimeSpanByDateTime(progData.ft, progData.to);
    }

    // 番組タイトルの前に日時(HH:mm-HH:mm)を追加
    browseItem.title += `[${time}] ${progTitle}`;

    browseItem.time = '';
    if (progData !== undefined && progData !== null) {
      browseItem.time = broadcastTimeConverter.parseDateTimeToStringDateTime(progData.ft);
    }

    // エリア名 / 局名
    browseItem.artist = areaStation;
    // 番組時間
    browseItem.duration = duration;

    return browseItem;
  }

  private createBrowseItemNoMenu(title: string, uri: string): BrowseItem {
    const service: string = this.serviceName;
    const type = 'item-no-menu';

    return {
      service, type, title, uri
    };
  }

  private createBrowseList(title: string, availableListViews: string[], items: BrowseItem[], sortKey: string = ''): BrowseList {
    return {
      title, availableListViews, items, sortKey
    };
  }

  private createBrowseResult(lists: BrowseList[]): BrowseResult {
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
        // JPxxからエリア名(都道府県)を取得
        const areaName: string = getPrefKanji(this.radikoMyInfo.areaId);

        const areaFree: string = this.radikoMyInfo.areafree ? ` / ${this.messageHelper.get('AREA_FREE')}` : '';

        // TODO:改行する方法ないかなぁ・・・
        const msg1: string = this.messageHelper.get('BOOT_COMPLETED') + '　'.repeat(10);
        const msg2: string = this.messageHelper.get('AREA_INFO', areaName + areaFree, this.radikoMyInfo.cntStations);

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
    }
  }

  async #init(): Promise<void> {
    this.logger.info('JRADI01SI0017');
    if (this.radikoService !== null) {
      try {
        this.logger.info('RadioTest0001');
        this.radikoMyInfo = await this.radikoService.init(this.loginAccount);
      } catch (error: any) {
        this.logger.error('JRADI01SE0007', error);
        throw error;
      }
    }
    await this.#pgupdate(true);
    this.logger.info('JRADI01SI0018', JSON.stringify(this.radikoMyInfo));
  }

  // 番組表の更新
  async #pgupdate(whenBoot = false): Promise<void> {
    this.logger.info('JRADI01SI0019');
    if (this.rdkProg) {
      // 処理開始を記録
      const updateStartTime = Date.now();

      const areaIdArray: string[] = (this.radikoMyInfo.areafree) ? this.jpRadioConfig.areaIdArray : [this.radikoMyInfo.areaId];

      // 番組表の更新
      this.radikoMyInfo.cntStations = await this.rdkProg.updatePrograms(areaIdArray, whenBoot);

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
  private selectAlbumart(banner: string | undefined, logo: string | undefined, prog: string | undefined | null): string {
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
      '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg';
  }

  public getMyInfo(): any {
    return this.radikoMyInfo;
  }

  public getPrg(): RdkProg | null {
    return this.rdkProg;
  }
}
