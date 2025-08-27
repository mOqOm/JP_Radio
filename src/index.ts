"use strict";
import libQ from 'kew';
import VConf from 'v-conf';
import { format } from 'util';
import { parse as queryParse } from 'querystring';
import JpRadio from './lib/radio';
import type { LoginAccount } from './lib/models/AuthModel';
import { loadI18nStrings, getI18nString, getI18nStringFormat } from './lib/i18nStrings';
import { AreaNames } from './lib/consts/areaName';
import { RadioTime } from './lib/radioTime';

export = ControllerJpRadio;

class ControllerJpRadio {
  private readonly context: any;
  private readonly commandRouter: any;
  private readonly logger: Console;
  private readonly configManager: any;
  private config: InstanceType<typeof VConf> | null = null;
  private confParam: { port: number, delay: number, aaType: string, ppFrom: number, ppTo: number, timeFmt: string, dateFmt: string, areaIds: string[] };
  private readonly serviceName = 'jp_radio';
  private appRadio: JpRadio | null = null;
  private mpdPlugin: any;

  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
  }

//-----------------------------------------------------------------------

  public onVolumioStart(): Promise<void> {
    this.logger.info(`JP_Radio::onVolumioStart`);
    const defer = libQ.defer();
    try {
      const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
      this.config = new VConf();
      this.config.loadFile(configFile);
      defer.resolve();
    } catch (error) {
      defer.reject(error);
    }
    return defer.promise;
  }

  public onVolumioShutdown(): Promise<void> {
    this.logger.info(`JP_Radio::onVolumioShutdown`);
    const defer = libQ.defer();
    this.onStop().then(() => defer.resolve() );
    return defer.promise;
}

  public onVolumioReboot(): Promise<void> {
    this.logger.info(`JP_Radio::onVolumioReboot`);
    const defer = libQ.defer();
    this.onStop().then(() => defer.resolve() );
    return defer.promise;
  }

  public onStart(): Promise<void> {
    this.logger.info('JP_Radio::onStart: start...');
    const startTime = Date.now();
    const defer = libQ.defer();

    if (!this.config) {
      this.logger.error('Config not initialized onStart');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }
    loadI18nStrings(__dirname, this.commandRouter.sharedVars.get('language_code'));

    this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    const radikoUser = this.config.get('radikoUser');
    const radikoPass = this.config.get('radikoPass');
    const account: LoginAccount | null = (radikoUser && radikoPass) ? { mail: radikoUser, pass: radikoPass } : null;

    var areaIds = [];
    for (const areaId of Array.from({ length: 47 }, (_, i) => `JP${i + 1}`)) {
      if (this.config.get(`radikoAreas.${areaId}`) ?? false) {
        areaIds.push(areaId);
      }
    }
    const timeFormat = this.config.get('timeFormat') ?? '$1/$2/$3 $4:$5-$10:$11';
    this.confParam = {
      port   : this.config.get('servicePort') ?? 9000,
      delay  : this.config.get('networkDelay') ?? 20,
      aaType : this.config.get('albumartType') ?? 'type3',
      ppFrom : this.config.get('programPeriodFrom') ?? 7,
      ppTo   : this.config.get('programPeriodTo') ?? 0,
      timeFmt: timeFormat,
      dateFmt: timeFormat.replace(/\s.+$/, ''),
      areaIds: areaIds
    };

    this.appRadio = new JpRadio(account, this.confParam, this.logger, this.commandRouter, this.serviceName);
    this.appRadio.start()
      .then(() => {
        this.addToBrowseSources();
        const endTime = Date.now();
        const processingTime = endTime - startTime;
        this.logger.info(`JP_Radio::onStart: ## COMPLETED ${processingTime}ms ##`);
        defer.resolve();
      })
      .catch((err) => {
        this.logger.error('JP_Radio::Failed to start appRadio', err);
        if (err.code === 'EADDRINUSE') {
          const message = getI18nStringFormat('MESSAGE.ERROR_PORT_IN_USE', this.confParam.port);
          this.logger.error(`JP_Radio:: Port is already in use : ${message}`);
          this.commandRouter.pushToastMessage('error', getI18nString('MESSAGE.ERROR_BOOT_FAILED'), message);
        } else {
          this.logger.error('JP_Radio::Failed to start appRadio', err);
          this.commandRouter.pushToastMessage('error', getI18nString('MESSAGE.ERROR_BOOT_FAILED'), err.message || getI18nString('MESSAGE.ERROR_UNKNOWN'));
        }
        defer.reject(err);
      });
    return defer.promise;
  }

  public async onStop(): Promise<void> {
    // この関数，終了時に自動コールされないんだけど何で？
    this.logger.info(`JP_Radio::onStop:`);
    if (this.appRadio) {
      try {
        await this.appRadio.stop();
        this.appRadio = null;
      } catch (err) {
        this.logger.error('JP_Radio::Error stopping appRadio', err);
      }
      this.commandRouter.stateMachine.playQueue.saveQueue();
      this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
    }
    return libQ.resolve();
  }

