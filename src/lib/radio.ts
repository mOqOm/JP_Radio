import express, { Application, Request, Response } from 'express';
import RdkProg from './prog';
import Radiko from './radiko';
import cron from 'node-cron';
import IcyMetadata from 'icy-metadata';
import { capitalize } from 'lodash';

export default class JpRadio {
  private task: ReturnType<typeof cron.schedule>;
  private app: Application;
  private server: any = null;
  private port: number;
  private logger: Console;
  private acct: any;
  private prg: RdkProg | null = null;
  private rdk: Radiko | null = null;

  constructor(port: number = 9000, logger: Console, acct: any = null) {
    this.app = express();
    this.port = port;
    this.logger = logger;
    this.acct = acct;

    this.task = cron.schedule(
      '0 3,9,15 * * *',
      async () => {
        try {
          await this.#pgupdate();
        } catch (e) {
          this.logger.error('JP_Radio::cron task failed', e);
        }
      },
      { scheduled: false }
    );

    this.#setupRoutes();
  }

  #setupRoutes() {
    this.app.get('/radiko/:stationID', async (req: Request, res: Response) => {
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

        const icyMetadata = new IcyMetadata();
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
        if (title) icyMetadata.setStreamTitle(title);

        if (ffmpeg.stdout) {
          this.logger.info('JP_Radio::ffmpeg stdout');
          ffmpeg.stdout.pipe(icyMetadata).pipe(res);
        } else {
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
            } catch (e: any) {
              if (e.code === 'ESRCH') {
                // プロセスは既に終了しているので問題なし
                this.logger.info(`ffmpeg process ${ffmpeg.pid} already exited.`);
              } else {
                this.logger.warn(`Failed to kill ffmpeg process ${ffmpeg.pid}`, e);
              }
            }
          }
        });

        this.logger.info('JP_Radio::get returning response');
      } catch (err) {
        this.logger.error('JP_Radio::error in /radiko/:stationID handler', err);
        res.status(500).send('Internal server error');
      }
    });

    this.app.get('/radiko/', (req: Request, res: Response) => {
      res.send("Hello, world. You're at the radiko_app index.");
    });
  }

  radioStations(): any[] {
    if (!this.rdk?.stations) {
      return [];
    }

    const radikoPlayLists = [];

    for (const [stationId, stationInfo] of this.rdk.stations.entries()) {
      const title = `${capitalize(stationInfo.AreaName)} / ${stationInfo.Name}`;

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

  async start(): Promise<void> {
    if (this.server) {
      this.logger.info('JP_Radio::App already started');
      return;
    }

    this.prg = new RdkProg(this.logger);
    this.rdk = new Radiko(this.port, this.logger, this.acct);
    await this.#init();

    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, () => {
          this.logger.info(`JP_Radio::App is listening on port ${this.port}.`);
          this.task.start();
          resolve();
        })
        .on('error', (err: any) => {
          this.logger.error('JP_Radio::App error:', err);
          reject(err);
        });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.task.stop();
      this.server.close();
      this.server = null;

      await this.prg?.dbClose();
      this.prg = null;
      this.rdk = null;
    }
  }

  async #init(): Promise<void> {
    if (this.rdk) await this.rdk.init(this.acct);
    await this.#pgupdate();
  }

  async #pgupdate(): Promise<void> {
    this.logger.info('JP_Radio::Updating program listings');
    await this.prg?.updatePrograms();
    await this.prg?.clearOldProgram();
  }
}
