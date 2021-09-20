import { configure } from "log4js";
import { bold, grey, italic } from "colors";

configure({
    appenders: {
        stdout: {
            type: "console",
            layout: {
                type: "pattern",
                // pattern: "%[%r (%x{pid}) %p %c -%] %m",
                pattern: `${grey("%r")} %[%6.10p%] ${bold("%x{pid}")} ${italic("%8.10c")}: %m`,
                tokens: {
                    pid: () => process.pid
                },
            },
        },
        file: { type: "dateFile", filename: "mojuru.log", daysToKeep: 3 }
    },
    categories: {
        default: {
            appenders: [ "stdout", "file" ],
            level: "trace",
            enableCallStack: true
        }
    },
});
