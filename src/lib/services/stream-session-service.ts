import type { Response } from 'express';
import type { ChildProcess } from 'child_process';
import Radiko from './radiko-service';
import type { TimefreeQuery } from '@/models/timefree-query-model';

/**
 * 1回分の再生リクエストに対するffmpegプロセスのライフサイクルを管理する。
 * ライブ配信は、Radiko側のライブHLSプレイリスト更新の都合でffmpegが数十秒おきに正常終了(code=0)
 * してしまうことがあるため、クライアント(MPD)が接続を切っていない限り同じ局へ自動的に繋ぎ直す。
 * タイムフリー(`timefreeQuery`指定時)は有限のクリップなので、ffmpegが終了したらそこで再生終了とし、
 * ライブのような自動再接続は行わない。
 */
export default class StreamSession {
  private stopped = false;
  private currentFfmpeg: ChildProcess | null = null;
  private firstAttempt = true;

  constructor(
    private readonly rdk: Radiko,
    private readonly station: string,
    private readonly logger: Console,
    private readonly onFirstStreamStarted: () => void,
    private readonly onStopped: () => void,
    private readonly timefreeQuery?: TimefreeQuery,
  ) { }

  /**
   * レスポンスの切断監視を仕込み、最初のffmpegプロセスを起動する。
   */
  start(res: Response): void {
    res.on('close', () => this.#handleClose());
    res.on('error', (error: any) => {
      this.logger.error(`JP_Radio::StreamSession: res error: ${error.message}`);
    });

    this.#spawnFfmpeg(res);
  }

  /**
   * クライアント切断時に自動再接続を止め、実行中のffmpegプロセスグループへSIGTERMを送る。
   */
  #handleClose(): void {
    this.stopped = true;
    this.onStopped();
    this.logger.info('JP_Radio::StreamSession: res.on(close)');
    if (this.currentFfmpeg?.pid !== undefined) {
      try {
        process.kill(-this.currentFfmpeg.pid, 'SIGTERM');
        this.logger.info(`JP_Radio::StreamSession: SIGTERM sent to ffmpeg group ${this.currentFfmpeg.pid}`);
      } catch (error: any) {
        let reason: string;
        if (error.code === 'ESRCH') {
          reason = 'Already exited';
        } else {
          reason = error.message;
        }
        this.logger.warn(`JP_Radio::StreamSession: Kill ffmpeg failed: ${reason}`);
      }
    }
  }

  /**
   * ffmpegを起動してstdoutをレスポンスへパイプする。切断されていない状態でffmpegが終了した場合、
   * 同じ{@link Response}へ`{ end: false }`でパイプし続けることでクライアントに途切れを見せずに再接続する。
   */
  async #spawnFfmpeg(res: Response): Promise<void> {
    if (this.stopped === true) {
      return;
    }

    try {
      const ffmpeg = await this.rdk.play(this.station, this.timefreeQuery);

      if (ffmpeg === null || ffmpeg.stdout === null) {
        this.logger.error('JP_Radio::StreamSession: ffmpeg start failed or stdout is null');
        if (this.firstAttempt === true && res.headersSent === false) {
          res.status(500).send('Stream start error');
        }
        return;
      }

      this.currentFfmpeg = ffmpeg;

      ffmpeg.on('exit', (code, signal) => {
        this.logger.info(`JP_Radio::StreamSession: ffmpeg process ${ffmpeg.pid} exited. code=${code} signal=${signal}`);
        if (this.stopped === true) {
          return;
        }
        if (this.timefreeQuery !== undefined) {
          // タイムフリーは有限のクリップなので、ffmpeg終了=再生終了として扱い、ライブのような再接続はしない
          this.logger.info('JP_Radio::StreamSession: timefree stream finished');
          this.stopped = true;
          this.onStopped();
          res.end();
          return;
        }
        this.logger.info('JP_Radio::StreamSession: stream still connected, restarting ffmpeg');
        setTimeout(() => this.#spawnFfmpeg(res), 500);
      });
      ffmpeg.stderr?.on('data', (chunk: Buffer) => {
        this.logger.error(`JP_Radio::StreamSession: ffmpeg stderr: ${chunk.toString().trim()}`);
      });
      ffmpeg.stdout.pipe(res, { end: false });
      this.logger.info(`JP_Radio::StreamSession: ffmpeg=${ffmpeg.pid}`);

      if (this.firstAttempt === true) {
        this.firstAttempt = false;
        this.onFirstStreamStarted();
        this.logger.info('JP_Radio::StreamSession: Streaming started');
      }
    } catch (error: any) {
      this.logger.error('JP_Radio::StreamSession: Stream error', error);
      if (this.firstAttempt === true && res.headersSent === false) {
        res.status(500).send('Internal server error');
      }
    }
  }
}
