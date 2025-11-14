import 'module-alias/register';
import libQ from 'kew';
import VConf from 'v-conf';
import path from 'path';
import { exec } from 'child_process';
import { format } from 'util';
import { parse as queryParse, ParsedUrlQuery } from 'querystring';
import { ParsedQs } from 'qs';

// 定数のインポート
import { RADIKO_AREA } from '@/constants/radiko-area.const'

// Modelのインポート
import type { LoginAccount } from '@/models/auth.model';
import type { JpRadioConfig } from '@/models/jp-radio-config.model';
import type { RadikoMyInfo } from '@/models/radiko-myinfo.model';

// Utilsのインポート
import { LoggerEx } from '@/utils/logger.util';
import { messageHelper } from '@/utils/message-helper.util';
import { broadcastTimeConverter } from '@/utils/broadcast-time-converter.util';

import type { DateOnly, DateTime } from '@/types/date-time.types';
import { createDateTime } from '@/types/date-time.types';

// Seviceのインポート
import JpRadio from '@/service/radio';

export = JpRadioController;

/**
 * グローバルに公開する値の型宣言（any を排除）
 * - Controller がセットする
 * - Service 側は読み取り専用で参照する想定
 */
declare global {
  // eslint-disable-next-line no-var
  var JP_RADIO_LOGGER: LoggerEx;
  // eslint-disable-next-line no-var
  var JP_RADIO_SERVICE_NAME: string;
}

/** globalThis を拡張した型 */
type GlobalJP = typeof globalThis & {
  JP_RADIO_LOGGER: LoggerEx;
  JP_RADIO_SERVICE_NAME: string;
};

class JpRadioController {
  private readonly context: any;
  private readonly commandRouter: any;

  private _logger!: LoggerEx;
  // LoggerEx をグローバルに取得
  private get logger(): LoggerEx {
    return this._logger;
  }
  // LoggerEx をグローバルに設定
  private set logger(value: LoggerEx) {
    (globalThis as GlobalJP).JP_RADIO_LOGGER = value;
    this._logger = value;
  }

  private _serviceName: string = 'jp_radio';
  // サービス名はプロジェクト全体のグローバルから取得（未設定時は 'jp_radio'）
  private get serviceName(): string {
    return this._serviceName;
  }

  // サービス名はプロジェクト全体のグローバルに設定
  private set serviceName(value: string) {
    (globalThis as any).JP_RADIO_SERVICE_NAME = value;
  }

  private config: InstanceType<typeof VConf> | null = null;

  private jpRadioConfig: JpRadioConfig;

  private appRadio: JpRadio | null = null;
  private mpdPlugin: any;
  // 言語のコード('ja','en'等)
  private readonly langCode: string;

  private readonly baseDir: string = path.resolve(process.cwd());

  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;

    // LoggerEx 初期化（Volumio標準loggerをラップ）
    this.logger = new LoggerEx(context.logger, this.serviceName);

    // Volumio の sharedVars から言語コード取得
    //const lang = this.commandRouter.sharedVars.get('language_code') || 'ja';

    // TODO: リリース時は削除
    this.langCode = 'ja';

    // 共通 messageHelper に言語を設定
    messageHelper.setLanguage(this.langCode);

    // LoggerEx 内でも messageHelper を参照できるように設定
    // （LoggerEx 内のログ出力で i18n 文字列が使える）
    this.logger.setLanguage(this.langCode);