//-----------------------------------------------------------------------

  public getUIConfig(): Promise<any> {
    this.logger.info(`JP_Radio::getUIConfig:`);
    const defer = libQ.defer();
    const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';

    this.commandRouter.i18nJson(
      `${__dirname}/i18n/strings_${langCode}.json`,
      `${__dirname}/i18n/strings_en.json`,
      `${__dirname}/UIConfig.json`
    )
    .then((uiconf: any) => {
      // ネットワーク設定
      var sectionIdx = 0;
      const servicePort = this.config.get('servicePort');
      const networkDelay= this.config.get('networkDelay');
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
      const albumartType= this.config.get('albumartType');
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
      const programPeriodTo   = this.config.get('programPeriodTo');
      const timeFormat        = this.config.get('timeFormat');
      if (uiconf.sections?.[sectionIdx]?.content?.[0]) uiconf.sections[sectionIdx].content[0].value = programPeriodFrom;
      if (uiconf.sections?.[sectionIdx]?.content?.[1]) uiconf.sections[sectionIdx].content[1].value = programPeriodTo;
      if (uiconf.sections?.[sectionIdx]?.content?.[2]) {
        const today = RadioTime.getCurrentDate();
        const content = uiconf.sections[sectionIdx].content[2];
        content.value.value = timeFormat;
        for (const opt of content.options) {
          opt.label = format(opt.label, RadioTime.formatFullString2([today+'120000', today+'130000'], opt.value));
          if (opt.value === timeFormat)
            content.value.label = opt.label;
        }
      }

      // エリアフリー設定
      sectionIdx++;
      if (radikoUser && radikoPass && uiconf.sections?.[sectionIdx]?.content && uiconf.sections?.[sectionIdx]?.hidden) {
        const myInfo = this.appRadio!.getMyInfo();
        const section = uiconf.sections[sectionIdx];
        section.hidden = false;
        AreaNames.forEach((item) => {
          const contents = new Array();
        //const onAreas = new Array();
          const regionId = item.region.split('.').pop();  // 'RADIKO_AREA.REGION2'
          contents.push({
            id   : regionId,  // 'REGION2'
            label: getI18nString(item.region), // '関東'
          }); // contents[0]
          item.areas.forEach((radikoArea) => {
            const areaId = radikoArea.split('.').pop(); // 'RADIKO_AREA.JP13'
            const areaName = getI18nString(radikoArea); // '≪ 関東 ≫'
            const areaStations = this.appRadio?.getAreaStations(areaId!); // TBS,QRR,LFR,INT,FMT,...,JOAK
            const value = this.config.get(`radikoAreas.${areaId}`);
            contents.push({
              id         : areaId,  // 'JP13'
              element    : 'switch',
              label      : `- ${areaName}${(myInfo.areaId == areaId) ? getI18nString('UI_SETTINGS.RADIKO_MY_AREA') : ''}`,
              value      : value,
              description: `${areaStations} / ${areaStations?.length}`.replace(/,/g, ', '),
            }); // contents[1-]
            section.saveButton.data.push(areaId);
          }); // item.areas.forEach
          contents.push({ label: '' });  // separator
          contents.forEach((item: any) => { section.content.push(item) });
        }); // AreaNames.forEach
      }
      defer.resolve(uiconf);

    })
    .fail((error: any) => {
      this.logger.error('getUIConfig failed:', error);
      defer.reject(error);
    });

    return defer.promise;
  }

  public getConfigurationFiles(): string[] {
    return ['config.json'];
  }

  public async saveNetworkSetting(data: { servicePort: string; networkDelay: string }): Promise<void> {
    this.logger.info(`JP_Radio::saveNetworkSetting`);
    if (this.config) {
      const newPort = Number(data.servicePort || 9000);
      const newDelay = Number(data.networkDelay || 20);
      if (!isNaN(newPort) && this.config.get('servicePort') !== newPort
      || !isNaN(newDelay) && this.config.get('networkDelay') !== newDelay) {
        this.config.set('servicePort', newPort);
        this.config.set('networkDelay', newDelay);
        this.showRestartModal();
      }
    }
  }

  public async saveRadikoAccountSetting(data: { radikoUser: string; radikoPass: string }): Promise<void> {
    this.logger.info(`JP_Radio::saveRadikoAccount`);
    if (this.config) {
      const updated = ['radikoUser', 'radikoPass'].some(
        (key) => this.config!.get(key) !== (data as any)[key]
      );
      if (updated) {
        this.config.set('radikoUser', data.radikoUser);
        this.config.set('radikoPass', data.radikoPass);
        this.showRestartModal();
      }
    }
  }

  public async saveAlbumartSetting(data: { albumartType: { value: string; label: string } }): Promise<void> {
    this.logger.info(`JP_Radio::saveAlbumartSetting`);
    if (this.config) {
      if (this.config.get('albumartType') !== data.albumartType.value) {
        this.config.set('albumartType', data.albumartType.value);
        this.showRestartModal();
      }
    }
  }

  public async saveTimeFreeSetting(data: { programPeriodFrom: string; programPeriodTo: string; timeFormat: { value: string; label: string }}): Promise<void> {
    this.logger.info('JP_Radio::saveTimeFreeSetting');
    if (this.config) {
      const newProgramPeriodFrom = Number(data.programPeriodFrom || 7);
      const newProgramPeriodTo = Number(data.programPeriodTo || 0);
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

  public async saveRadikoAreasSetting(data: any): Promise<void> {
    this.logger.info(`JP_Radio::saveRadikoAreasSetting`);
    if (this.config) {
      var updated = false;
      for (const [key, value] of Object.entries(data)) {
        const areaId = `radikoAreas.${key}`;
        if (this.config.get(areaId) !== value) {
          updated = true;
          this.config.set(areaId, value);
        }
      }
      if (updated) this.showRestartModal();
    }
  }

  public async restartPlugin(): Promise<void> {
    try {
      await this.onStop();
      await this.onStart();
    } catch {
      this.commandRouter.pushToastMessage('error', getI18nString('MESSAGE.RESTART_FAILED_TITLE'), getI18nString('MESSAGE.RESTART_FAILED_MESSAGE'));
    }
  }

  private showRestartModal(): void {
    const message = {
      title: getI18nString('MESSAGE.RESTART_MODAL_TITLE'),
      message: getI18nString('MESSAGE.RESTART_MODAL_MESSAGE'),
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

//-----------------------------------------------------------------------

  public addToBrowseSources(): void {
    this.logger.info(`JP_Radio::addToBrowseSources: pluginName=${this.serviceName}`);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/dist/assets/images/app_radiko.svg'
    });
  }

  public handleBrowseUri(curUri: string): Promise<any> {
    this.logger.info(`JP_Radio::handleBrowseUri: curUri=${curUri}`);
    const defer = libQ.defer();
    if (!this.appRadio) {
      this.logger.error('[JP_Radio] handleBrowseUri !this.appRadio');
      defer.resolve({});
      return defer.promise;
    }

    const [base, mode, stationId] = curUri.split('/');
    if (base == 'radiko') {
      if (!mode) {
        // uri = radiko
        defer.resolve( this.rootMenu() );

      } else if (mode.startsWith('live')) {
        // uri = radiko/live or radiko/live/favourites
        libQ.resolve()
          .then(() => (stationId == 'favourites')
                    ? this.appRadio!.radioFavouriteStations(mode)
                    : this.appRadio!.radioStations(mode) )
          .then((result: any) => defer.resolve(result) )
          .fail((err: any) => {
            this.logger.error('[JP_Radio] handleBrowseUri error: ' + err);
            defer.reject(err);
          });

      } else if (mode.startsWith('timefree')) {
        // uri = radiko/timefree or radiko/timefree_today or radiko/timefree/favourites
        defer.resolve( (stationId == 'favourites')
                     ? this.appRadio.radioFavouriteStations(mode)
                     : this.appRadio.radioStations(mode) );

      } else if (mode.startsWith('timetable')) {
        // uri = radiko/timetable/TBS or radiko/timetable_today/TBS
        const today = mode.endsWith('today');
        const from = today ? 0 : this.confParam.ppFrom;
        const to   = today ? 0 : this.confParam.ppTo;
        libQ.resolve()
          .then(() => this.appRadio!.radioTimeTable(`${mode}/-${from}~${to}/${stationId}`))
          .then((result: any) => defer.resolve(result) )
          .fail((err: any) => {
            this.logger.error('[JP_Radio] handleBrowseUri error: ' + err);
            defer.reject(err);
          });
      }

    } else { // base != 'radiko'
      this.logger.error('[JP_Radio] handleBrowseUri else');
      defer.resolve({});
    }
    return defer.promise;
  }

  private rootMenu(): any {
    return {
      navigation: {
        lists: [{
          title: '',
          availableListViews: ['grid', 'list'],
          items: [
            {
              service: this.serviceName,
              type   : 'radio-category',
              title  : getI18nString('BROWSER.LIVE'),
              icon   : 'fa fa-microphone',
              uri    : 'radiko/live'
            },
          /*{ TODO: ライブ（お気に入り）
              service: this.serviceName,
              type   : 'radio-favourites',
              title  : getI18nString('BROWSER.LIVE_FAVOURITES'),
              icon   : 'fa fa-heart',
              uri    : 'radiko/live/favourites'
            },*/
            {
              service: this.serviceName,
              type   : 'radio-category',
              title  : getI18nString('BROWSER.TIMEFREE'),
              icon   : 'fa fa-clock-o',
              uri    : 'radiko/timefree'
            },
            {
              service: this.serviceName,
              type   : 'radio-category',
              title  : getI18nString('BROWSER.TIMEFREE_TODAY'),
              icon   : 'fa fa-clock-o',
              uri    : 'radiko/timefree_today'
            },
          /*{ TODO: タイムフリー（お気に入り）
              service: this.serviceName,
              type   : 'radio-favourites',
              title  : getI18nString('BROWSER.TIMEFREE_FAVOURITES'),
              icon   : 'fa fa-heartbeat',
              uri    : 'radiko/timefree/favourites'
            }*/
          ]
        }],
        prev: {
          uri: 'radiko'
        }
      }
    }
  }

  public clearAddPlayTrack(track: any): Promise<any> {
    this.logger.info(`JP_Radio::clearAddPlayTrack: uri=${track.uri}`);
    const defer = libQ.defer();
    var uri = track.uri;
    // uri(Live)     = http://localhost:9000/radiko/play/TBS
    // uri(TimeFree) = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
    if (uri.includes('/radiko/play/')) {
      return this.mpdPlugin.sendMpdCommand('stop', [])
        .then(() => {
          return this.mpdPlugin.sendMpdCommand('clear', []);
        })
        .then(() => {
          const [liveUri, timefree] = uri.split('?');
          if (timefree) {
            // タイムフリー
            const query = queryParse(timefree);
            const currentTime = RadioTime.getCurrentRadioTime();
            const ft = query.ft ? String(query.ft) : currentTime;
            const to = query.to ? String(query.to) : currentTime;
            const check = RadioTime.checkProgramTime(ft, to, currentTime);
            if (check > 0) {
              // 配信前の番組は再生できないのでライブ放送に切り替え
              uri = liveUri;
              this.commandRouter.pushToastMessage('info', 'JP Radio', getI18nString('MESSAGE.WARNING_SWITCH_LIVE1'));
            } else if (check == 0) {
              // 追っかけ再生はうまくいかないのでライブ放送に切り替え（追っかけ再生は途中で切れる）
              uri = liveUri;
              this.commandRouter.pushToastMessage('info', 'JP Radio', getI18nString('MESSAGE.WARNING_SWITCH_LIVE2'));
            }
          } else {
            // ライブ
            const currentPosition = this.commandRouter.stateMachine.currentPosition;
            if (currentPosition > 0) {
              // 再生キューを並べ替えて対象局を先頭に
              var arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
              const arrayCurrentQueue = arrayQueue.splice(currentPosition);
              arrayQueue = arrayCurrentQueue.concat(arrayQueue);
              this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
              //this.commandRouter.stateMachine.playQueue.saveQueue();
              this.commandRouter.stateMachine.currentPosition = 0;
              this.commandRouter.volumioPushQueue(arrayQueue);
            }
          }
          return this.mpdPlugin.sendMpdCommand(`add "${uri}"`, []);
        })
        .then(() => {
          this.commandRouter.stateMachine.setConsumeUpdateService('mpd');
          return this.mpdPlugin.sendMpdCommand('play', []);
        });
    }
    return defer.promise;
  }

  public explodeUri(uri: string): Promise<any> {
    this.logger.info(`JP_Radio::explodeUri: uri=${uri}`);
    var defer = libQ.defer();
    // uri(Live)     = radiko/play/TBS?tt&pf&sn&aa
    // uri(TimeFree) = radiko/play/TBS?tt&pf&sn&aa&ft&to&sk
    const [liveUri, tt, pf, sn, aa, ft, to, sk] = uri.split(/[?&]/);
    if (liveUri.startsWith('radiko/play/')) {
      // 再生画面に表示する情報
      const response = {
        service : this.serviceName,  // clearAddPlayTrackを呼び出す先のサービス名
        type    : 'track',
        name    : decodeURIComponent(tt), // title
        album   : decodeURIComponent(pf), // performer
        artist  : decodeURIComponent(sn), // stationName / time
        albumart: decodeURIComponent(aa), // albumart
        uri     : `http://localhost:${this.confParam.port}/${liveUri}`
      };
      if (ft && to) {
        // タイムフリー
        response.artist += RadioTime.formatDateString(ft, ` @${this.confParam.dateFmt}`);
        response.uri += `?ft=${ft}&to=${to}` + (sk ? `&seek=${sk}` : '');
      }
      //this.logger.info(`JP_Radio::explodeUri: response.uri=${response.uri}`);
      defer.resolve(response);

    } else {
      defer.resolve();
    }
    return defer.promise;
  }

//-----------------------------------------------------------------------

  public seek(timepos: number): Promise<any> {
    this.logger.info(`JP_Radio::seek to ${timepos}`);
    const defer = libQ.defer();
    this.mpdPlugin.sendMpdCommand('currentsong', [])
    .then((song: any) => {
      // uri(TimeFree) = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
      var uri = song.file;
      if (uri.includes('/radiko/play/')) {
        const [_, timefree] = uri.split('?');
        if (timefree) {
          // タイムフリー：シーク情報を付加したURIに切り替え
          uri = uri.replace(/&seek=\d+/, '') + `&seek=${Math.round(timepos/1000)}`; // sec
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
    this.logger.info(`JP_Radio::stop`);
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  public pause(): void {
    this.logger.info(`JP_Radio::pause`);
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  public getState(): void {
    this.logger.info(`JP_Radio::getState`);
  }

  public parseState(sState: any): void {
    this.logger.info(`JP_Radio::parseState: ${Object.entries(sState)}`);
  }

  public pushState(state: any): any {
    this.logger.info(`JP_Radio::pushState: ${Object.entries(state)}`);
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  public search(query: any): Promise<any> {
    this.logger.info(`JP_Radio::search: ${Object.entries(query)}`);
    return libQ.resolve();
  }

  public goto(data: any): Promise<any> {
    this.logger.info(`JP_Radio::goto: ${Object.entries(data)}`);
    return libQ.resolve();
  }
}