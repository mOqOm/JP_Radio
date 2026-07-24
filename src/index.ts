import path from 'path';
import libQ from 'kew';
import VConf from 'v-conf';
import JpRadio from '@/controllers/radio-controller';
import { BrowseResult } from '@/models/browse-result-model';
import { createLoginAccount } from '@/logic/auth';
import { messageCatalog } from '@/utils/message-catalog';
import { I18N_DIR, UI_CONFIG_PATH } from '@/utils/plugin-paths';

export = ControllerJpRadio;

/**
 * Volumio4のmusic_serviceプラグインとして登録されるコントローラ。
 * Volumioのコア(CoreCommandRouter/CorePlayQueue)から各ライフサイクルメソッドを呼び出され、
 * 実際のRadikoストリーミング処理は{@link JpRadio}(Express製の内部HTTPサーバ)に委譲する。
 *
 * Volumioは一部のメソッドの戻り値に対して`.fail()`(kewのAPI)を呼び出すため、
 * それらのメソッドはネイティブPromiseではなくkew(`libQ`)ベースで実装する必要がある。
 */
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

  /**
   * UI設定画面の「再起動」操作から呼ばれる。onStop→onStartの順に再実行してプラグインを再起動する。
   */
  async restartPlugin(): Promise<void> {
    try {
      await this.onStop();
      await this.onStart();
    } catch {
      this.commandRouter.pushToastMessage(
        'error',
        messageCatalog.get('RESTART_FAILED_TITLE'),
        messageCatalog.get('RESTART_FAILED_MESSAGE'),
      );
    }
  }

  /**
   * 設定変更後にプラグインの再起動が必要な旨をVolumio UIのモーダルで通知する。
   */
  private showRestartModal(): void {
    const message = {
      title: messageCatalog.get('RESTART_MODAL_TITLE'),
      message: messageCatalog.get('RESTART_MODAL_MESSAGE'),
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

  /**
   * UI設定画面で入力されたサービスポート番号を保存し、変更があれば再起動を促す。
   */
  async saveServicePort(data: { servicePort: string }): Promise<void> {
    const newPort = Number(data.servicePort);
    if (isNaN(newPort) === false && this.config !== null && this.config.get('servicePort') !== newPort) {
      this.config.set('servicePort', newPort);
      this.showRestartModal();
    }
  }

  /**
   * UI設定画面で入力されたRadikoプレミアム会員のアカウント情報を保存し、変更があれば再起動を促す。
   */
  async saveRadikoAccount(data: { radikoUser: string; radikoPass: string }): Promise<void> {
    if (this.config === null) {
      return;
    }
    const updated = (Object.keys(data) as Array<keyof typeof data>).some(
      (key) => this.config!.get(key) !== data[key]
    );
    if (updated === true) {
      this.config.set('radikoUser', data.radikoUser);
      this.config.set('radikoPass', data.radikoPass);
      this.showRestartModal();
    }
  }

  /**
   * Volumio起動時に最初に呼ばれるライフサイクルメソッド。config.jsonを読み込む。
   */
  onVolumioStart(): Promise<void> {
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

  /**
   * プラグイン有効化時に呼ばれるライフサイクルメソッド。
   * 設定値からアカウント情報とサービスポートを取り出し、{@link JpRadio}を起動してブラウズソースに登録する。
   */
  onStart(): Promise<void> {
    this.logger.info(`JP_Radio::onStart: ## START ##`);
    const defer = libQ.defer();

    this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    if (this.config === null) {
      this.logger.error('Config not initialized onStart');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }

    const radikoUser = this.config.get('radikoUser');
    const radikoPass = this.config.get('radikoPass');
    const servicePort = this.config.get('servicePort');
    const account = createLoginAccount(radikoUser, radikoPass);

    this.appRadio = new JpRadio(servicePort, this.logger, account, this.commandRouter, this.serviceName);

    this.appRadio.start()
      .then(() => {
        this.addToBrowseSources();
        defer.resolve();
        this.logger.info(`JP_Radio::onStart: ## COMPLETE ##`);
      })
      .catch((error: any) => {
        this.logger.error('JP_Radio::Failed to start appRadio', error);
        if (error.code === 'EADDRINUSE') {
          const message = messageCatalog.get('ERROR_PORT_IN_USE', servicePort);
          this.logger.error(`JP_Radio::ポート使用中エラー: ${message}`);
          this.commandRouter.pushToastMessage('error', messageCatalog.get('ERROR_BOOT_TITLE'), message);
        } else {
          this.commandRouter.pushToastMessage(
            'error',
            messageCatalog.get('ERROR_BOOT_TITLE'),
            error.message || messageCatalog.get('ERROR_UNKNOWN'),
          );
        }
        defer.reject(error);
      });
    this.logger.info(`JP_Radio::onStart: ## EXIT ##`);
    return defer.promise;
  }

  /**
   * プラグイン無効化時に呼ばれるライフサイクルメソッド。JpRadioを停止し、ブラウズソースから除去する。
   */
  async onStop(): Promise<void> {
    this.logger.info(`JP_Radio::onStop:`);
    try {
      if (this.appRadio !== null) {
        await this.appRadio.stop();
      }
    } catch (error: any) {
      this.logger.error('JP_Radio::Error stopping appRadio', error);
    }
    this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
  }

  /**
   * UI設定画面(UIConfig.json)を多言語化しつつ、現在の設定値を埋め込んで返す。
   */
  getUIConfig(): Promise<any> {
    this.logger.info(`JP_Radio::getUIConfig:`);
    const defer = libQ.defer();

    if (this.config === null) {
      const error = new Error('Config not initialized');
      this.logger.error('getUIConfig failed:', error);
      defer.reject(error);
      return defer.promise;
    }

    const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';

    this.commandRouter.i18nJson(
      path.join(I18N_DIR, `strings_${langCode}.json`),
      path.join(I18N_DIR, 'strings_en.json'),
      UI_CONFIG_PATH
    )
      .then((uiconf: any) => {
        const servicePort = this.config!.get('servicePort');
        const radikoUser = this.config!.get('radikoUser');
        const radikoPass = this.config!.get('radikoPass');

        if (uiconf.sections?.[0]?.content?.[0] !== undefined) {
          uiconf.sections[0].content[0].value = servicePort;
        }
        if (uiconf.sections?.[1]?.content?.[0] !== undefined) {
          uiconf.sections[1].content[0].value = radikoUser;
        }
        if (uiconf.sections?.[1]?.content?.[1] !== undefined) {
          uiconf.sections[1].content[1].value = radikoPass;
        }

        defer.resolve(uiconf);
      })
      .fail((error: any) => {
        this.logger.error('getUIConfig failed:', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * このプラグインが使用する設定ファイル名の一覧をVolumioに伝える。
   */
  getConfigurationFiles(): string[] {
    return ['config.json'];
  }

  /**
   * VolumioのBrowseメニューに「RADIKO」ソースを追加する。
   */
  addToBrowseSources(): void {
    this.logger.info(`JP_Radio::addToBrowseSources: pluginName=${this.serviceName}`);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg'
    });
  }

  /**
   * BrowseメニューでURIが選択された際に呼ばれ、局一覧({@link JpRadio.radioStations})を返す。
   */
  handleBrowseUri(curUri: string): Promise<BrowseResult | Record<string, never>> {
    const defer = libQ.defer();
    const [baseUri] = curUri.split('?');

    if (baseUri === 'radiko') {
      if (this.appRadio === null) {
        this.logger.error('[JP_Radio] handleBrowseUri !this.appRadio');
        defer.resolve({});
      } else {
        libQ.resolve()
          .then(() => this.appRadio!.radioStations())
          .then((result: any) => defer.resolve(result))
          .fail((error: any) => {
            this.logger.error('[JP_Radio] handleBrowseUri error: ' + error);
            defer.reject(error);
          });
      }
    } else {
      this.logger.error('[JP_Radio] handleBrowseUri else');
      defer.resolve({});
    }

    return defer.promise;
  }

  /**
   * キューのトラック選択時に呼ばれ、mpdのキューをクリアして再生対象のURIを追加・再生する。
   */
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

  /**
   * ライブストリームのためシークは非対応。常にrejectする。
   */
  seek(timepos: number): Promise<any> {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::seek to ${timepos}`);
    return libQ.reject();
  }

  /**
   * mpdへ再生停止コマンドを送る。
   */
  stop(): Promise<any> {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::stop`);
    return this.mpdPlugin.sendMpdCommand('stop', []);
  }

  /**
   * mpdへ一時停止コマンドを送る。
   */
  pause(): Promise<any> {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::pause`);
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  /**
   * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
   */
  getState(): void {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::getState`);
  }

  /**
   * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
   */
  parseState(_sState: any): void {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::parseState`);
  }

  /**
   * 再生状態をVolumioコアへプッシュする。
   */
  pushState(state: any): any {
    this.logger.info(`[${new Date().toISOString()}] JP_Radio::pushState`);
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  /**
   * キュー内のURI(`http://localhost:9000/radiko/play/{stationID}`)を
   * clearAddPlayTrackが要求するトラック情報オブジェクトに展開する。
   * タイトルやアルバムアートなどの表示用メタデータはURIに含めず、{@link JpRadio.getTrackMeta}で都度取得し直す
   * (長い日本語テキストや画像URLをそのままURIに埋め込みたくないため)。
   */
  explodeUri(uri: string): Promise<any> {
    this.logger.info(`JP_Radio::explodeUri: uri=${uri}`);
    const defer = libQ.defer();

    // uri=http://localhost:9000/radiko/play/FMT
    //      0   1        2         3     4    5
    const uris = uri.split('/');
    const serviceId = uris[3];
    const stationId = uris[5];

    if (serviceId !== 'radiko' || this.appRadio === null) {
      defer.resolve();
      return defer.promise;
    }

    libQ.resolve()
      .then(() => this.appRadio!.getTrackMeta(stationId))
      .then((meta: any) => {
        if (meta === null) {
          defer.resolve({});
          return;
        }
        defer.resolve({
          // clearAddPlayTrackを呼び出す先のサービス名
          service: this.serviceName,
          type: 'song',
          title: meta.title,
          name: meta.title,
          artist: meta.artist,
          albumart: meta.albumart,
          uri,
        });
      })
      .fail((error: any) => {
        this.logger.error('[JP_Radio] explodeUri error: ' + error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * 検索機能は未実装。呼び出し元がエラー扱いしないよう空のresolveを返す。
   */
  search(_query: any): Promise<any> {
    return libQ.resolve();
  }

  /**
   * アルバム/アーティストへのジャンプは未対応。呼び出し元がエラー扱いしないよう空のresolveを返す。
   */
  goto(_data: any): Promise<any> {
    return libQ.resolve();
  }
}
