import { LoggerEx } from '../../src/utils/logger';
import { Logger } from 'volumio-logger';

describe('LoggerEx', () => {
    let logger: LoggerEx;

    beforeEach(() => {
        const dummyLogger: Logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        } as unknown as Logger;
        logger = new LoggerEx(dummyLogger, 'jp_radio');
    });

    test('debug logs forced debug message', () => {
        logger.enableForceDebug(true);
        logger.debug('TEST001', 'Hello');
        expect((logger as any).logger.info).toHaveBeenCalled();
    });
});
