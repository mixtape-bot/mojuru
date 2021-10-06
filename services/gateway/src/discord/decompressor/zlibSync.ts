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

import type * as zlib from "zlib-sync";
import { CHUNK_SIZE, Compression } from "./compression";

let zlibSync: typeof zlib;
try {
    zlibSync = require("zlib-sync");
} catch {
    // no-op
}

export class ZlibSync extends Compression {
    static readonly ZLIB_SUFFIX = new Uint8Array([0x00, 0x00, 0xff, 0xff]);

    readonly type = "zlib-stream"

    private inflate!: zlib.Inflate;

    init() {
        if (!zlibSync) {
            throw new Error("Cannot use the 'zlib-sync' decompressor without the 'zlib-sync' package.");
        }

        this.inflate = new zlibSync.Inflate({ chunkSize: CHUNK_SIZE });
    }

    close() {
    }

    protected _decompress(buf: Buffer) {
        let flushing = true;

        const suffix = buf.slice(buf.length - 4, buf.length);
        for (let pos = 0; pos < suffix.length; pos++) {
            if (suffix[pos] !== ZlibSync.ZLIB_SUFFIX[pos]) {
                flushing = false;
                break;
            }
        }

        this.inflate.push(buf, flushing ? zlibSync.Z_SYNC_FLUSH : zlibSync.Z_NO_FLUSH);
        if (!flushing) {
            return;
        }

        if (this.inflate.err) {
            const msg = `${this.inflate.err}: ${this.inflate.msg}`;
            this.emit("error", new Error(msg));
            return;
        }

        if (this.inflate.result) {
            const result = Buffer.from(this.inflate.result!);
            this.emit("decompressed", result);
        }
    }
}
