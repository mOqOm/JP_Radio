import libQ from 'kew';
import VConf from 'v-conf';
import { exec } from 'child_process';
import { format } from 'util';
import { parse as queryParse } from 'querystring';
// 定数のインポート
import { AreaNames } from '../constants/area-name.constants';
// Modelのインポート
import type { LoginAccount } from '../models/auth.model';
import type { BrowseResult } from '../models/browse-result.model';
// Utilsのインポート
import { LoggerEx } from '../utils/logger';
import { messageHelper } from '../utils/message-helper';
//import { RadioTime } from '../service/radio-time';
import { broadcastTimeConverter } from '../utils/broadcast-time-converter';
// Seviceのインポート
import JpRadio from '../service/radio';

export = JpRadioController;

class JpRadioController {
  private readonly context: any;
  private readonly commandRouter: any;
  private readonly logger: LoggerEx;
  private readonly configManager: any;
  private config: InstanceType<typeof VConf> | null = null;
  private confParam: { port: number, delay: number, aaType: string, ppFrom: number, ppTo: number, timeFmt: string, dateFmt: string, areaIds: string[] };
  // サービス名(プラグイン呼び出しのuriに含まれる文字でもある)
  private readonly serviceName = 'jp_radio';
  private appRadio: JpRadio | null = null;
  private mpdPlugin: any;
  // 言語のコード('ja','en'等)
  private readonly langCode: string;

  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.configManager = context.configManager;

    // LoggerEx 初期化（Volumio標準loggerをラップ）
    this.logger = new LoggerEx(context.logger, this.serviceName);

    // Volumio の sharedVars から言語コード取得
    //const lang = this.commandRouter.sharedVars.get('language_code') || 'ja';

    this.langCode = 'ja';

    // 共通 messageHelper に言語を設定
    messageHelper.setLanguage(this.langCode);

    // LoggerEx 内でも messageHelper を参照できるように設定
    // （LoggerEx 内のログ出力で i18n 文字列が使える）
    this.logger.setLanguage(this.langCode);

    // journalctl / livelog に debug も表示させる
    this.logger.enableForceDebug(true);
  }

