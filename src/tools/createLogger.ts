/*
 * Mojuru Gateway - A cool discord gateway thing in typescript.
 * Copyright (C) 2021 Mixtape Bot
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Filter, Human, Logger } from "caterpillar";
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
    _logger
        .pipe(new Filter({ filterLevel: 8 }))
        .pipe(new Human({ colors }))
        .pipe(process.stdout)
    return _logger;
}

["trace", "emerg"].forEach(level => {
    Reflect.defineProperty(Logger.prototype, level, {
        value(this: Logger, ...args: any) {
            return this.write([ level, ...args ]);
        }
    });
});

declare module "caterpillar/compiled-types/logger" {
    interface Logger {
        trace(...args: any[]): void;
        emerg(...args: any[]): void;
    }
}

