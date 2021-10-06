/*
 * Mojuru Gateway - typescript gateway for discord
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

import { configure } from "log4js";

const grey = (text: string) => `\u001b[90m${text}\u001b[39m`;
const bold = (text: string) => `\u001b[1m${text}\u001b[22m`;
const italic = (text: string) => `\u001b[3m${text}\u001b[23m`;

configure({
    appenders: {
        stdout: {
            type: "console",
            layout: {
                type: "pattern",
                // pattern: "%[%r (%x{pid}) %p %c -%] %m",
                pattern: `${grey("%r")} %[%6.10p%] ${bold("%x{pid}")} ${italic("%8.10c")}: %m`,
                tokens: {
                    pid: () => process.pid,
                },
            },
        },
        file: { type: "dateFile", filename: "mojuru.log", daysToKeep: 3 },
    },
    categories: {
        default: {
            appenders: [ "stdout", "file" ],
            level: "trace",
            enableCallStack: true,
        },
    },
});
