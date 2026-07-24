import type { Response } from 'express';
import type { ChildProcess } from 'child_process';
import Radiko from './radiko-service';
import type { TimeFreeQuery } from '@/models/time-free-query-model';

/**
 * 1回分の再生リクエストに対するffmpegプロセスのライフサイクルを管理する。
 * ライブ配信は、Radiko側のライブHLSプレイリスト更新の都合でffmpegが数十秒おきに正常終了(code=0)
 * してしまうことがあるため、クライアント(MPD)が接続を切っていない限り同じ局へ自動的に繋ぎ直す。
 * タイムフリー(`timeFreeQuery`指定時)は有限のクリップなので、ffmpegが終了したらそこで再生終了とし、
 * ライブのような自動再接続は行わない。
 */
export default class StreamSession {
  private stopped = false;
  private currentFfmpeg: ChildProcess | null = null;
  private firstAttempt = true;

  /**
   * @param rdk ストリーム起動に使うModel層。
   * @param station 局ID。
   * @param logger ログ出力先。
   * @param onFirstStreamStarted 最初のffmpegプロセスが起動できた直後に1回だけ呼ばれる。
   * @param onStopped セッションが終了した(クライアント切断/タイムフリー再生終了)時に呼ばれる。
   * @param timeFreeQuery 指定するとタイムフリー再生を、指定しなければライブ再生を行う。
   * @param tempo タイムフリー再生の速度倍率。
   * @param resumeSeek 指定すると、タイムフリー再生をこの実時刻(`'yyyyMMddHHmmss'`)から開始する(途中再開用)。
   */
  constructor(
    private readonly rdk: Radiko,
    private readonly station: string,
    private readonly logger: Console,
    private readonly onFirstStreamStarted: () => void,
    private readonly onStopped: () => void,
    private readonly timeFreeQuery?: TimeFreeQuery,
    private readonly tempo?: number,
    private readonly resumeSeek?: string,
  ) { }

  /**
   * レスポンスの切断監視を仕込み、最初のffmpegプロセスを起動する。
   * @param res ストリームをパイプする先のレスポンス。
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
   * @param res ストリームをパイプする先のレスポンス。
   */
  async #spawnFfmpeg(res: Response): Promise<void> {
    if (this.stopped === true) {
      return;
    }

    try {
      const ffmpeg = await this.rdk.play(this.station, this.timeFreeQuery, this.tempo, this.resumeSeek);

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
        if (this.timeFreeQuery !== undefined) {
          // タイムフリーは有限のクリップなので、ffmpeg終了=再生終了として扱い、ライブのような再接続はしない
          this.logger.info('JP_Radio::StreamSession: time-free stream finished');
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