//-----------------------------------------------------------------------

  public onVolumioStart(): Promise<void> {
    this.logger.debug('CTRLD0001');

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
    this.logger.debug('CTRLD0002');

    const defer = libQ.defer();
    this.onStop().then(() => defer.resolve() );
    return defer.promise;
  }

  public onVolumioReboot(): Promise<void> {
    this.logger.debug('CTRLD0003');
    
    const defer = libQ.defer();
    this.onStop().then(() => defer.resolve() );
    return defer.promise;
  }

  public onStart(): Promise<void> {
    this.logger.debug('CTRLD0005');
    const startTime = Date.now();
    const defer = libQ.defer();

    if (!this.config) {
      this.logger.error('CTRLE0002');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }

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

    this.appRadio = new JpRadio(account, this.confParam, this.logger, this.commandRouter, this.serviceName, messageHelper);
    this.appRadio.start()
      .then(() => {
        this.addToBrowseSources();
        const endTime = Date.now();
        const processingTime = endTime - startTime;
        this.logger.debug('CTRLD0006', processingTime);
        defer.resolve();
      })
      .catch((error) => {
        // ログ出力（stack も自動的に表示される）
        this.logger.error('CTRLE0001', { error: error });

        if (error.code === 'EADDRINUSE') {
          const message = messageHelper.get('MESSAGE.ERROR_PORT_IN_USE', this.confParam.port);
          this.logger.error('CTRLE0002', { message });
          this.commandRouter.pushToastMessage(
            'error',
            messageHelper.get('MESSAGE.ERROR_BOOT_FAILED'),
            message
          );
        } else {
          this.commandRouter.pushToastMessage(
            'error',
            messageHelper.get('MESSAGE.ERROR_BOOT_FAILED'),
            error.message || messageHelper.get('MESSAGE.ERROR_UNKNOWN')
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
    this.logger.debug('CTRLD0007');
    if (this.appRadio) {
      try {
        await this.appRadio.stop();
        this.appRadio = null;
      } catch (error: any) {
        this.logger.error('CTRLE0001', { error: error });
      }
      this.commandRouter.stateMachine.playQueue.saveQueue();
      this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
    }
    return libQ.resolve();
  }

//-----------------------------------------------------------------------

  public getUIConfig(): Promise<any> {
    const defer = libQ.defer();
    //const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';

    this.logger.debug('CTRLD0004', this.langCode);

    this.commandRouter.i18nJson(
      `${__dirname}/../i18n/strings_${this.langCode}.json`,
      `${__dirname}/../i18n/strings_en.json`,
      `${__dirname}/../UIConfig.json`
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
        const today = broadcastTimeConverter.getCurrentDate();
        const content = uiconf.sections[sectionIdx].content[2];
        content.value.value = timeFormat;
        for (const opt of content.options) {
          opt.label = format(opt.label, broadcastTimeConverter.formatFullString2([today+'120000', today+'130000'], opt.value));
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
            label: messageHelper.get(item.region), // '関東'
          }); // contents[0]
          item.areas.forEach((radikoArea) => {
            const areaId = radikoArea.split('.').pop(); // 'RADIKO_AREA.JP13'
            const areaName = messageHelper.get(radikoArea); // '≪ 関東 ≫'
            const areaStations = this.appRadio?.getAreaStations(areaId!); // TBS,QRR,LFR,INT,FMT,...,JOAK
            const value = this.config.get(`radikoAreas.${areaId}`);
            contents.push({
              id         : areaId,  // 'JP13'
              element    : 'switch',
              label      : `- ${areaName}${(myInfo.areaId == areaId) ? messageHelper.get('UI_SETTINGS.RADIKO_MY_AREA') : ''}`,
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
      this.logger.error('CTRLE0003', error);
      defer.reject(error);
    });

    return defer.promise;
  }

  public getConfigurationFiles(): string[] {
    return ['config.json'];
  }

  public saveNetworkSetting(data: { servicePort: string; networkDelay: string }): void {
    this.logger.debug('CTRLD0008');
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

  public saveRadikoAccountSetting(data: { radikoUser: string; radikoPass: string }): void {
    this.logger.debug('CTRLD0009');
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

  public saveAlbumartSetting(data: { albumartType: { value: string; label: string } }): void {
    this.logger.debug('CTRLD0010');
    if (this.config) {
      if (this.config.get('albumartType') !== data.albumartType.value) {
        this.config.set('albumartType', data.albumartType.value);
        this.showRestartModal();
      }
    }
  }

  public clearStationLogoCache(data: any): void {
    this.logger.debug('CTRLD0011');
    exec(`/bin/rm -f ${__dirname}/assets/images/*_logo.png`, (err: any) => {
      if (err) {
        this.logger.error('CTRLE0004', err);
      } else {
        this.commandRouter.pushToastMessage('success', 'JP Radio', messageHelper.get('MESSAGE.STATION_LOGO_CLEAR'));
      }
    });
  }

  public saveTimeFreeSetting(data: { programPeriodFrom: string; programPeriodTo: string; timeFormat: { value: string; label: string }}): void {
    this.logger.debug('CTRLD0012');
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

  public saveRadikoAreasSetting(data: any): void {
    this.logger.debug('CTRLD0013');
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
      this.commandRouter.pushToastMessage('error', messageHelper.get('MESSAGE.RESTART_FAILED_TITLE'), messageHelper.get('MESSAGE.RESTART_FAILED_MESSAGE'));
    }
  }

  private showRestartModal(): void {
    const message = {
      title: messageHelper.get('MESSAGE.RESTART_MODAL_TITLE'),
      message: messageHelper.get('MESSAGE.RESTART_MODAL_MESSAGE'),
      size: 'lg',
      buttons: [
        {
          name: this.commandRouter.messageHelper.get('COMMON.RESTART'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'restartPlugin',
            data: {}
          }
        },
        {
          name: this.commandRouter.messageHelper.get('COMMON.CANCEL'),
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
    this.logger.debug('CTRLD0014', this.serviceName);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/dist/assets/images/app_radiko.svg'
    });
  }

  public handleBrowseUri(curUri: string): Promise<any> {
    this.logger.debug('CTRLD0015', curUri);
    const defer = libQ.defer();
    if (!this.appRadio) {
      this.logger.error('CTRLE0005');
      defer.resolve({});
      return defer.promise;
    }

    const [base, mode, stationId, option] = curUri.split('/');
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
          .fail((error: any) => {
            this.logger.error('CTRLE0006', error);
            defer.reject(error);
          });

      } else if (mode.startsWith('timefree')) {
        // uri = radiko/timefree or radiko/timefree_today or radiko/timefree/favourites
        defer.resolve( (stationId == 'favourites')
                     ? this.appRadio.radioFavouriteStations(mode)
                     : this.appRadio.radioStations(mode) );

      } else if (mode.startsWith('timetable')) {
        libQ.resolve()
          .then(() => {
            if (option == undefined) {
              // uri = radiko/timetable/TBS or radiko/timetable_today/TBS
              const today = mode.endsWith('today');
              const from = today ? 0 : this.confParam.ppFrom;
              const to   = today ? 0 : this.confParam.ppTo;
              return this.appRadio!.radioTimeTable(mode, stationId, -from, to);
            } else {
              // uri = radiko/timetable/TBS/#~#
              const [from, to] = option.split('~');
              return this.appRadio!.radioTimeTable(mode, stationId, from, to);
            }
          })
          .then((result: any) => defer.resolve(result) )
          .fail((error: any) => {
            this.logger.error('CTRLE0007', error);
            defer.reject(error);
          });

      } else if (mode.startsWith('progtable')) {
        // uri = radiko/progtable/TBS/#~#
        const [from, to] = option.split('~');
        libQ.resolve()
          .then(() => this.appRadio!.radioTimeTable(mode, stationId, from, to) )
          .then((result: any) => defer.resolve(result) )
          .fail((error: any) => {
            this.logger.error('CTRLE0008', error);
            defer.reject(error);
          });

      } else if (mode.startsWith('proginfo')) {
        // uri = radiko/proginfo/TBS?tt&sn&aa&ft&to
        libQ.resolve()
          .then(() => {
            this.explodeUri(curUri)
            .then((data) => this.showProgInfoModal(data) )
          })
          .fail((error: any) => {
            this.logger.error('CTRLE0009', error);
            defer.reject(error);
          });
      }

    } else { // base != 'radiko'
      this.logger.error('CTRLE0010');
      defer.resolve({});
    }
    return defer.promise;
  }

  private rootMenu(): BrowseResult {
    return {
      navigation: {
        lists: [{
          title: '',
          availableListViews: ['grid', 'list'],
          items: [
            {
              service: this.serviceName,
              type   : 'radio-category',
              title  : messageHelper.get('BROWSER.LIVE'),
              icon   : 'fa fa-microphone',
              uri    : 'radiko/live'
            },
            {
              service: this.serviceName,
              type   : 'radio-favourites',
              title  : messageHelper.get('BROWSER.LIVE_FAVOURITES'),
              icon   : 'fa fa-heart',
              uri    : 'radiko/live/favourites'
            },
            {
              service: this.serviceName,
              type   : 'radio-category',
              title  : messageHelper.get('BROWSER.TIMEFREE'),
              icon   : 'fa fa-clock-o',
              uri    : 'radiko/timefree'
            },
            {
              service: this.serviceName,
              type   : 'radio-category',
              title  : messageHelper.get('BROWSER.TIMEFREE_TODAY'),
              icon   : 'fa fa-map-marker',
              uri    : 'radiko/timefree_today'
            },
            {
              service: this.serviceName,
              type   : 'radio-favourites',
              title  : messageHelper.get('BROWSER.TIMEFREE_FAVOURITES'),
              icon   : 'fa fa-heartbeat',
              uri    : 'radiko/timefree/favourites'
            }
          ]
        }],
        prev: { uri: 'radiko' }
      }
    }
  }

  public clearAddPlayTrack(track: any): any {
    this.logger.debug('CTRLD0016', track.uri);
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
            const ft = query.ft ? String(query.ft) : '';
            const to = query.to ? String(query.to) : '';
            const check = broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioTime());
            if (check > 0) {
              // 配信前の番組は再生できないのでライブ放送に切り替え
              uri = liveUri;
              this.commandRouter.pushToastMessage('info', 'JP Radio', messageHelper.get('MESSAGE.WARNING_SWITCH_LIVE1'));
            } else if (check == 0) {
              // 追っかけ再生はうまくいかないのでライブ放送に切り替え（追っかけ再生は途中で切れる）
              uri = liveUri;
              this.commandRouter.pushToastMessage('info', 'JP Radio', messageHelper.get('MESSAGE.WARNING_SWITCH_LIVE2'));
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
  }

  public explodeUri(uri: string): Promise<any> {
    //this.logger.info(`JP_Radio::explodeUri: uri=${uri}`);
    var defer = libQ.defer();
    // uri(Live)     = radiko/play/TBS?tt&pf&sn&aa
    // uri(TimeFree) = radiko/play/TBS?tt&pf&sn&aa&ft&to&sk
    const [liveUri, tt, pf, sn, aa, ft, to, sk] = uri.split(/[?&]/);
    if (liveUri.startsWith('radiko/play/') || liveUri.startsWith('radiko/proginfo/')) {
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
        response.artist += broadcastTimeConverter.formatDateString(ft, ` @${this.confParam.dateFmt}`);
        response.uri += `?ft=${ft}&to=${to}` + (sk ? `&seek=${sk}` : '');
      }
      //this.logger.info(`JP_Radio::explodeUri: response.uri=${response.uri}`);
      defer.resolve(response);

    } else {
      defer.reject('Invalid URI');
    }
    return defer.promise;
  }

  public addToFavourites(data: any): any {
    //this.logger.info(`JP_Radio::addToFavourites: data=${Object.entries(data)}`);
    return this.explodeUri(data.uri).then((item) => {
      this.logger.debug('CTRLD0018', Object.entries(item));
      const [liveUri, timefree] = item.uri.split('?');
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

  public removeFromFavourites(data: any): any {
    //this.logger.info(`JP_Radio::removeFromFavourites: data=${Object.entries(data)}`);
    return this.explodeUri(data.uri).then((item) => {
      this.logger.debug('CTRLD0019', Object.entries(item));
      return this.commandRouter.playListManager.commonRemoveFromPlaylist(
        this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites', 'webradio', item.uri);
    });
  }

//-----------------------------------------------------------------------

  public seek(timepos: number): Promise<any> {
    this.logger.debug('CTRLD0020', timepos);
    const defer = libQ.defer();
    this.mpdPlugin.sendMpdCommand('currentsong', []).then((data: any) => {
      // uri(TimeFree) = http://localhost:9000/radiko/play/TBS?ft=##&to=##&seek=##
      var uri = data.file;
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
    this.logger.debug('CTRLD0021');
    return this.mpdPlugin.sendMpdCommand('stop', []);
  }

  public pause(): void {
    this.logger.debug('CTRLD0022');
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  public getState(): void {
    this.logger.debug('CTRLD0023');
  }

  public parseState(sState: any): void {
    this.logger.debug('CTRLD0024', Object.entries(sState));
  }

  public pushState(state: any): any {
    this.logger.debug('CTRLD0025', Object.entries(state));
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  public search(query: any): Promise<any> {
    this.logger.debug('CTRLD0026', Object.entries(query));
    return libQ.resolve();
  }

  // 再生画面の'...' => 'アーティストへ移動' or 'アルバムへ移動'
  public goto(data: any): Promise<any> {
    this.logger.debug('CTRLD0027', Object.entries(data));
    const defer = libQ.defer();
    // uri = http://localhost:9000/radiko/play/TBS?ft=##&to=##
    if (data.uri.includes('/radiko/play/')) {
      const [liveUri, timefree] = data.uri.split('?');
      const stationId = liveUri.split('/').pop();
      var d = 0;
      if (timefree) {
        const currentDate = broadcastTimeConverter.getCurrentRadioDate() + '000000';
        const query = queryParse(timefree);
        const ftDate = query.ft ? String(query.ft).slice(0,8) + '000000' : currentDate;
        d = -Math.floor(broadcastTimeConverter.getTimeSpan(ftDate, currentDate) / 86400);
      }

      if (data.type === 'artist') {
        // 'アーティストへ移動' ⇒ 番組情報(聴取中の番組) & 番組表(聴取中の局)
        defer.resolve(
          this.showProgInfoModal(data)
          .then(() => this.appRadio!.radioTimeTable('progtable', stationId, d, d) )
        );
      } else if (data.type == 'album') {
        // 'アルバムへ移動' ⇒ 番組表(聴取中の局)
        defer.resolve(this.appRadio!.radioTimeTable('progtable', stationId, d, d));
      }
    }
    return defer.promise;
  }

  //-----------------------------------------------------------------------

  public async showProgInfoModal(data: any): Promise<void> {
    this.logger.debug('CTRLD0028', Object.entries(data));
    const prg = this.appRadio?.getPrg();
    if (!prg) return;

    // uri = http://localhost:9000/radiko/play/TBS?ft=##&to=##
    const [liveUri, timefree] = data.uri.split('?');
    const stationId = liveUri.split('/').pop();
    if ((liveUri.includes('/radiko/play/') || liveUri.includes('/radiko/proginfo/')) && stationId) {
      var ft = broadcastTimeConverter.getCurrentRadioTime();
      var to = ft;
      if (timefree) {
        const query = queryParse(timefree);
        ft = query.ft ? String(query.ft) : '';
        to = query.to ? String(query.to) : '';
      }
      const progData = await prg.getProgramData(stationId, ft, true);
      if (!progData) return;
      const pfm = progData.pfm ? messageHelper.get('PROGINFO.PERFORMER') + progData.pfm : '<br/>';
      data.uri = data.uri.replace(/\/proginfo\//, '/play/');
      const modalMessage = {
        title  : messageHelper.get('PROGINFO.PROG_INFO') + progData.title,
      //message: `<div>${data.artist}</div><div>${pfm}</div>${progData.info}<div style="text-align:right">${data.uri}</div>`,
        message: `<div>${data.artist}</div><div>${pfm}</div>${progData.info}<div align="right">${data.uri}</div>`,
        size   : 'lg',
        buttons: [
        {
            name  : messageHelper.get('PROGINFO.PLAY'),
            class : 'btn btn-info',
            emit  : 'callMethod',
            payload: {
              endpoint: `music_service/${this.serviceName}`,
              method  : 'play_formProgInfoModal',
              data    : data
            } 
          },
          {
            name  : messageHelper.get('PROGINFO.ADD_TO_QUEUE'),
            class : 'btn btn-info',
            emit  : 'callMethod',
            payload: {
              endpoint: `music_service/${this.serviceName}`,
              method  : 'addQueue_formProgInfoModal',
              data    : data
            } 
          },
          {
            name  : messageHelper.get('PROGINFO.ADD_TO_FAVOURITES'),
            class : 'btn btn-info',
            emit  : 'callMethod',
            payload: {
              endpoint: `music_service/${this.serviceName}`,
              method  : 'addFavourites_formProgInfoModal',
              data    : data
            } 
          },
          {
            name : this.commandRouter.messageHelper.get('COMMON.CLOSE'),
            class: 'btn btn-warning',
            emit : 'closeModals',
            payload: ''
          }
        ]
      };
      if (broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioDate() + '050000') < -7 * 86400)
        modalMessage.buttons.splice(0, 3); //「再生/キューに追加/お気に入りに追加」ボタンを消す
      else if (broadcastTimeConverter.checkProgramTime(ft, to, broadcastTimeConverter.getCurrentRadioTime()) >= 0)
        modalMessage.buttons.splice(0, 1); //「再生」ボタンを消す
      this.commandRouter.broadcastMessage('openModal', modalMessage);
    }
  }

  public play_formProgInfoModal(data: any): void {
    this.logger.debug('CTRLD0029', Object.entries(data));
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.unshift(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.volumioPushQueue(arrayQueue);
    this.commandRouter.volumioPlay(0);
  }

  public addQueue_formProgInfoModal(data: any): void {
    this.logger.debug('CTRLD0030', Object.entries(data));
    this.commandRouter.pushToastMessage('success', this.commandRouter.messageHelper.get('COMMON.ADD_QUEUE_TITLE'),
      this.commandRouter.messageHelper.get('COMMON.ADD_QUEUE_TEXT_1') + data.name + this.commandRouter.messageHelper.get('COMMON.ADD_QUEUE_TEXT_2'));
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.push(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.stateMachine.playQueue.saveQueue();
    this.commandRouter.volumioPushQueue(arrayQueue);
}

  public addFavourites_formProgInfoModal(data: any): void {
    this.logger.debug('CTRLD0031', Object.entries(data));
    this.commandRouter.pushToastMessage('success', this.commandRouter.messageHelper.get('PLAYLIST.ADDED_TITLE'),
      data.name + this.commandRouter.messageHelper.get('PLAYLIST.ADDED_TO_FAVOURITES'));
    this.commandRouter.playListManager.commonAddToPlaylist(
      this.commandRouter.playListManager.favouritesPlaylistFolder, 'radio-favourites',
      'webradio', data.uri, data.name, data.albumart);
  }
}
