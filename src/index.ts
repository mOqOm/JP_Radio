import path from 'path';
import libQ from 'kew';
import VConf from 'v-conf';
import JpRadio from '@/controllers/radio-controller';
import { BrowseResult } from '@/models/browse-result-model';
import { createLoginAccount } from '@/logic/auth';
import { messageCatalog } from '@/utils/message-catalog';
import { I18N_DIR, UI_CONFIG_PATH } from '@/utils/plugin-paths';
import type { TimeFreeQuery } from '@/models/time-free-query-model';
import type { ProgInfoData } from '@/models/prog-info-model';
import { AREA_KANJI, AREA_REGIONS } from '@/consts/area-name';
import { LoggerEx } from '@/utils/logger';

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
  private logger: LoggerEx;
  private configManager: any;
  private config: InstanceType<typeof VConf> | null = null;
  private readonly serviceName = 'jp_radio';
  private appRadio: JpRadio | null = null;
  private mpdPlugin: any;

  /**
   * @param context Volumioコアから渡されるプラグインコンテキスト(coreCommand/logger/configManagerを含む)。
   */
  constructor(context: any) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = new LoggerEx(context.logger);
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
   * UIConfig.jsonのselect要素(`content.value`/`content.options`)に現在値を反映する。
   * `content.options[].label`はこの時点で既に`i18nJson`によって翻訳済みの文字列になっている。
   * @param content UIConfig.jsonのselect要素(`value`/`options`を持つオブジェクト)。
   * @param currentValue 現在の設定値。
   */
  private populateSelectValue(content: any, currentValue: string): void {
    content.value.value = currentValue;
    for (const option of content.options) {
      if (option.value === currentValue) {
        content.value.label = option.label;
        break;
      }
    }
  }

  /**
   * 設定画面(`radikoAreas.JP1`~`radikoAreas.JP47`)で選択済みのエリアIDの一覧を返す。
   * 何も選択されていなければ空配列(→全国47エリアを取得するデフォルト動作)。
   */
  private getRadikoAreaIdArray(): string[] {
    if (this.config === null) {
      return [];
    }
    const areaIdArray: string[] = [];
    for (let i = 1; i <= 47; i++) {
      const areaId = `JP${i}`;
      if (this.config.get(`radikoAreas.${areaId}`) === true) {
        areaIdArray.push(areaId);
      }
    }
    return areaIdArray;
  }

  /**
   * エリア選択設定(`radiko_areas`)セクションの内容を、地域ごとにグループ化して動的に構築する。
   * この時点(`i18nJson`実行後)に新規追加する項目は翻訳の対象外になるため、ラベル等は
   * ここで直接最終的な文字列を組み立てる({@link messageCatalog}を使うのはそのため)。
   * @param section UIConfig.jsonの`radiko_areas`セクションオブジェクト。
   */
  private async populateRadikoAreasSection(section: any): Promise<void> {
    if (this.appRadio === null || this.config === null) {
      return;
    }
    section.hidden = false;
    section.content = [];
    section.saveButton.data = [];

    const myAreaInfo = await this.appRadio.getMyAreaId();
    const [myAreaId] = myAreaInfo.split('/');

    for (const region of AREA_REGIONS) {
      section.content.push({ label: region.name });
      for (const areaId of region.areaIdArray) {
        let label = AREA_KANJI.get(areaId);
        if (label === undefined) {
          label = areaId;
        }
        if (areaId === myAreaId) {
          label += messageCatalog.get('RADIKO_MY_AREA');
        }
        let value = this.config.get(`radikoAreas.${areaId}`);
        if (value !== true) {
          value = false;
        }
        section.content.push({
          id: areaId,
          element: 'switch',
          label,
          value,
          description: this.appRadio.getAreaStations(areaId).join(', '),
        });
        section.saveButton.data.push(areaId);
      }
      section.content.push({ label: '' });
    }
  }

  /**
   * UI設定画面で入力されたサービスポート番号を保存し、変更があれば再起動を促す。
   * @param data 保存ボタンから渡される入力値。
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
   * @param data 保存ボタンから渡される入力値。
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
   * UI設定画面で選択されたブラウズ動作(ライブ/タイムフリー選択時に直接再生するか、
   * 番組情報モーダルを表示するか)を保存し、変更があれば再起動を促す。
   * @param data 保存ボタンから渡される選択値。
   */
  async saveBrowseModeSetting(data: { browseMode1: { value: string }; browseMode2: { value: string } }): Promise<void> {
    if (this.config === null) {
      return;
    }
    let updated = false;
    if (this.config.get('browseMode1') !== data.browseMode1.value) {
      updated = true;
    }
    if (this.config.get('browseMode2') !== data.browseMode2.value) {
      updated = true;
    }
    if (updated === true) {
      this.config.set('browseMode1', data.browseMode1.value);
      this.config.set('browseMode2', data.browseMode2.value);
      this.showRestartModal();
    }
  }

  /**
   * UI設定画面で選択されたタイムフリー再生速度を保存し、変更があれば再起動を促す。
   * @param data 保存ボタンから渡される選択値。
   */
  async saveTempoSetting(data: { tempo: { value: string } }): Promise<void> {
    if (this.config === null) {
      return;
    }
    if (this.config.get('tempo') !== data.tempo.value) {
      this.config.set('tempo', data.tempo.value);
      this.showRestartModal();
    }
  }

  /**
   * UI設定画面で選択されたエリア選択(`radikoAreas.<areaId>`)を保存し、変更があれば再起動を促す。
   * @param data キーがエリアID(例: 'JP13')、値がそのエリアを取得対象にするかどうかの真偽値。
   */
  async saveRadikoAreasSetting(data: Record<string, boolean>): Promise<void> {
    if (this.config === null) {
      return;
    }
    let updated = false;
    for (const [areaId, value] of Object.entries(data)) {
      const key = `radikoAreas.${areaId}`;
      if (this.config.get(key) !== value) {
        updated = true;
        this.config.set(key, value);
      }
    }
    if (updated === true) {
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
    this.logger.info('IDX_I001');
    const defer = libQ.defer();

    this.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');

    if (this.config === null) {
      this.logger.error('IDX_E001');
      defer.reject(new Error('Config not initialized'));
      return defer.promise;
    }

    const radikoUser = this.config.get('radikoUser');
    const radikoPass = this.config.get('radikoPass');
    const servicePort = this.config.get('servicePort');
    const browseMode1 = this.config.get('browseMode1');
    const browseMode2 = this.config.get('browseMode2');
    const radikoAreaIdArray = this.getRadikoAreaIdArray();
    const tempo = Number(this.config.get('tempo'));
    const account = createLoginAccount(radikoUser, radikoPass);

    this.appRadio = new JpRadio(servicePort, this.logger, account, this.commandRouter, this.serviceName, browseMode1, browseMode2, radikoAreaIdArray, tempo);

    this.appRadio.start()
      .then(() => {
        this.addToBrowseSources();
        defer.resolve();
        this.logger.info('IDX_I002');
      })
      .catch((error: any) => {
        this.logger.error('IDX_E002', error);
        if (error.code === 'EADDRINUSE') {
          const message = messageCatalog.get('ERROR_PORT_IN_USE', servicePort);
          this.logger.error('IDX_E003', message);
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
    this.logger.info('IDX_I003');
    return defer.promise;
  }

  /**
   * プラグイン無効化時に呼ばれるライフサイクルメソッド。JpRadioを停止し、ブラウズソースから除去する。
   */
  async onStop(): Promise<void> {
    this.logger.info('IDX_I004');
    try {
      if (this.appRadio !== null) {
        await this.appRadio.stop();
      }
    } catch (error: any) {
      this.logger.error('IDX_E004', error);
    }
    this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
  }

  /**
   * UI設定画面(UIConfig.json)を多言語化しつつ、現在の設定値を埋め込んで返す。
   */
  getUIConfig(): Promise<any> {
    this.logger.info('IDX_I005');
    const defer = libQ.defer();

    if (this.config === null) {
      const error = new Error('Config not initialized');
      this.logger.error('IDX_E005', error);
      defer.reject(error);
      return defer.promise;
    }

    const langCode = this.commandRouter.sharedVars.get('language_code') || 'en';

    this.commandRouter.i18nJson(
      path.join(I18N_DIR, `strings_${langCode}.json`),
      path.join(I18N_DIR, 'strings_en.json'),
      UI_CONFIG_PATH
    )
      .then(async (uiconf: any) => {
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
        if (uiconf.sections?.[2]?.content?.[0] !== undefined) {
          this.populateSelectValue(uiconf.sections[2].content[0], this.config!.get('browseMode1'));
        }
        if (uiconf.sections?.[2]?.content?.[1] !== undefined) {
          this.populateSelectValue(uiconf.sections[2].content[1], this.config!.get('browseMode2'));
        }
        if (uiconf.sections?.[3]?.content?.[0] !== undefined) {
          this.populateSelectValue(uiconf.sections[3].content[0], this.config!.get('tempo'));
        }
        if (uiconf.sections?.[4] !== undefined && radikoUser !== '' && radikoPass !== '') {
          await this.populateRadikoAreasSection(uiconf.sections[4]);
        }

        defer.resolve(uiconf);
      })
      .fail((error: any) => {
        this.logger.error('IDX_E005', error);
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
    this.logger.info('IDX_I006', this.serviceName);
    this.commandRouter.volumioAddToBrowseSources({
      name: 'RADIKO',
      uri: 'radiko',
      plugin_type: 'music_service',
      plugin_name: this.serviceName,
      albumart: '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg'
    });
  }

  /**
   * BrowseメニューでURIが選択された際に呼ばれ、対応するブラウズ結果を返す。
   * `radiko` → ルートメニュー(ライブ/タイムフリー)、`radiko/live` → {@link JpRadio.radioStations}、
   * `radiko/timefree` → {@link JpRadio.timeFreeStations}、
   * `radiko/timetable/<stationId>` → {@link JpRadio.stationTimetable}、
   * `radiko/proginfo/<stationId>[?ft=&to=]` → 番組情報モーダルを表示(ブラウズ結果は返さず空を返す)。
   * @param curUri 選択されたURI。
   */
  handleBrowseUri(curUri: string): Promise<BrowseResult | Record<string, never>> {
    const defer = libQ.defer();
    const [baseUri, queryString] = curUri.split('?');

    const appRadio = this.appRadio;
    if (appRadio === null) {
      this.logger.error('IDX_E006');
      defer.resolve({});
      return defer.promise;
    }

    const segments = baseUri.split('/');

    if (segments[0] === 'radiko' && segments[1] === 'proginfo' && segments[2] !== undefined) {
      const stationId = segments[2];
      let timeFreeQuery: TimeFreeQuery | undefined;
      if (queryString !== undefined) {
        const params = new URLSearchParams(queryString);
        const ft = params.get('ft');
        const to = params.get('to');
        if (ft !== null && to !== null) {
          timeFreeQuery = { ft, to };
        }
      }

      libQ.resolve()
        .then(() => appRadio.progInfo(stationId, timeFreeQuery))
        .then((data: ProgInfoData | null) => {
          if (data !== null) {
            this.showProgInfoModal(data);
          }
          defer.resolve({});
        })
        .fail((error: any) => {
          this.logger.error('IDX_E007', error);
          defer.reject(error);
        });

      return defer.promise;
    }

    let task: Promise<BrowseResult> | null;
    if (baseUri === 'radiko') {
      task = appRadio.rootMenu();
    } else if (baseUri === 'radiko/live') {
      task = appRadio.radioStations();
    } else if (baseUri === 'radiko/timefree') {
      task = appRadio.timeFreeStations();
    } else if (segments[0] === 'radiko' && segments[1] === 'timetable' && segments[2] !== undefined) {
      task = appRadio.stationTimetable(segments[2]);
    } else {
      task = null;
    }

    if (task === null) {
      this.logger.error('IDX_E008');
      defer.resolve({});
      return defer.promise;
    }

    libQ.resolve()
      .then(() => task)
      .then((result: any) => defer.resolve(result))
      .fail((error: any) => {
        this.logger.error('IDX_E007', error);
        defer.reject(error);
      });

    return defer.promise;
  }

  /**
   * 番組情報モーダルを表示する。「再生」「キューに追加」ボタンは{@link playFromProgInfoModal}/
   * {@link addQueueFromProgInfoModal}を`callMethod`で呼び出し、`data`(explodeUriと同形式)をそのまま渡す。
   * @param data モーダルに表示する番組情報(再生キューへそのまま渡せる形式)。
   */
  private showProgInfoModal(data: ProgInfoData): void {
    let message = `<div>${data.artist}</div>`;
    if (data.album !== '') {
      message += `<div>${messageCatalog.get('PROGINFO_PERFORMER')}${data.album}</div>`;
    }
    const modalMessage = {
      title: messageCatalog.get('PROGINFO_PROG_INFO') + data.title,
      message,
      size: 'lg',
      buttons: [
        {
          name: messageCatalog.get('PROGINFO_PLAY'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'playFromProgInfoModal',
            data
          }
        },
        {
          name: messageCatalog.get('PROGINFO_ADD_TO_QUEUE'),
          class: 'btn btn-info',
          emit: 'callMethod',
          payload: {
            endpoint: `music_service/${this.serviceName}`,
            method: 'addQueueFromProgInfoModal',
            data
          }
        },
        {
          name: this.commandRouter.getI18nString('COMMON.CLOSE'),
          class: 'btn btn-warning',
          emit: 'closeModals',
          payload: ''
        }
      ]
    };
    this.commandRouter.broadcastMessage('openModal', modalMessage);
  }

  /**
   * 番組情報モーダルの「再生」ボタンから呼ばれる。対象トラックを再生キューの先頭に追加して即再生する。
   * @param data {@link showProgInfoModal}のボタンから渡されるトラック情報。
   */
  playFromProgInfoModal(data: any): void {
    this.logger.info('IDX_I007', data.uri);
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.unshift(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.volumioPushQueue(arrayQueue);
    this.commandRouter.volumioPlay(0);
  }

  /**
   * 番組情報モーダルの「キューに追加」ボタンから呼ばれる。対象トラックを再生キューの末尾に追加する。
   * @param data {@link showProgInfoModal}のボタンから渡されるトラック情報。
   */
  addQueueFromProgInfoModal(data: any): void {
    this.logger.info('IDX_I008', data.uri);
    const arrayQueue = this.commandRouter.stateMachine.playQueue.arrayQueue;
    arrayQueue.push(data);
    this.commandRouter.stateMachine.playQueue.arrayQueue = arrayQueue;
    this.commandRouter.stateMachine.playQueue.saveQueue();
    this.commandRouter.volumioPushQueue(arrayQueue);
  }

  /**
   * キューのトラック選択時に呼ばれ、mpdのキューをクリアして再生対象のURIを追加・再生する。
   * @param track 再生キュー内のトラック情報(`uri`を含む)。
   */
  clearAddPlayTrack(track: any): Promise<any> {
    this.logger.info('IDX_I009', track.uri);
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
   * @param timepos シーク先の再生位置(未使用)。
   */
  seek(timepos: number): Promise<any> {
    this.logger.info('IDX_I010', timepos);
    return libQ.reject();
  }

  /**
   * mpdへ再生停止コマンドを送る。
   */
  stop(): Promise<any> {
    this.logger.info('IDX_I011');
    return this.mpdPlugin.sendMpdCommand('stop', []);
  }

  /**
   * mpdへ一時停止コマンドを送る。
   */
  pause(): Promise<any> {
    this.logger.info('IDX_I012');
    return this.mpdPlugin.sendMpdCommand('pause', []);
  }

  /**
   * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
   */
  getState(): void {
    this.logger.info('IDX_I013');
  }

  /**
   * Volumioコアのインターフェース要件上必要だが、本プラグインでは未使用。
   */
  parseState(_sState: any): void {
    this.logger.info('IDX_I014');
  }

  /**
   * 再生状態をVolumioコアへプッシュする。
   * @param state プッシュする再生状態。
   */
  pushState(state: any): any {
    this.logger.info('IDX_I015');
    return this.commandRouter.servicePushState(state, this.serviceName);
  }

  /**
   * キュー内のURI(`http://localhost:9000/radiko/play/{stationID}`)を
   * clearAddPlayTrackが要求するトラック情報オブジェクトに展開する。
   * タイトルやアルバムアートなどの表示用メタデータはURIに含めず、{@link JpRadio.getTrackMeta}で都度取得し直す
   * (長い日本語テキストや画像URLをそのままURIに埋め込みたくないため)。
   * タイムフリー再生時は`?ft=&to=`クエリで放送区間を受け取る。
   * @param uri キュー内のURI。
   */
  explodeUri(uri: string): Promise<any> {
    this.logger.info('IDX_I016', uri);
    const defer = libQ.defer();

    // uri=http://localhost:9000/radiko/play/FMT[?ft=...&to=...]
    const parsedUri = new URL(uri);
    const segments = parsedUri.pathname.split('/');
    const serviceId = segments[1];
    const stationId = segments[3];
    const ft = parsedUri.searchParams.get('ft');
    const to = parsedUri.searchParams.get('to');

    const appRadio = this.appRadio;
    if (serviceId !== 'radiko' || appRadio === null) {
      defer.resolve();
      return defer.promise;
    }

    let timeFreeQuery: TimeFreeQuery | undefined;
    if (ft !== null && to !== null) {
      timeFreeQuery = { ft, to };
    } else {
      timeFreeQuery = undefined;
    }

    libQ.resolve()
      .then(() => appRadio.getTrackMeta(stationId, timeFreeQuery))
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
        this.logger.error('IDX_E009', error);
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
