import libQ from 'kew';
import VConf from 'v-conf';
import JpRadio from './lib/radio';
import { BrowseResult } from './lib/models/BrowseResultModel';
//import { getCurrentRadioTime, formatTimeString, getTimeSpan } from './lib/radioTime';

export = ControllerJpRadio;

class ControllerJpRadio {
  private context: any;
  private commandRouter: any;
  private logger: any;
  private configManager: any;
  private config: InstanceType<typeof VConf> | null = null;
  private readonly serviceName = 'jp_radio';
  private appRadio: JpRadio | null = null;
  private mpdPlugin: any;

  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
  }

  async restartPlugin(): Promise<void> {
    try {
      await this.onStop();
      await this.onStart();
    } catch {
      this.commandRouter.pushToastMessage('error', 'Restart Failed', 'The plugin could not be restarted.');
    }
  }

  private showRestartModal(): void {
    const message = {
      title: 'Plugin Restart Required',
      message: 'Changes have been made that require the JP Radio plugin to be restarted. Please click the restart button below.',
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
          class: 'btn btn-info',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };
    this.commandRouter.broadcastMessage('openModal', message);
  }

  async saveServicePort(data: { servicePort: string }): Promise<void> {
    const newPort = Number(data.servicePort);
    if (!isNaN(newPort) && this.config && this.config.get('servicePort') !== newPort) {
      this.config.set('servicePort', newPort);
      this.showRestartModal();
    }
  }

  async saveRadikoAccount(data: { radikoUser: string; radikoPass: string }): Promise<void> {
    if (!this.config) return;
    const updated = ['radikoUser', 'radikoPass'].some(
      (key) => this.config!.get(key) !== (data as any)[key]
    );
    if (updated) {
      this.config.set('radikoUser', data.radikoUser);
      this.config.set('radikoPass', data.radikoPass);
      this.showRestartModal();
    }
  }

  onVolumioStart(): Promise<void> {
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

  onStart(): Promise<void> {
    this.logger.info(`JP_Radio::onStart: ## START ##`);
    const defer = libQ.defer();

    this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    if (!this.config) {
      this.logger.error('Config not initialized onStart');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }

    const radikoUser = this.config.get('radikoUser');
    const radikoPass = this.config.get('radikoPass');
    const servicePort = this.config.get('servicePort');
    const account = radikoUser && radikoPass ? { mail: radikoUser, pass: radikoPass } : null;

    this.appRadio = new JpRadio(servicePort, this.logger, account, this.commandRouter, this.serviceName);

    this.appRadio.start()
      .then(() => {
        this.addToBrowseSources();
        defer.resolve();
        this.logger.info(`JP_Radio::onStart: ## COMPLETE ##`);
      })
      .catch((err) => {
        this.logger.error('JP_Radio::Failed to start appRadio', err);
        if (err.code === 'EADDRINUSE') {
          const message = `ポート ${servicePort} はすでに使用中です。JP Radio を開始できません。`;
          this.logger.error(`JP_Radio::ポート使用中エラー: ${message}`);
          this.commandRouter.pushToastMessage('error', 'JP Radio 起動エラー', message);
        } else {
          this.logger.error('JP_Radio::Failed to start appRadio', err);
          this.commandRouter.pushToastMessage('error', 'JP Radio 起動エラー', err.message || '不明なエラー');
        }

        defer.reject(err);
      });
    this.logger.info(`JP_Radio::onStart: ## EXIT ##`);
    return defer.promise;
  }

  async onStop(): Promise<void> {
    this.logger.info(`JP_Radio::onStop:`);
    try {
      if (this.appRadio) await this.appRadio.stop();
    } catch (err) {
      this.logger.error('JP_Radio::Error stopping appRadio', err);
    }
    this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
  }

  getUIConfig(): Promise<any> {
    this.logger.info(`JP_Radio::getUIConfig:`);
    const defer = libQ.defer();
    const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';

    this.commandRouter.i18nJson(
      `${__dirname}/i18n/strings_${langCode}.json`,
      `${__dirname}/i18n/strings_en.json`,
      `${__dirname}/UIConfig.json`
    )
      .then((uiconf: any) => {
        const servicePort = this.config.get('servicePort');
        const radikoUser = this.config.get('radikoUser');
        const radikoPass = this.config.get('radikoPass');

        if (uiconf.sections?.[0]?.content?.[0]) uiconf.sections[0].content[0].value = servicePort;
        if (uiconf.sections?.[1]?.content?.[0]) uiconf.sections[1].content[0].value = radikoUser;
        if (uiconf.sections?.[1]?.content?.[1]) uiconf.sections[1].content[1].value = radikoPass;

        defer.resolve(uiconf);
      })
      .fail((error: any) => {
        this.logger.error('getUIConfig failed:', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  getConfigurationFiles(): string[] {
    return ['config.json'];
  }

  addToBrowseSources(): void {
    this.logger.info(`JP_Radio::addToBrowseSources: pluginName=${this.serviceName}`);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/dist/assets/images/app_radiko.svg'
    });
  }

  handleBrowseUri(curUri: string): Promise<any> {
    const defer = libQ.defer();
    const [baseUri] = curUri.split('?');

    if (baseUri === 'radiko') {
      if (!this.appRadio) {
        this.logger.error('[JP_Radio] handleBrowseUri !this.appRadio');
        defer.resolve({});
      } else {
        libQ.resolve()
          .then(() => this.appRadio!.radioStations())
          .then((result: any) => defer.resolve(result))
          .fail((err: any) => {
            this.logger.error('[JP_Radio] handleBrowseUri error: ' + err);
            defer.reject(err);
          });
      }
    } else {
      this.logger.error('[JP_Radio] handleBrowseUri else');
      defer.resolve({});
    }

    return defer.promise;
  }

  clearAddPlayTrack(track: any): Promise<any> {
    this.logger.info(`JP_Radio::clearAddPlayTrack: uri=${track.uri}`);
    const safeUri = track.uri.replace(/"/g, '\\"');
    return this.mpdPlugin.sendMpdCommand('stop', [])
      .then(() => {
        return this.mpdPlugin.sendMpdCommand('clear', []);
      })
      .then(() => {
        return this.mpdPlugin.sendMpdCommand(`add "${safeUri}"`, []);
      })
      .then(() => {
        this.commandRouter.stateMachine.setConsumeUpdateService('mpd');
        return this.mpdPlugin.sendMpdCommand('play', []);
      });
  }

  seek(timepos: number): Promise<any> {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::seek to ${timepos}`);
    return libQ.reject();
    //return this.mpdPlugin.seek(timepos);
    //return libQ.resolve();
  }

  stop(): void {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::stop`);
    return this.mpdPlugin.sendMpdCommand('stop', []);
  }

  pause(): void {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::pause`);
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  getState(): void {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::getState`);
  }

  parseState(sState: any): void {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::parseState`);
  }

  pushState(state: any): any {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::pushState`);
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  explodeUri(uri: string): Promise<any> {
    this.logger.info(`JP_Radio::explodeUri: uri=${uri}`);
    var defer = libQ.defer();

    // uri=http://localhost:9000/radiko/play/FMT/tt/sn/aa
    //      0   1        2         3     4    5  6  7  8
    const uris = uri.split('/');
    const param = {
      hp: uris[2],  // 'localhost:9000'
      id: uris[3],  // 'radiko'
      st: uris[5],  // stationID
      tt: decodeURIComponent(uris[6]), // title & performer
      sn: decodeURIComponent(uris[7]), // stationName & time
      aa: decodeURIComponent(uris[8]), // albumart
    };

    if (param.id == 'radiko') {
      const response = {
        service: this.serviceName,  // clearAddPlayTrackを呼び出す先のサービス名
        type: 'song',
        title: param.tt,
        name: param.tt,
        artist: param.sn,
        albumart: param.aa,
        uri: `http://${param.hp}/${param.id}/play/${param.st}`,
      };
      defer.resolve(response);

    } else {
      defer.resolve();
    }

    return defer.promise;
  }

  search(query: any): Promise<any> {
    return libQ.resolve();
  }

  goto(data: any): Promise<any> {
    return libQ.resolve();
  }
}
