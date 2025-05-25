import type { RadikoProgramData } from './models/RadikoProgramData';
export default class RdkProg {
    private logger;
    private db;
    private lastStation;
    private lastTime;
    private cachedProgram;
    constructor(logger: Console);
    private initDBIndexes;
    getCurProgram(station: string): Promise<RadikoProgramData | null>;
    putProgram(prog: RadikoProgramData): Promise<void>;
    clearOldProgram(): Promise<void>;
    updatePrograms(): Promise<void>;
    dbClose(): Promise<void>;
    allData(): Promise<string>;
    private getCurrentTime;
    private getCurrentDate;
}
//# sourceMappingURL=prog.d.ts.map