import got from 'got';
import * as tough from 'tough-cookie';
import { CookieJar } from 'tough-cookie';
import { LOGIN_URL, CHECK_URL, AUTH1_URL, AUTH2_URL, AUTH_KEY } from '@/constants/radiko-urls.constants';
import type { LoginAccount, LoginState } from '@/models/auth.model';
import { LoggerEx } from '@/utils/logger.util';

export class RadikoAuthLogic {
  private cookieJar: CookieJar = new tough.CookieJar();
  private logger: LoggerEx;

  constructor(logger: LoggerEx) {
    this.logger = logger;
  }

  /** ログイン状態チェック */
  public async checkLogin(): Promise<LoginState | null> {
    if (!this.cookieJar) {
      return null;
    }

    try {
      const response = await got(CHECK_URL, {
        cookieJar: this.cookieJar,
        method: 'GET',
        responseType: 'json'
      });

      return response.body as LoginState;
    } catch (err: any) {
      const statusCode = err?.response?.statusCode;

      if (statusCode === 400) {
        return null;
      }

      // HTTPステータスが400以外の場合
      this.logger.error('RADI0001E0002', err);
      return null;
    }
  }

  /** 認証してCookieJarを取得 */
  public async login(acct: LoginAccount): Promise<CookieJar> {
    const jar = new tough.CookieJar();

    try {
      await got.post(LOGIN_URL, { cookieJar: jar, form: acct });
      return jar;
    } catch (err: any) {
      if (err.statusCode === 302) {
        return jar;
      }

      // HTTPステータスが302以外の場合
      this.logger.error('RADI0001E0001', err);
      throw err;
    }
  }

  /** トークン取得 */
  public async getToken(): Promise<[string, string]> {
    const auth1Headers: Record<string, string> = await this.auth1();

    const [partialKey, token]: [string, string] = this.getPartialKey(auth1Headers);

    const result: string = await this.auth2(token, partialKey);

    const [areaId]: string[] = result.trim().split(',');

    return [token, areaId];
  }

  /** Auth1取得 */
  private async auth1(): Promise<Record<string, string>> {

    const res = await got.get(AUTH1_URL, {
      cookieJar: this.cookieJar,
      headers: {
        'X-Radiko-App': 'pc_html5',
        'X-Radiko-App-Version': '0.0.1',
        'X-Radiko-User': 'dummy_user',
        'X-Radiko-Device': 'pc',
      },
    });

    return res.headers as Record<string, string>;
  }

  /** Auth2取得 */
  private async auth2(token: string, partialKey: string): Promise<string> {

    const res = await got.get(AUTH2_URL, {
      cookieJar: this.cookieJar,
      headers: {
        'X-Radiko-AuthToken': token,
        'X-Radiko-Partialkey': partialKey,
        'X-Radiko-User': 'dummy_user',
        'X-Radiko-Device': 'pc',
      },
    });

    return res.body;
  }

  /** PartialKey計算 */
  private getPartialKey(headers: Record<string, string>): [string, string] {
    const token: string = headers['x-radiko-authtoken'];
    const offset: number = parseInt(headers['x-radiko-keyoffset'], 10);
    const length: number = parseInt(headers['x-radiko-keylength'], 10);

    const partialKey = Buffer.from(AUTH_KEY.slice(offset, offset + length)).toString('base64');

    return [partialKey, token];
  }

  /** CookieJarセット */
  public setCookieJar(jar: CookieJar) {
    this.cookieJar = jar;
  }

  /** CookieJar取得 */
  public getCookieJar(): CookieJar {
    return this.cookieJar;
  }
}
