"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("date-utils");
const util_1 = require("util");
const got_1 = __importDefault(require("got"));
const child_process_1 = require("child_process");
const tough = __importStar(require("tough-cookie"));
const fast_xml_parser_1 = require("fast-xml-parser");
const radikoUrls_1 = require("./consts/radikoUrls");
const xmlParser = new fast_xml_parser_1.XMLParser({
    attributeNamePrefix: '@',
    ignoreAttributes: false,
    removeNSPrefix: true,
    allowBooleanAttributes: true,
});
class Radiko {
    constructor(port, logger, acct) {
        this.port = port;
        this.logger = logger;
        this.acct = acct;
        this.token = null;
        this.areaID = null;
        this.cookieJar = null;
        this.loginState = null;
        this.stations = null;
        this.stationData = [];
        this.areaData = null;
    }
    async init(acct = null, forceGetStations = false) {
        this.cookieJar ?? (this.cookieJar = new tough.CookieJar());
        if (acct) {
            this.logger.info('JP_Radio::Attempting login');
            const loginOK = await this.checkLogin(this.cookieJar) ?? await this.login(acct).then(jar => this.checkLogin(jar));
            this.loginState = loginOK;
        }
        if (forceGetStations || !this.areaID) {
            const [token, areaID] = await this.getToken(this.cookieJar);
            this.token = token;
            this.areaID = areaID;
            await this.getStations();
        }
    }
    async login(acct) {
        const jar = new tough.CookieJar();
        try {
            await got_1.default.post(radikoUrls_1.LOGIN_URL, {
                cookieJar: jar,
                form: { mail: acct.mail, pass: acct.pass },
            });
            return jar;
        }
        catch (err) {
            if (err.statusCode === 302)
                return jar;
            this.logger.error('JP_Radio::Login failed', err);
            throw err;
        }
    }
    async checkLogin(jar) {
        try {
            const res = await got_1.default.get(radikoUrls_1.CHECK_URL, {
                cookieJar: jar,
                responseType: 'json',
            });
            const loginState = res.body;
            this.logger.info(`JP_Radio::Login status: ${loginState.member_type.type}`);
            return loginState;
        }
        catch (err) {
            if (err.statusCode === 400)
                return null;
            this.logger.warn('JP_Radio::Login check error', err);
            return null;
        }
    }
    async getToken(jar) {
        const auth1Headers = await this.auth1(jar);
        const [partialKey, token] = this.getPartialKey(auth1Headers);
        const result = await this.auth2(token, partialKey, jar);
        const [areaID] = result.trim().split(',');
        return [token, areaID];
    }
    async auth1(jar) {
        const res = await got_1.default.get(radikoUrls_1.AUTH1_URL, {
            cookieJar: jar,
            headers: {
                'X-Radiko-App': 'pc_html5',
                'X-Radiko-App-Version': '0.0.1',
                'X-Radiko-User': 'dummy_user',
                'X-Radiko-Device': 'pc',
            },
        });
        return res.headers;
    }
    getPartialKey(headers) {
        const token = headers['x-radiko-authtoken'];
        const offset = parseInt(headers['x-radiko-keyoffset'], 10);
        const length = parseInt(headers['x-radiko-keylength'], 10);
        const partialKey = Buffer.from(radikoUrls_1.AUTH_KEY.slice(offset, offset + length)).toString('base64');
        return [partialKey, token];
    }
    async auth2(token, partialKey, jar) {
        const res = await got_1.default.get(radikoUrls_1.AUTH2_URL, {
            cookieJar: jar,
            headers: {
                'X-Radiko-AuthToken': token,
                'X-Radiko-Partialkey': partialKey,
                'X-Radiko-User': 'dummy_user',
                'X-Radiko-Device': 'pc',
            },
        });
        return res.body;
    }
    async getStations() {
        this.stations = new Map();
        this.areaData = new Map();
        const fullRes = await (0, got_1.default)(radikoUrls_1.CHANNEL_FULL_URL);
        const fullParsed = xmlParser.parse(fullRes.body);
        const regionData = [];
        for (const region of fullParsed.region.stations) {
            regionData.push({
                region,
                stations: region.station.map((s) => ({
                    id: s.id,
                    name: s.name,
                    ascii_name: s.ascii_name,
                    areafree: s.areafree,
                    timefree: s.timefree,
                    banner: s.banner,
                    area_id: s.area_id,
                })),
            });
        }
        for (let i = 1; i <= 47; i++) {
            const areaID = `JP${i}`;
            const res = await (0, got_1.default)((0, util_1.format)(radikoUrls_1.CHANNEL_AREA_URL, areaID));
            const parsed = xmlParser.parse(res.body);
            const stations = parsed.stations.station.map((s) => s.id);
            this.areaData.set(areaID, {
                areaName: parsed.stations['@area_name'],
                stations,
            });
        }
        for (const region of regionData) {
            for (const station of region.stations) {
                const id = station.id;
                const areaName = this.areaData?.get(station.area_id)?.areaName?.replace(' JAPAN', '') ?? '';
                const allowedStations = this.areaData?.get(this.areaID ?? '')?.stations.map(String) ?? [];
                if (this.loginState || allowedStations.includes(id)) {
                    this.stations.set(id, {
                        RegionName: region.region.region_name,
                        BannerURL: station.banner,
                        AreaID: station.area_id,
                        AreaName: areaName,
                        Name: station.name,
                        AsciiName: station.ascii_name,
                    });
                }
            }
        }
        this.stationData = regionData;
    }
    async getStationAsciiName(stationID) {
        return this.stations?.get(stationID)?.AsciiName ?? '';
    }
    async play(station) {
        if (!this.stations?.has(station)) {
            this.logger.warn(`JP_Radio::Station not found: ${station}`);
            return null;
        }
        let m3u8 = null;
        for (let i = 0; i < radikoUrls_1.MAX_RETRY_COUNT; i++) {
            if (!this.token)
                [this.token, this.areaID] = await this.getToken(this.cookieJar);
            m3u8 = await this.genTempChunkM3u8URL((0, util_1.format)(radikoUrls_1.PLAY_URL, station), this.token);
            if (m3u8)
                break;
            this.logger.info('JP_Radio::Retrying stream fetch with new token');
            [this.token, this.areaID] = await this.getToken(this.cookieJar);
        }
        if (!m3u8) {
            this.logger.error('JP_Radio::Failed to get playlist URL');
            return null;
        }
        const args = [
            '-y',
            '-headers', `X-Radiko-Authtoken:${this.token}`,
            '-i', m3u8,
            '-acodec', 'copy',
            '-f', 'adts',
            '-loglevel', 'error',
            'pipe:1',
        ];
        return (0, child_process_1.spawn)('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore', 'ipc'], detached: true });
    }
    async genTempChunkM3u8URL(url, token) {
        try {
            const res = await (0, got_1.default)(url, {
                headers: {
                    'X-Radiko-AuthToken': token,
                    'X-Radiko-App': 'pc_html5',
                    'X-Radiko-App-Version': '0.0.1',
                    'X-Radiko-User': 'dummy_user',
                    'X-Radiko-Device': 'pc',
                },
            });
            return res.body.split('\n').find(line => line.startsWith('http') && line.endsWith('.m3u8')) ?? null;
        }
        catch (err) {
            this.logger.error('JP_Radio::genTempChunkM3u8URL error', err);
            return null;
        }
    }
    async getProgramDaily(station, date) {
        const res = await (0, got_1.default)((0, util_1.format)(radikoUrls_1.PROG_DAILY_URL, station, date));
        return xmlParser.parse(res.body);
    }
}
exports.default = Radiko;
//# sourceMappingURL=radiko.js.map