    // journalctl / livelog に debug も表示させる
    this.logger.enableForceDebug(false);
  }

  public onVolumioStart(): Promise<void> {
    this.logger.info('JRADI01CI0001');

    const defer = libQ.defer();

    try {
      const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
      this.config = new VConf();
      this.config.loadFile(configFile);
      defer.resolve();
    } catch (error: any) {
      defer.reject(error);
    }

    return defer.promise;
  }

  public onVolumioShutdown(): Promise<void> {
    this.logger.info('JRADI01CI0002');

    const defer = libQ.defer();
    this.onStop().then(() =>
      defer.resolve()
    );
    return defer.promise;
  }

  public onVolumioReboot(): Promise<void> {
    this.logger.info('JRADI01CI0003');

    const defer = libQ.defer();
    this.onStop().then(() =>
      defer.resolve()
    );
    return defer.promise;
  }

  public onStart(): Promise<void> {
    this.logger.info('JRADI01CI0005');
    const startTime = Date.now();
    const defer = libQ.defer();

    if (this.config === undefined || this.config === null) {
      this.logger.error('JRADI01CE0002');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }

    this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    // Radikoアカウント情報取得
    const radikoUser: string = this.config.get('radikoUser');
    const radikoPass: string = this.config.get('radikoPass');

    const loginAccount: LoginAccount | null = (radikoUser && radikoPass) ? { mail: radikoUser, pass: radikoPass } : null;

    const areaIdArray = new Array<string>();

    for (const areaId of Array.from({ length: 47 }, (_, i) => `JP${i + 1}`)) {
      if (this.config.get(`radikoAreas.${areaId}`) === true) {
        areaIdArray.push(areaId);
      }
    }

    const timeFormat = this.config.get('timeFormat') ?? 'yyyy/MM/dd HH:mm-HH:mm';

    const jpRadioConfig: JpRadioConfig = {
      // 起動ポート
      port: this.config.get('servicePort') ?? 9000,
      // ネットワーク遅延(ディレイ)
      delay: this.config.get('networkDelay') ?? 20,
      // アルバムアート種別
      aaType: this.config.get('albumartType') ?? 'type3',
      // タイムフリー期間（過去何日分）
      ppFrom: this.config.get('programPeriodFrom') ?? 7,
      // タイムフリー期間（未来何日分）
      ppTo: this.config.get('programPeriodTo') ?? 0,
      // 時刻フォーマット
      timeFmt: timeFormat,
      // 日付フォーマット
      dateFmt: timeFormat.replace(/\s.+$/, ''),
      // 有効エリアID配列
      areaIdArray: areaIdArray
    };

    this.jpRadioConfig = jpRadioConfig;

    this.appRadio = new JpRadio(loginAccount, this.jpRadioConfig, this.commandRouter, messageHelper);

    this.appRadio.start().then(() => {
      this.addToBrowseSources();
      const endTime = Date.now();
      const processingTime: number = endTime - startTime;
      this.logger.info('JRADI01CI0006', processingTime);
      defer.resolve();
    }).catch((error: any) => {
      // ログ出力（stack も自動的に表示される）
      this.logger.error('JRADI01CE0001', error);

      if (error.code === 'EADDRINUSE') {
        const message = messageHelper.get('ERROR_PORT_IN_USE', this.jpRadioConfig.port);
        this.logger.error('JRADI01CE0002', message);
        this.commandRouter.pushToastMessage(
          'error',
          messageHelper.get('ERROR_BOOT_FAILED'),
          message
        );
      } else {
        this.commandRouter.pushToastMessage(
          'error',
          messageHelper.get('ERROR_BOOT_FAILED'),
          error.message || messageHelper.get('ERROR_UNKNOWN')
        );
      }
      defer.reject(error);
    });
    return defer.promise;
  }

  public async onStop(): Promise<void> {
    // この関数，終了時に自動コールされないんだけど何で？
    //  => プラグイン管理でOFFにしたときにコールされるようだ
    //  => onVolumioShutdown,onVolumioRebootからコールするようにしてみた
    this.logger.info('JRADI01CI0007');
    if (this.appRadio !== null) {
      try {
        await this.appRadio.stop();
        this.appRadio = null;
      } catch (error: any) {
        this.logger.error('JRADI01CE0001', error);
      }
      this.commandRouter.stateMachine.playQueue.saveQueue();
      this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
    }
    return libQ.resolve();
  }

  public getUIConfig(): Promise<any> {
    const defer = libQ.defer();

    this.logger.info('JRADI01CI0004', this.langCode);

    this.commandRouter.i18nJson(
      path.join(this.baseDir, 'i18n', `strings_${this.langCode}.json`),
      path.join(this.baseDir, 'i18n', 'strings_en.json'),
      path.join(this.baseDir, 'UIConfig.json')
    ).then((uiconf: any) => {
      // ネットワーク設定
      let sectionIdx = 0;
      const servicePort = this.config.get('servicePort');
      const networkDelay = this.config.get('networkDelay');
      if (uiconf.sections?.[sectionIdx]?.content?.[0]) uiconf.sections[sectionIdx].content[0].value = servicePort;
      if (uiconf.sections?.[sectionIdx]?.content?.[1]) uiconf.sections[sectionIdx].content[1].value = networkDelay;

      // ラジコプレミアムアカウント設定
      sectionIdx++;
      const radikoUser = this.config.get('radikoUser');
      const radikoPass = this.config.get('radikoPass');
      if (uiconf.sections?.[sectionIdx]?.content?.[0]) uiconf.sections[sectionIdx].content[0].value = radikoUser;
      if (uiconf.sections?.[sectionIdx]?.content?.[1]) uiconf.sections[sectionIdx].content[1].value = radikoPass;

      // アルバムアート設定
      sectionIdx++;
      const albumartType = this.config.get('albumartType');
      if (uiconf.sections?.[sectionIdx]?.content?.[0]) {

        const content = uiconf.sections[sectionIdx].content[0];
        content.value.value = albumartType;

        for (const opt of content.options) {
          if (opt.value === albumartType) {
            content.value.label = opt.label;
            break;
          }
        }
      }

      // タイムフリー設定
      sectionIdx++;
      const programPeriodFrom = this.config.get('programPeriodFrom');
      const programPeriodTo = this.config.get('programPeriodTo');
      const timeFormat = this.config.get('timeFormat');

      if (uiconf.sections?.[sectionIdx]?.content?.[0]) uiconf.sections[sectionIdx].content[0].value = programPeriodFrom;
      if (uiconf.sections?.[sectionIdx]?.content?.[1]) uiconf.sections[sectionIdx].content[1].value = programPeriodTo;
      if (uiconf.sections?.[sectionIdx]?.content?.[2]) {

        // 日時フォーマット例の設定
        const toDateOnly: DateOnly = broadcastTimeConverter.getCurrentDate();
        // サンプルで12時と13時のDateオブジェクトを作成
        const sample1DateTime: DateTime = createDateTime(toDateOnly.getFullYear(), toDateOnly.getMonth(), toDateOnly.getDate(), 12, 0, 0);
        const sample2DateTime: DateTime = createDateTime(toDateOnly.getFullYear(), toDateOnly.getMonth(), toDateOnly.getDate(), 13, 0, 0);

        const content = uiconf.sections[sectionIdx].content[2];
        content.value.value = timeFormat;

        for (const opt of content.options) {
          const formattedExample = broadcastTimeConverter.formatDateTimeRange(sample1DateTime, sample2DateTime, opt.value);
          opt.label = format(opt.label, formattedExample);

          if (opt.value === timeFormat) {
            content.value.label = opt.label;
          }

        }
      }

      // エリアフリー設定
      sectionIdx++;
      // TODO:RadikoMyInfoのmember_typeのtypeが'premium'の場合にエリア設定を表示すうように変更する必要あり
      if (radikoUser && radikoPass && uiconf.sections?.[sectionIdx]?.content && uiconf.sections?.[sectionIdx]?.hidden) {
        const radikoMyInfo: RadikoMyInfo = this.appRadio!.getMyInfo();
        const section = uiconf.sections[sectionIdx];
        section.hidden = false;


        Object.entries(RADIKO_AREA).forEach(([regionKey, regionObj]) => {
          const contents = new Array();

          // region label from constant (not messageHelper)
          contents.push({
            id: regionKey,
            label: regionObj.name, // ex: '≪ 関東 ≫'
          });

          Object.entries(regionObj.prefectures).forEach(([jpKey, jpName]) => {
            const areaId = jpKey;
            const areaName = jpName.kanji;
            const areaStations = this.appRadio?.getAreaStations(areaId);
            const value = this.config.get(`radikoAreas.${areaId}`);

            contents.push({
              id: areaId,
              element: 'switch',
              label: `- ${areaName}${radikoMyInfo.areaId === areaId ? this.commandRouter.getI18nString.get('UI_SETTINGS.RADIKO_MY_AREA') : ''
                }`,
              value,
              description: `${areaStations} / ${areaStations?.length}`.replace(/,/g, ', '),
            });

            section.saveButton.data.push(areaId);
          });

          contents.push({ label: '' }); // separator

          contents.forEach((c: any) => section.content.push(c));
        });
      }
      defer.resolve(uiconf);

    }).fail((error: any) => {
      this.logger.error('JRADI01CE0003', error);
      defer.reject(error);
    });

    return defer.promise;
  }

  public getConfigurationFiles(): string[] {
    return ['config.json'];
  }

  public saveNetworkSetting(data: { servicePort: string; networkDelay: string }): void {
    this.logger.info('JRADI01CI0008');
    if (this.config) {
      // 起動ポート
      const newPort: number = Number(data.servicePort || 9000);
      // 遅延(ディレイ)
      const newDelay: number = Number(data.networkDelay || 20);

      if (!isNaN(newPort) && this.config.get('servicePort') !== newPort
        || !isNaN(newDelay) && this.config.get('networkDelay') !== newDelay) {
        this.config.set('servicePort', newPort);
        this.config.set('networkDelay', newDelay);
        this.showRestartModal();
      }
    }
  }

  // Radikoアカウント保存
  public saveRadikoAccountSetting(data: { radikoUser: string; radikoPass: string }): void {
    this.logger.info('JRADI01CI0009');

    if (this.config !== undefined && this.config !== null) {

      const updatedFlag: boolean = ['radikoUser', 'radikoPass'].some((key) =>
        this.config!.get(key) !== (data as any)[key]
      );

      if (updatedFlag === true) {
        this.config.set('radikoUser', data.radikoUser);
        this.config.set('radikoPass', data.radikoPass);
        this.showRestartModal();
      }
    }
  }

  public saveAlbumartSetting(data: { albumartType: { value: string; label: string } }): void {
    this.logger.info('JRADI01CI0010');

    if (this.config !== undefined && this.config !== null) {
      if (this.config.get('albumartType') !== data.albumartType.value) {
        this.config.set('albumartType', data.albumartType.value);
        this.showRestartModal();
      }
    }
  }

  // ロゴのキャッシュクリア
  public clearStationLogoCache(): void {
    this.logger.info('JRADI01CI0011');

    exec(`/bin/rm -f ${__dirname}/assets/images/*_logo.png`, (error: any) => {
      if (error) {
        this.logger.error('JRADI01CE0004', error);
      } else {
        this.commandRouter.pushToastMessage('success', 'JP Radio', messageHelper.get('STATION_LOGO_CLEAR'));
      }
    });

  }

  // タイムフリー
  public saveTimeFreeSetting(data: { programPeriodFrom: string; programPeriodTo: string; timeFormat: { value: string; label: string } }): void {
    this.logger.info('JRADI01CI0012');

    if (this.config) {

      const newProgramPeriodFrom: number = Number(data.programPeriodFrom || 7);
      const newProgramPeriodTo: number = Number(data.programPeriodTo || 0);

      if (!isNaN(newProgramPeriodFrom) && this.config.get('programPeriodFrom') !== newProgramPeriodFrom
        || !isNaN(newProgramPeriodTo) && this.config.get('programPeriodTo') !== newProgramPeriodTo
        || this.config.get('timeFormat') !== data.timeFormat.value) {

        this.config.set('programPeriodFrom', data.programPeriodFrom);
        this.config.set('programPeriodTo', data.programPeriodTo);
        this.config.set('timeFormat', data.timeFormat.value);
        this.showRestartModal();
      }
    }
  }

  // ラジコのエリア保存
  public saveRadikoAreasSetting(data: any): void {
    this.logger.info('JRADI01CI0013');

    if (this.config) {
      let updated: boolean = false;

      for (const [key, value] of Object.entries(data)) {
        const areaId: string = `radikoAreas.${key}`;

        if (this.config.get(areaId) !== value) {
          updated = true;
          this.config.set(areaId, value);
        }
      }

      if (updated) {
        this.showRestartModal();
      }
    }
  }

  // 再起動
  public async restartPlugin(): Promise<void> {
    try {
      // 停止
      await this.onStop();
      // 開始
      await this.onStart();
    } catch (error: any) {
      this.logger.error('', error);
      this.commandRouter.pushToastMessage('error', messageHelper.get('RESTART_FAILED_TITLE'), messageHelper.get('RESTART_FAILED_MESSAGE'));
    }
  }

  private showRestartModal(): void {
    const message = {
      title: messageHelper.get('RESTART_MODAL_TITLE'),
      message: messageHelper.get('RESTART_MODAL_MESSAGE'),
      size: 'lg',
      buttons: [
        {
          name: this.commandRouter.getI18nString('COMMON.RESTART'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'restartPlugin',
            data: {}
          }
        },
        {
          name: this.commandRouter.getI18nString('COMMON.CANCEL'),
          class: 'btn btn-warning',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };
    this.commandRouter.broadcastMessage('openModal', message);
  }

  // Browse に Radiko のメニューを追加
  public addToBrowseSources(): void {
    this.logger.info('JRADI01CI0014', this.serviceName);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg'
    });
  }

  // Radikoを押下した際のメニューを追加
  public handleBrowseUri(curUri: string): Promise<any> {
    this.logger.info('JRADI01CI0015', curUri);

    const defer = libQ.defer();
    if (this.appRadio === undefined || this.appRadio === null) {
      this.logger.error('JRADI01CE0005');
      defer.resolve({});
      return defer.promise;
    }

    (async () => {
      try {
        if (!this.appRadio) {
          throw new Error('JpRadio service not initialized');
        }

        const [base, playMode, stationId, option] = curUri.split('/');

        if (base !== 'radiko') {
          throw new Error('Invalid URI base');
        }

        // メニュー表示（playMode なし）
        if (!playMode) {
          return {
            navigation: {
              lists: [{
                title: '',
                availableListViews: ['grid', 'list'],
                items: [
                  {
                    service: this.serviceName,
                    type: 'radio-category',
                    title: messageHelper.get('BROWSE_LABEL_LIVE'),
                    icon: 'fa fa-microphone',
                    uri: 'radiko/live'
                  },
                  {
                    service: this.serviceName,
                    type: 'radio-favourites',
                    title: messageHelper.get('BROWSE_LABEL_LIVE_FAVOURITES'),
                    icon: 'fa fa-heart',
                    uri: 'radiko/live/favourites'
                  },
                  {
                    service: this.serviceName,
                    type: 'radio-category',
                    title: messageHelper.get('BROWSE_LABEL_TIMEFREE'),
                    icon: 'fa fa-clock-o',
                    uri: 'radiko/timefree'
                  },
                  {
                    service: this.serviceName,
                    type: 'radio-category',
                    title: messageHelper.get('BROWSE_LABEL_TIMEFREE_TODAY'),
                    icon: 'fa fa-map-marker',
                    uri: 'radiko/timefree_today'
                  },
                  {
                    service: this.serviceName,
                    type: 'radio-favourites',
                    title: messageHelper.get('BROWSE_LABEL_TIMEFREE_FAVOURITES'),
                    icon: 'fa fa-heartbeat',
                    uri: 'radiko/timefree/favourites'
                  }
                ]
              }],
              prev: { uri: 'radiko' }
            }
          };
        }

        // Live / TimeFree
        if (playMode === 'live' || playMode === 'timefree' || playMode === 'timefree_today') {
          this.logger.info('TESTController0001', `${playMode}モード`);

          if (stationId === 'favourites') {
            return await this.appRadio.radioFavouriteStations(playMode);
          }
          return await this.appRadio.radioStations(playMode);
        }

        // TimeTable
        if (playMode === 'timetable' || playMode === 'timetable_today') {
          this.logger.info('TESTController0001', 'TimeTableモード');

          if (option !== undefined && option !== null && option !== '') {
            // uri = radiko/timetable/TBS/20251109~20251110
            const [fromStr, toStr]: string[] = option.split('~');

            // 8桁の数字でない場合はエラー
            if (!/^\d{8}$/.test(fromStr) || !/^\d{8}$/.test(toStr)) {
              throw new Error('Invalid date format');
            }

            // yyyyMMdd の string型 から DateOnly型 に変換
            const fromDateOnly: DateOnly = broadcastTimeConverter.parseDateToDateOnly(fromStr);
            const toDateOnly: DateOnly = broadcastTimeConverter.parseDateToDateOnly(toStr);

            return await this.appRadio.radioTimeTableDate(
              playMode,
              stationId,
              fromDateOnly,
              toDateOnly
            );
          }

          // 今日 or 設定期間
          let fromJstDateOnly: DateOnly = broadcastTimeConverter.getCurrentDate();
          let toJstDateOnly: DateOnly = broadcastTimeConverter.getCurrentDate();

          // 最後の文字列が '_today' でない場合は設定期間を適用
          if (playMode.endsWith('_today') === false) {
            fromJstDateOnly.setDate(fromJstDateOnly.getDate() - this.jpRadioConfig.ppFrom);
            toJstDateOnly.setDate(toJstDateOnly.getDate() + this.jpRadioConfig.ppTo);
          }

          return await this.appRadio.radioTimeTableDate(playMode, stationId, fromJstDateOnly, toJstDateOnly);
        }

        // ProgTable
        if (playMode === 'progtable') {
          const [fromStr, toStr]: string[] = option.split('~');

          // 8桁の数字でない場合はエラー
          if (!/^\d{8}$/.test(fromStr) || !/^\d{8}$/.test(toStr)) {
            throw new Error('Invalid date format');
          }

          // yyyyMMdd の string型 から DateOnly型 に変換
          const fromDateOnly: DateOnly = broadcastTimeConverter.parseDateToDateOnly(fromStr);
          const toDateOnly: DateOnly = broadcastTimeConverter.parseDateToDateOnly(toStr);

          return await this.appRadio.radioTimeTableDate(playMode, stationId, fromDateOnly, toDateOnly);
        }

        // ProgInfo
        if (playMode === 'proginfo') {
          const data = await this.explodeUri(curUri);
          await this.showProgInfoModal(data);
          return {};
        }

        throw new Error(`Unknown playMode: ${playMode}`);

      } catch (error: any) {
        this.logger.error('JRADI01CE0006', error);
        throw error;
      }
    })().then((result) => {
      defer.resolve(result);
    }).catch((error) => {
      defer.reject(error);
    });

    return defer.promise;
  }

  public clearAddPlayTrack(track: any): void {
    this.logger.info('JRADI01CI0016', track.uri);

    let uri: string = track.uri;
    // uri(Live)     = http://localhost:9000/radiko/play/TBS
    // uri(TimeFree) = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
    if (uri.includes('/radiko/play/') === true) {
      (async () => {
        // 再生中の曲を停止してキューをクリア
        await this.mpdPlugin.sendMpdCommand('stop', []); // 現在の曲を停止
        await this.mpdPlugin.sendMpdCommand('clear', []); // 再生キューをクリア

        const [liveUri, timefree]: string[] = uri.split('?'); // URIをライブとタイムフリーで分割

        if (timefree !== undefined && timefree !== null && timefree !== '') {
          // タイムフリーの場合
          const query = queryParse(timefree); // タイムフリーのクエリを解析

          // 現在のラジオ時間を取得
          const radiko1DayDate: DateTime = broadcastTimeConverter.getCurrentRadioTime();

          // タイムフリーのパラメータが不正な場合
          if (query.ft === undefined || query.to === undefined || query.ft === '' || query.to === ''
            || String(query.ft).length !== 14 || String(query.to).length !== 14) {
            // エラーログを出力
            this.logger.error('JRADI01CE0007', 'Invalid TimeFree parameters');
            // ライブ放送に切り替え
            uri = liveUri;
            // エラーメッセージを表示
            this.commandRouter.pushToastMessage('error', 'JP Radio', messageHelper.get('ERROR_INVALID_TIMEFREE_PARAMS'));
            // 処理を終了
            return;
          }

          // 開始時間(yyyyMMddHHmmss)のStringをDateTime型に変換
          const ftDate: DateTime = broadcastTimeConverter.parseStringToDateTime(String(query.ft));
          // 終了時間(yyyyMMddHHmmss)をDateTime型に変換
          const toDate: DateTime = broadcastTimeConverter.parseStringToDateTime(String(query.to));

          // プログラム時間をチェック
          const check: number = broadcastTimeConverter.checkProgramTime(ftDate, toDate, radiko1DayDate);

          if (check > 0) {
            // 配信前の番組は再生できないのでライブ放送に切り替え
            uri = liveUri; // ライブ放送に切り替え
            this.commandRouter.pushToastMessage('info', 'JP Radio', messageHelper.get('WARNING_SWITCH_LIVE1')); // 警告メッセージを表示
          } else if (check === 0) {
            // 追っかけ再生はうまくいかないのでライブ放送に切り替え
            uri = liveUri; // ライブ放送に切り替え
            this.commandRouter.pushToastMessage('info', 'JP Radio', messageHelper.get('WARNING_SWITCH_LIVE2')); // 警告メッセージを表示
          }
        } else {
          // タイムフリーがない場合はライブを再生

          // 現在の再生位置を取得
          const currentPosition = this.commandRouter.stateMachine.currentPosition;
          if (currentPosition > 0) {
            // 再生キューを並べ替えて対象局を先頭に
            let arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue; // 現在の再生キューを取得
            const arrayCurrentQueue = arrayQueue.splice(currentPosition); // 現在の位置以降のキューを取得
            arrayQueue = arrayCurrentQueue.concat(arrayQueue); // 並べ替えたキューを作成
            this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue; // 新しいキューを設定
            this.commandRouter.stateMachine.currentPosition = 0; // 再生位置を先頭に戻す
            this.commandRouter.volumioPushQueue(arrayQueue); // 新しいキューをプッシュ
          }
        }

        // 新しいURIをキューに追加
        await this.mpdPlugin.sendMpdCommand(`add "${uri}"`, []);
        // MPDサービスを更新
        this.commandRouter.stateMachine.setConsumeUpdateService('mpd');
        // 再生を開始
        await this.mpdPlugin.sendMpdCommand('play', []);
      })();
    }
  }

  // URI を展開して再生情報を作成
  public explodeUri(uri: string): Promise<any> {
    this.logger.info('TESTController0001', 'explodeUri');

    const defer = libQ.defer();

    try {
      const [liveUri, tt, pf, sn, aa, ft, to, seek]: string[] = uri.split(/[?&]/);

      if (!liveUri.startsWith('radiko/play/') && !liveUri.startsWith('radiko/proginfo/')) {
        throw new Error('Invalid URI');
      }

      // 再生画面に表示する情報
      const response = {
        service: this.serviceName,
        type: 'track',
        name: decodeURIComponent(tt),
        album: decodeURIComponent(pf),
        artist: decodeURIComponent(sn),
        albumart: decodeURIComponent(aa),
        uri: `http://localhost:${this.jpRadioConfig.port}/${liveUri}`
      };

      if (ft !== undefined && ft !== null && ft !== '' && to !== undefined && to !== null && to !== '') {
        // DateTime型に変換
        const ftDate: DateTime = broadcastTimeConverter.parseStringToDateTime(ft);
        const toDate: DateTime = broadcastTimeConverter.parseStringToDateTime(to);

        // 開始日時・終了日時をyyyyMMddHHmmss文字列に変換
        const ftDateStr = broadcastTimeConverter.parseDateTimeToStringDateTime(ftDate);
        const toDateStr = broadcastTimeConverter.parseDateTimeToStringDateTime(toDate);
        // シーク位置
        const seekNumber: number = seek ? Number(seek) : 0;

        // タイムフリー
        response.artist += broadcastTimeConverter.formatDateTime(ftDate, ` @${this.jpRadioConfig.dateFmt}`);
        response.uri += `?ft=${ftDateStr}&to=${toDateStr}` + (seekNumber ? `&seek=${seekNumber}` : '');
      }

      defer.resolve(response);
    } catch (error: any) {
      defer.reject(error);
    }

    return defer.promise;
  }

  public addToFavourites(data: any): Promise<any> {
    return this.explodeUri(data.uri).then((item) => {
      this.logger.info('JRADI01CI0018', item);
      const [liveUri, timefree]: string[] = item.uri.split('?');

      if (!timefree) {
        const stationId = liveUri.split('/').pop();
        item.name = `${stationId} (Live)`;
        item.albumart = '';
      }

      return this.commandRouter.playListManager.commonAddToPlaylist(
        this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites',
        'webradio', item.uri, item.name, item.albumart);
    });
  }

  public removeFromFavourites(data: any): Promise<any> {
    return this.explodeUri(data.uri).then((item) => {

      this.logger.info('JRADI01CI0019', item);

      return this.commandRouter.playListManager.commonRemoveFromPlaylist(
        this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites', 'webradio', item.uri);
    });
  }

  public seek(timepos: number): Promise<any> {
    this.logger.info('JRADI01CI0020', timepos);

    const defer = libQ.defer();

    this.mpdPlugin.sendMpdCommand('currentsong', []).then((data: any) => {
      // uri(TimeFree) = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
      let uri: string = data.file;
      if (uri.includes('/radiko/play/') === true) {
        const [_, timefree] = uri.split('?');
        if (timefree) {
          // タイムフリー：シーク情報を付加したURIに切り替え
          uri = uri.replace(/&seek=\d+/, '') + `&seek=${Math.round(timepos / 1000)}`; // sec
          return this.mpdPlugin.sendMpdCommand(`add "${uri}"`, [])
            .then(() => {
              return this.mpdPlugin.sendMpdCommand('delete 0', []);
            });
        } else {
          // ライブ：無視，タイムバーを元に戻す
          this.appRadio!.pushSongState(true);
          defer.reject();
        }
      } else {
        defer.reject();
      }
    });
    return defer.promise;
    //return this.mpdPlugin.seek(timepos);
  }

  public stop(): void {
    this.logger.info('JRADI01CI0021');
    return this.mpdPlugin.sendMpdCommand('stop', []);
  }

  public pause(): void {
    this.logger.info('JRADI01CI0022');
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  public getState(): void {
    this.logger.info('JRADI01CI0023');
  }

  public parseState(sState: any): void {
    this.logger.info('JRADI01CI0024', sState);
  }

  public pushState(state: any): any {
    this.logger.info('JRADI01CI0025', state);
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  public search(query: ParsedQs): Promise<any> {
    this.logger.info('JRADI01CI0026', query);
    return libQ.resolve();
  }

  // 再生画面の'...' => 'アーティストへ移動' or 'アルバムへ移動'
  public goto(data: any): Promise<any> {
    this.logger.info('JRADI01CI0027', data);

    const defer = libQ.defer();

    (async () => {
      try {
        // uri = http://localhost:9000/radiko/play/TBS?ft=##&to=##
        if (data.uri.includes('/radiko/play/') === false) {
          return new Error('Invalid URI');
        }

        const [liveUri, timefree] = data.uri.split('?');
        const stationId = liveUri.replace(/\/+$/, '').split('/').pop() ?? '';

        // 日付範囲を計算
        let fromDateOnly: DateOnly = broadcastTimeConverter.getCurrentDate();
        let toDateOnly: DateOnly = broadcastTimeConverter.getCurrentDate();

        if (timefree !== undefined && timefree !== null && timefree !== '') {
          const query: ParsedUrlQuery = queryParse(timefree);

          if (query.ft) {
            // ft から DateOnly に変換
            fromDateOnly = broadcastTimeConverter.parseDateToDateOnly(String(query.ft));
            toDateOnly = fromDateOnly;
          }
        }

        if (data.type === 'artist') {
          // 'アーティストへ移動' ⇒ 番組情報 & 番組表
          await this.showProgInfoModal(data);
          return await this.appRadio!.radioTimeTableDate('progtable', stationId, fromDateOnly, toDateOnly);
        }

        if (data.type === 'album') {
          // 'アルバムへ移動' ⇒ 番組表
          return await this.appRadio!.radioTimeTableDate('progtable', stationId, fromDateOnly, toDateOnly);
        }

        return {};
      } catch (error: any) {
        this.logger.error('JRADI01CE0010', error);
        throw error;
      }
    })().then((result: any) => {
      defer.resolve(result);
    }).catch((error) => {
      defer.reject(error);
    });

    return defer.promise;
  }

  public async showProgInfoModal(data: any): Promise<void> {
    this.logger.info('JRADI01CI0028', data);
    const prg = this.appRadio?.getPrg();

    if (!prg) {
      return;
    }

    // uri = http://localhost:9000/radiko/play/TBS?ft=##&to=##
    const [liveUri, timefree]: string = data.uri.split('?');
    const stationId = liveUri.split('/').pop();

    if ((liveUri.includes('/radiko/play/') === true || liveUri.includes('/radiko/proginfo/') === true) && (stationId !== undefined && stationId !== null)) {
      let ftDateTime: DateTime = broadcastTimeConverter.getCurrentRadioTime();
      let toDateTime: DateTime = ftDateTime;

      if (timefree) {
        const query = queryParse(timefree);

        // 開始時間
        if (query.ft !== undefined && query.ft !== null && query.ft !== '') {
          ftDateTime = broadcastTimeConverter.parseStringToDateTime(String(query.ft));

        }

        // 終了時間
        if (query.to !== undefined && query.to !== null && query.to !== '') {
          toDateTime = broadcastTimeConverter.parseStringToDateTime(String(query.to));
        }
      }

      const progData = await prg.getProgramData(stationId, ftDateTime, true);

      if (!progData) {
        return;
      }

      const pfm = progData.pfm ? messageHelper.get('PROGINFO.PERFORMER') + progData.pfm : '<br/>';
      data.uri = data.uri.replace(/\/proginfo\//, '/play/');
      const modalMessage = {
        title: messageHelper.get('PROGINFO_PROG_INFO') + progData.title,
        //message: `<div>${data.artist}</div><div>${pfm}</div>${progData.info}<div style="text-align:right">${data.uri}</div>`,
        message: `<div>${data.artist}</div><div>${pfm}</div>${progData.info}<div align="right">${data.uri}</div>`,
        size: 'lg',
        buttons: [
          {
            name: messageHelper.get('PROGINFO_PLAY'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: {
              endpoint: `music_service/${this.serviceName}`,
              method: 'play_formProgInfoModal',
              data: data
            }
          },
          {
            name: messageHelper.get('PROGINFO_ADD_TO_QUEUE'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: {
              endpoint: `music_service/${this.serviceName}`,
              method: 'addQueue_formProgInfoModal',
              data: data
            }
          },
          {
            name: messageHelper.get('PROGINFO_ADD_TO_FAVOURITES'),
            class: 'btn btn-info',
            emit: 'callMethod',
            payload: {
              endpoint: `music_service/${this.serviceName}`,
              method: 'addFavourites_formProgInfoModal',
              data: data
            }
          },
          {
            name: this.commandRouter.messageHelper.get('COMMON.CLOSE'),
            class: 'btn btn-warning',
            emit: 'closeModals',
            payload: ''
          }
        ]
      };

      const diffSec = (broadcastTimeConverter.getCurrentRadioTime().getTime() - ftDateTime.getTime()) / 1000;
      if (diffSec < -7 * 86400) {
        //「再生/キューに追加/お気に入りに追加」ボタンを消す
        modalMessage.buttons.splice(0, 3);
      } else {
        const diff = broadcastTimeConverter.checkProgramTime(ftDateTime, toDateTime, broadcastTimeConverter.getCurrentRadioTime());
        if (diff >= 0) {
          //「再生/キューに追加」ボタンを消す（追っかけ再生や未配信は追加も不可）
          modalMessage.buttons.splice(0, 2);
        }
      }

      this.commandRouter.broadcastMessage('openModal', modalMessage);
    }
  }

  public play_formProgInfoModal(data: any): void {
    this.logger.info('JRADI01CI0029', data);
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.unshift(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.volumioPushQueue(arrayQueue);
    this.commandRouter.volumioPlay(0);
  }

  public addQueue_formProgInfoModal(data: any): void {
    this.logger.info('JRADI01CI0030', data);
    this.commandRouter.pushToastMessage('success', this.commandRouter.messageHelper.get('COMMON.ADD_QUEUE_TITLE'),
      this.commandRouter.messageHelper.get('COMMON.ADD_QUEUE_TEXT_1') + data.name + this.commandRouter.messageHelper.get('COMMON.ADD_QUEUE_TEXT_2'));
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.push(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.stateMachine.playQueue.saveQueue();
    this.commandRouter.volumioPushQueue(arrayQueue);
  }

  public addFavourites_formProgInfoModal(data: any): void {
    this.logger.info('JRADI01CI0031', data);
    this.commandRouter.pushToastMessage('success', this.commandRouter.messageHelper.get('PLAYLIST.ADDED_TITLE'),
      data.name + this.commandRouter.messageHelper.get('PLAYLIST.ADDED_TO_FAVOURITES'));
    this.commandRouter.playListManager.commonAddToPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites',
      'webradio', data.uri, data.name, data.albumart);
  }
}
