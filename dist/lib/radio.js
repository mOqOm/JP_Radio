"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _JpRadio_instances, _JpRadio_setupRoutes, _JpRadio_init, _JpRadio_pgupdate;
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prog_1 = __importDefault(require("./prog"));
const radiko_1 = __importDefault(require("./radiko"));
const node_cron_1 = __importDefault(require("node-cron"));
const icy_metadata_1 = __importDefault(require("icy-metadata"));
const lodash_1 = require("lodash");
class JpRadio {
    constructor(port = 9000, logger, acct = null) {
        _JpRadio_instances.add(this);
        this.server = null;
        this.prg = null;
        this.rdk = null;
        this.app = (0, express_1.default)();
        this.port = port;
        this.logger = logger;
        this.acct = acct;
        this.task = node_cron_1.default.schedule('0 3,9,15 * * *', async () => {
            try {
                await __classPrivateFieldGet(this, _JpRadio_instances, "m", _JpRadio_pgupdate).call(this);
            }
            catch (e) {
                this.logger.error('JP_Radio::cron task failed', e);
            }
        }, { scheduled: false });
        __classPrivateFieldGet(this, _JpRadio_instances, "m", _JpRadio_setupRoutes).call(this);
    }
    radioStations() {
        if (!this.rdk?.stations) {
            return [];
        }
        const radikoPlayLists = [];
        for (const [stationId, stationInfo] of this.rdk.stations.entries()) {
            const title = `${(0, lodash_1.capitalize)(stationInfo.AreaName)} / ${stationInfo.Name}`;
            radikoPlayLists.push({
                service: 'webradio',
                type: 'song',
                title: title,
                albumart: stationInfo.BannerURL,
                uri: `http://localhost:${this.port}/radiko/${stationId}`,
                name: '',
                samplerate: '',
                bitdepth: 0,
                channels: 0
            });
        }
        return radikoPlayLists;
    }
    async start() {
        if (this.server) {
            this.logger.info('JP_Radio::App already started');
            return;
        }
        this.prg = new prog_1.default(this.logger);
        this.rdk = new radiko_1.default(this.port, this.logger, this.acct);
        await __classPrivateFieldGet(this, _JpRadio_instances, "m", _JpRadio_init).call(this);
        return new Promise((resolve, reject) => {
            this.server = this.app
                .listen(this.port, () => {
                this.logger.info(`JP_Radio::App is listening on port ${this.port}.`);
                this.task.start();
                resolve();
            })
                .on('error', (err) => {
                this.logger.error('JP_Radio::App error:', err);
                reject(err);
            });
        });
    }
    async stop() {
        if (this.server) {
            this.task.stop();
            this.server.close();
            this.server = null;
            await this.prg?.dbClose();
            this.prg = null;
            this.rdk = null;
        }
    }
}
_JpRadio_instances = new WeakSet(), _JpRadio_setupRoutes = function _JpRadio_setupRoutes() {
    this.app.get('/radiko/:stationID', async (req, res) => {
        try {
            if (!this.rdk) {
                this.logger.error('JP_Radio::Radiko instance not initialized');
                res.status(500).send('Server error');
                return;
            }
            const station = req.params['stationID'];
            if (!this.rdk.stations?.has(station)) {
                const msg = `JP_Radio::${station} not in available stations`;
                this.logger.error(msg);
                res.status(404).send(msg);
                return;
            }
            const icyMetadata = new icy_metadata_1.default();
            const ffmpeg = await this.rdk.play(station);
            if (!ffmpeg) {
                res.status(500).send('Failed to start stream');
                return;
            }
            // プロセス終了監視用フラグ
            let ffmpegExited = false;
            ffmpeg.on('exit', () => {
                ffmpegExited = true;
                this.logger.debug(`ffmpeg process ${ffmpeg.pid} exited.`);
            });
            res.setHeader('Cache-Control', 'no-cache, no-store');
            res.setHeader('icy-name', await this.rdk.getStationAsciiName(station));
            res.setHeader('icy-metaint', icyMetadata.metaInt);
            res.setHeader('Content-Type', 'audio/aac');
            res.setHeader('Connection', 'keep-alive');
            const progData = await this.prg?.getCurProgram(station);
            const title = progData ? `${progData.pfm || ''} - ${progData.title || ''}` : null;
            if (title)
                icyMetadata.setStreamTitle(title);
            if (ffmpeg.stdout) {
                this.logger.info('JP_Radio::ffmpeg stdout');
                ffmpeg.stdout.pipe(icyMetadata).pipe(res);
            }
            else {
                this.logger.error('JP_Radio::ffmpeg stdout is null');
                res.status(500).send('Internal server error');
                return;
            }
            res.on('close', () => {
                if (ffmpeg.pid && !ffmpegExited) {
                    try {
                        // プロセスグループをSIGTERMでkill
                        process.kill(-ffmpeg.pid, 'SIGTERM');
                        this.logger.info(`Sent SIGTERM to ffmpeg process group ${ffmpeg.pid}`);
                    }
                    catch (e) {
                        if (e.code === 'ESRCH') {
                            // プロセスは既に終了しているので問題なし
                            this.logger.info(`ffmpeg process ${ffmpeg.pid} already exited.`);
                        }
                        else {
                            this.logger.warn(`Failed to kill ffmpeg process ${ffmpeg.pid}`, e);
                        }
                    }
                }
            });
            this.logger.info('JP_Radio::get returning response');
        }
        catch (err) {
            this.logger.error('JP_Radio::error in /radiko/:stationID handler', err);
            res.status(500).send('Internal server error');
        }
    });
    this.app.get('/radiko/', (req, res) => {
        res.send("Hello, world. You're at the radiko_app index.");
    });
}, _JpRadio_init = async function _JpRadio_init() {
    if (this.rdk)
        await this.rdk.init(this.acct);
    await __classPrivateFieldGet(this, _JpRadio_instances, "m", _JpRadio_pgupdate).call(this);
}, _JpRadio_pgupdate = async function _JpRadio_pgupdate() {
    this.logger.info('JP_Radio::Updating program listings');
    await this.prg?.updatePrograms();
    await this.prg?.clearOldProgram();
};
exports.default = JpRadio;
//# sourceMappingURL=radio.js.map