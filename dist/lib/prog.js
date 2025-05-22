"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _RdkProg_instances, _RdkProg_initDBIndexes, _RdkProg_getCurrentTime, _RdkProg_getCurrentDate;
Object.defineProperty(exports, "__esModule", { value: true });
const date_fns_1 = require("date-fns");
const got_1 = __importDefault(require("got"));
const nedb_promises_1 = __importDefault(require("nedb-promises"));
const fast_xml_parser_1 = require("fast-xml-parser");
const util_1 = require("util");
const radikoUrls_1 = require("./consts/radikoUrls");
class RdkProg {
    constructor(logger) {
        _RdkProg_instances.add(this);
        this.db = nedb_promises_1.default.create({ inMemoryOnly: true });
        this.station = null;
        this.lastdt = null;
        this.radikoProgData = null;
        this.logger = logger;
        __classPrivateFieldGet(this, _RdkProg_instances, "m", _RdkProg_initDBIndexes).call(this);
    }
    async getCurProgram(station) {
        const curdt = __classPrivateFieldGet(this, _RdkProg_instances, "m", _RdkProg_getCurrentTime).call(this);
        if (station !== this.station || curdt !== this.lastdt) {
            try {
                const results = await this.db.find({
                    station,
                    ft: { $lte: curdt },
                    tt: { $gte: curdt }
                });
                const first = results[0];
                this.radikoProgData = isRadikoProgramData(first) ? first : null;
            }
            catch (error) {
                this.logger.error(`JP_Radio::DB Find Error for station ${station}`, error);
            }
            this.station = station;
            this.lastdt = curdt;
        }
        return this.radikoProgData;
    }
    async putProgram(prog) {
        try {
            await this.db.insert(prog);
        }
        catch (error) {
            if (error?.errorType !== 'uniqueViolated') {
                this.logger.error('JP_Radio::DB Insert Error', error);
            }
        }
    }
    async clearOldProgram() {
        const curdt = __classPrivateFieldGet(this, _RdkProg_instances, "m", _RdkProg_getCurrentTime).call(this);
        try {
            await this.db.remove({ tt: { $lt: curdt } }, { multi: true });
        }
        catch (error) {
            this.logger.error('JP_Radio::DB Delete Error', error);
        }
    }
    async updatePrograms() {
        const curDate = __classPrivateFieldGet(this, _RdkProg_instances, "m", _RdkProg_getCurrentDate).call(this);
        const xmlParser = new fast_xml_parser_1.XMLParser({
            attributeNamePrefix: '@',
            ignoreAttributes: false,
            allowBooleanAttributes: true
        });
        for (let i = 1; i <= 47; i++) {
            const areaID = `JP${i}`;
            const url = (0, util_1.format)(radikoUrls_1.PROG_URL, curDate, areaID);
            try {
                const response = await (0, got_1.default)(url);
                const data = xmlParser.parse(response.body);
                for (const stationData of data.radiko.stations.station) {
                    const stationName = stationData['@id'];
                    if (stationName === 'MAJAL')
                        continue;
                    for (const prog of stationData.progs.prog) {
                        await this.putProgram({
                            station: stationName,
                            id: stationName + prog['@id'],
                            ft: prog['@ft'],
                            tt: prog['@to'],
                            title: prog['title'],
                            pfm: prog['pfm'] || ''
                        });
                    }
                }
            }
            catch (error) {
                this.logger.error(`JP_Radio::Failed to update program for ${areaID}`, error);
            }
        }
    }
    async dbClose() {
        this.logger.info('JP_Radio::DB Compacting');
        await this.db.persistence.compactDatafile();
    }
    async allData() {
        const data = await this.db.find({});
        return JSON.stringify(data, null, 2);
    }
}
_RdkProg_instances = new WeakSet(), _RdkProg_initDBIndexes = function _RdkProg_initDBIndexes() {
    this.db.ensureIndex({ fieldName: 'id', unique: true });
    this.db.ensureIndex({ fieldName: 'station' });
    this.db.ensureIndex({ fieldName: 'ft' });
    this.db.ensureIndex({ fieldName: 'tt' });
}, _RdkProg_getCurrentTime = function _RdkProg_getCurrentTime() {
    return (0, date_fns_1.format)(new Date(), 'yyyyMMddHHmm');
}, _RdkProg_getCurrentDate = function _RdkProg_getCurrentDate() {
    return (0, date_fns_1.format)(new Date(), 'yyyyMMdd');
};
exports.default = RdkProg;
/**
 * 型チェックユーティリティ
 */
function isRadikoProgramData(data) {
    return (typeof data?.station === 'string' &&
        typeof data?.id === 'string' &&
        typeof data?.ft === 'string' &&
        typeof data?.tt === 'string' &&
        typeof data?.title === 'string' &&
        typeof data?.pfm === 'string');
}
//# sourceMappingURL=prog.js.map