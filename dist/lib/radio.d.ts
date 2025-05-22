export default class JpRadio {
    #private;
    private task;
    private app;
    private server;
    private port;
    private logger;
    private acct;
    private prg;
    private rdk;
    constructor(port: number | undefined, logger: Console, acct?: any);
    radioStations(): any[];
    start(): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=radio.d.ts.map