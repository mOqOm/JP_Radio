import libQ from 'kew';
import VConf from 'v-conf';
import JpRadio from './lib/radio';

export = ControllerJpRadio;

class ControllerJpRadio {
  private context: any;
  private commandRouter: any;
  private logger: any;
  private configManager: any;
  private config: any;
  private readonly serviceName = 'jp_radio';
  private appRadio: any;

  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
  }

  restartPlugin(): void {
    this.onStop().then(() => {
      this.onStart().catch(() => {
        this.commandRouter.pushToastMessage('error', 'Restart Failed', 'The plugin could not be restarted.');
      });
    });
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
            endpoint: 'music_service/jp_radio',
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

  saveServicePort(data: any): Promise<void> {
    const newPort = parseInt(data['servicePort']);
    if (!isNaN(newPort) && this.config.get('servicePort') !== newPort) {
      this.config.set('servicePort', newPort);
      this.showRestartModal();
    }
    return libQ.resolve();
  }

  saveRadikoAccount(data: any): Promise<void> {
    const updated = ['radikoUser', 'radikoPass'].some(key => {
      if (this.config.get(key) !== data[key]) {
        this.config.set(key, data[key]);
        return true;
      }
      return false;
    });

    if (updated) {
      this.showRestartModal();
    }

    return libQ.resolve();
  }

  onVolumioStart(): Promise<void> {
    const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new VConf();
    this.config.loadFile(configFile);
    return libQ.resolve();
  }

  onStart(): Promise<void> {
    const radikoUser = this.config.get('radikoUser');
    const radikoPass = this.config.get('radikoPass');
    const servicePort = this.config.get('servicePort') || 9000;

    const account = (radikoUser && radikoPass) ? { mail: radikoUser, pass: radikoPass } : null;

    this.appRadio = new JpRadio(servicePort, this.logger, account);
    this.appRadio.start();
    this.addToBrowseSources();

    return libQ.resolve();
  }

  onStop(): Promise<void> {
    this.appRadio.stop();
    this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
    return libQ.resolve();
  }

  onRestart(): void {}

  getUIConfig(): Promise<any> {
    const defer = libQ.defer();
    const lang_code = this.commandRouter.sharedVars.get('language_code');

    this.commandRouter.i18nJson(
      `${__dirname}/i18n/strings_${lang_code}.json`,
      `${__dirname}/i18n/strings_en.json`,
      `${__dirname}/UIConfig.json`
    ).then((uiconf: any) => {
      uiconf.sections[0].content[0].value = this.config.get('servicePort');
      uiconf.sections[1].content[0].value = this.config.get('radikoUser');
      uiconf.sections[1].content[1].value = this.config.get('radikoPass');
      defer.resolve(uiconf);
    }).fail(() => {
      defer.reject(new Error());
    });

    return defer.promise;
  }

  getConfigurationFiles(): string[] {
    return ['config.json'];
  }

  setUIConfig(data: any): void {}
  getConf(varName: string): void {}
  setConf(varName: string, varValue: any): void {}

  addToBrowseSources(): void {
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg'
    });
  }

  handleBrowseUri(curUri: string): Promise<any> {
    if (curUri === 'radiko') {
      return libQ.resolve({
        navigation: {
          lists: [{
            title: 'LIVE',
            availableListViews: ['grid', 'list'],
            items: this.appRadio.radioStations()
          }]
        }
      });
    }
    return libQ.resolve();
  }

  clearAddPlayTrack(track: any): Promise<any> {
    this.logger.info(`[${Date.now()}] JP_Radio::clearAddPlayTrack\n${JSON.stringify(track)}`);
    return libQ.resolve();
  }

  seek(timepos: number): Promise<any> {
    this.logger.info(`[${Date.now()}] JP_Radio::seek to ${timepos}`);
    return libQ.resolve();
  }

  stop(): void {
    this.logger.info(`[${Date.now()}] JP_Radio::stop`);
  }

  pause(): void {
    this.logger.info(`[${Date.now()}] JP_Radio::pause`);
  }

  getState(): void {
    this.logger.info(`[${Date.now()}] JP_Radio::getState`);
  }

  parseState(sState: any): void {
    this.logger.info(`[${Date.now()}] JP_Radio::parseState`);
  }

  pushState(state: any): any {
    this.logger.info(`[${Date.now()}] JP_Radio::pushState`);
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  explodeUri(uri: string): Promise<any> {
    return libQ.resolve();
  }

  search(query: any): Promise<any> {
    return libQ.resolve();
  }

  _searchArtists(results: any): void {}
  _searchAlbums(results: any): void {}
  _searchPlaylists(results: any): void {}
  _searchTracks(results: any): void {}

  goto(data: any): Promise<any> {
    return libQ.resolve();
  }
}
