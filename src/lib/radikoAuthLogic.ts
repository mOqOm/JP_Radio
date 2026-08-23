"use strict";
import 'date-utils';
import { format } from 'util';
import got, { OptionsOfJSONResponseBody, Response } from 'got';
import * as tough from 'tough-cookie';
import { CookieJar } from 'tough-cookie';

import type { LoginAccount, LoginState } from './models/AuthModel';
import {
  LOGIN_URL, CHECK_URL, AUTH1_URL, AUTH2_URL, AUTH_KEY
} from './consts/radikoUrls';

export class RadikoAuthLogic {
  private readonly logger: Console;
  private cookieJar: CookieJar;
  private token: string = '';
  private myAreaId: string = '';
  private myAreaName: string = '';
  private lastTime: number = 0;

  constructor(logger: Console) {
    this.logger = logger;
  }

  public async login(acct: LoginAccount): Promise<CookieJar> {
    this.logger.info('JP_Radio::RadikoAuthLogic.login');
    const jar = new tough.CookieJar();
    try {
      await got.post(LOGIN_URL, {
        cookieJar: jar,
        form: acct
      });
      this.cookieJar = jar;
      return jar;

    } catch (err: any) {
      if (err.statusCode === 302) {
        this.cookieJar = jar;
        return jar;
      }
      this.logger.error('JP_Radio::Login failed', err);
      throw err;
    }
  }

  public async checkLogin(): Promise<LoginState | null> {
    this.logger.info('JP_Radio::RadikoAuthLogic.checkLogin');
    if (!this.cookieJar) {
      this.logger.info('JP_Radio::RadikoAuthLogic: premium account not set');
      return null;
    }

    try {
      const options: OptionsOfJSONResponseBody = {
        cookieJar: this.cookieJar,
        method: 'GET',
        responseType: 'json'
      };
      // TODO: エリアフリー・タイムフリー30・ダブルプランはここで判別できるのか？？？
      const response: Response<any> = await got(CHECK_URL, options);
      const loginState: LoginState = response.body as LoginState;
      this.logger.info(format('JP_Radio::Radiko.checkLogin: loginState=%o', loginState));
      // loginState={
      //    user_key: 'xxxxxxx',
      //    areafree: '1',
      //    status: '200',
      //    member_type: {
      //      type: 'AreaFree',
      //      name: 'エリアフリープラン' 
      //    },
      //    expired: '0',
      //    paid_member: '1'
      // }
      return loginState;

    } catch (err: any) {
      const statusCode = err?.response?.statusCode;
      if (statusCode === 400) {
        this.logger.info('JP_Radio::RadikoAuthLogic.checkLogin: premium not logged in (HTTP 400)');
        return null;
      }

      this.logger.error(`JP_Radio::RadikoAuthLogic.checkLogin: premium account login check error: ${err.message}`, err);
      return null;
    }
  }

  public async getToken(): Promise<[string, string]> {
    this.logger.info('JP_Radio::RadikoAuthLogic.getToken...');
    const currentTime = Date.now();
    if(currentTime - this.lastTime > 3600000) {
      // 1H過ぎていたら再認証
      const auth1Headers = await this.auth1();
      const [partialKey, token] = this.getPartialKey(auth1Headers);
      [this.myAreaId, this.myAreaName] = await this.auth2(token, partialKey);
      this.token = token;
      this.lastTime = currentTime;
      this.logger.info(`JP_Radio::RadikoAuthLogic.getToken: token=${this.token}, area=${this.myAreaId}/${this.myAreaName}`);
    } else {
      // 1H以内ならキャッシュを返す
      this.logger.info('JP_Radio::RadikoAuthLogic.getToken skip');
    }
    return [this.token, this.myAreaId];
  }

  private async auth1(): Promise<Record<string, string>> {
    this.logger.info('JP_Radio::RadikoAuthLogic.auth1');
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

  private getPartialKey(headers: Record<string, string>): [string, string] {
    this.logger.info('JP_Radio::RadikoAuthLogic.getPartialKey');
    const token = headers['x-radiko-authtoken'];
    const offset = parseInt(headers['x-radiko-keyoffset'], 10);
    const length = parseInt(headers['x-radiko-keylength'], 10);
    const partialKey = Buffer.from(AUTH_KEY.slice(offset, offset + length)).toString('base64');
    return [partialKey, token];
  }

  private async auth2(token: string, partialKey: string): Promise<string[]> {
    this.logger.info('JP_Radio::RadikoAuthLogic.auth2');
    const res = await got.get(AUTH2_URL, {
      cookieJar: this.cookieJar,
      headers: {
        'X-Radiko-AuthToken': token,
        'X-Radiko-Partialkey': partialKey,
        'X-Radiko-User': 'dummy_user',
        'X-Radiko-Device': 'pc',
      },
    });
    return res.body.trim().split(',');  // "JP13,東京都,tokyo Japan"
  }

  public getMyArea(): [string, string] {
    return [this.myAreaId, this.myAreaName];
  }

}
