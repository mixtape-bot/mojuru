import { Human, Logger } from "caterpillar";
import type * as ansi from "@bevry/ansi";

const levels = {
    emergency: 0,
    alert: 1,
    critical: 2,
    error: 3,
    warning: 4,
    notice: 5,
    info: 6,
    debug: 7,
    emerg: 0,
    crit: 2,
    err: 3,
    warn: 4,
    note: 5,
    trace: 8,
}

const colors: Record<string, ansi.ANSIApplier> = {
    '0': 'red',
    '1': 'red',
    '2': 'red',
    '3': 'red',
    '4': 'yellow',
    '5': 'yellow',
    '6': 'green',
    '7': 'blue',
    '8': 'cyan',
}

export function createLogger(): Logger {
    const _logger = new Logger({ /*defaultLevel: 8, lineLevel: 8,*/ levels });
    _logger.pipe(new Human({ colors })).pipe(process.stdout)
    return _logger;
}

Reflect.defineProperty(Logger.prototype, "trace", {
    value(this: Logger, ...args: any) {
        return this.write([ "trace", ...args ]);
    }
})

declare module "caterpillar/compiled-types/logger" {
    interface Logger {
        trace(...args: any[]): void;
    }
}

