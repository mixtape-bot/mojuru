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

import type * as Zlib from "fast-zlib";
import { CHUNK_SIZE, Compression } from "./compression";

let zlib: typeof Zlib;
try {
    zlib = require("fast-zlib");
} catch {}

export class FastZlib extends Compression {
    readonly type = "zlib-stream"

    private inflate!: Zlib.Inflate;

    init() {
        if (!zlib) {
            throw new Error("The 'fast-zlib' decompressor requires 'fast-zlib' to be installed.");
        }

        this.inflate = new zlib.Inflate({
            flush: zlib.constants.Z_SYNC_FLUSH,
            chunkSize: CHUNK_SIZE,
        });
    }

    close() {
        return this.inflate.close();
    }

    protected _decompress(buf: Buffer) {
        try {
            if (buf.length >= 4 && buf.readUInt32BE(buf.length - 4) === 0xFFFF) {
                let data = this.inflate.process(buf, zlib.constants.Z_SYNC_FLUSH);
                return this.emit("decompressed", data);
            }

            this.inflate.process(buf);
        } catch (e) {
            this.emit("error", e);
        }
    }
}
