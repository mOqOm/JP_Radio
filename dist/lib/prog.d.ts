import type { RadikoProgramData } from './models/RadikoProgramData';
export default class RdkProg {
    #private;
    private logger;
    private db;
    private station;
    private lastdt;
    private radikoProgData;
    constructor(logger: Console);
    getCurProgram(station: string): Promise<RadikoProgramData | null>;
    putProgram(prog: RadikoProgramData): Promise<void>;
    clearOldProgram(): Promise<void>;
    updatePrograms(): Promise<void>;
    dbClose(): Promise<void>;
    allData(): Promise<string>;
}
//# sourceMappingURL=prog.d.ts.map