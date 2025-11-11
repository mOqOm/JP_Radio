// types/volumio-logger.d.ts
declare module 'volumio-logger' {
  export interface Logger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  }
}
