"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const kew_1 = __importDefault(require("kew"));
const v_conf_1 = __importDefault(require("v-conf"));
const radio_1 = __importDefault(require("./lib/radio"));
class ControllerJpRadio {
    constructor(context) {
        this.serviceName = 'jp_radio';
        this.context = context;
        this.commandRouter = context.coreCommand;
        this.logger = context.logger;
        this.configManager = context.configManager;
    }
    restartPlugin() {
        this.onStop().then(() => {
            this.onStart().catch(() => {
                this.commandRouter.pushToastMessage('error', 'Restart Failed', 'The plugin could not be restarted.');
            });
        });
    }
    showRestartModal() {
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
    saveServicePort(data) {
        const newPort = parseInt(data['servicePort']);
        if (!isNaN(newPort) && this.config.get('servicePort') !== newPort) {
            this.config.set('servicePort', newPort);
            this.showRestartModal();
        }
        return kew_1.default.resolve();
    }
    saveRadikoAccount(data) {
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
        return kew_1.default.resolve();
    }
    onVolumioStart() {
        const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
        this.config = new v_conf_1.default();
        this.config.loadFile(configFile);
        return kew_1.default.resolve();
    }
    onStart() {
        const radikoUser = this.config.get('radikoUser');
        const radikoPass = this.config.get('radikoPass');
        const servicePort = this.config.get('servicePort') || 9000;
        const account = (radikoUser && radikoPass) ? { mail: radikoUser, pass: radikoPass } : null;
        this.appRadio = new radio_1.default(servicePort, this.logger, account);
        this.appRadio.start();
        this.addToBrowseSources();
        return kew_1.default.resolve();
    }
    onStop() {
        this.appRadio.stop();
        this.commandRouter.volumioRemoveToBrowseSources('RADIKO');
        return kew_1.default.resolve();
    }
    onRestart() { }
    getUIConfig() {
        const defer = kew_1.default.defer();
        const lang_code = this.commandRouter.sharedVars.get('language_code');
        this.commandRouter.i18nJson(`${__dirname}/i18n/strings_${lang_code}.json`, `${__dirname}/i18n/strings_en.json`, `${__dirname}/UIConfig.json`).then((uiconf) => {
            uiconf.sections[0].content[0].value = this.config.get('servicePort');
            uiconf.sections[1].content[0].value = this.config.get('radikoUser');
            uiconf.sections[1].content[1].value = this.config.get('radikoPass');
            defer.resolve(uiconf);
        }).fail(() => {
            defer.reject(new Error());
        });
        return defer.promise;
    }
    getConfigurationFiles() {
        return ['config.json'];
    }
    setUIConfig(data) { }
    getConf(varName) { }
    setConf(varName, varValue) { }
    addToBrowseSources() {
        this.commandRouter.volumioAddToBrowseSources({
            name: 'RADIKO',
            uri: 'radiko',
            plugin_type: 'music_service',
            plugin_name: this.serviceName,
            albumart: '/albumart?sourceicon=music_service/jp_radio/assets/images/app_radiko.svg'
        });
    }
    handleBrowseUri(curUri) {
        if (curUri === 'radiko') {
            return kew_1.default.resolve({
                navigation: {
                    lists: [{
                            title: 'LIVE',
                            availableListViews: ['grid', 'list'],
                            items: this.appRadio.radioStations()
                        }]
                }
            });
        }
        return kew_1.default.resolve();
    }
    clearAddPlayTrack(track) {
        this.logger.info(`[${Date.now()}] JP_Radio::clearAddPlayTrack\n${JSON.stringify(track)}`);
        return kew_1.default.resolve();
    }
    seek(timepos) {
        this.logger.info(`[${Date.now()}] JP_Radio::seek to ${timepos}`);
        return kew_1.default.resolve();
    }
    stop() {
        this.logger.info(`[${Date.now()}] JP_Radio::stop`);
    }
    pause() {
        this.logger.info(`[${Date.now()}] JP_Radio::pause`);
    }
    getState() {
        this.logger.info(`[${Date.now()}] JP_Radio::getState`);
    }
    parseState(sState) {
        this.logger.info(`[${Date.now()}] JP_Radio::parseState`);
    }
    pushState(state) {
        this.logger.info(`[${Date.now()}] JP_Radio::pushState`);
        return this.commandRouter.servicePushState(state, this.serviceName);
    }
    explodeUri(uri) {
        return kew_1.default.resolve();
    }
    search(query) {
        return kew_1.default.resolve();
    }
    _searchArtists(results) { }
    _searchAlbums(results) { }
    _searchPlaylists(results) { }
    _searchTracks(results) { }
    goto(data) {
        return kew_1.default.resolve();
    }
}
module.exports = ControllerJpRadio;
//# sourceMappingURL=index.js.map