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

import * as zlibSync from "zlib-sync";
import { CHUNK_SIZE, Decompressor } from "./decompressor";

const _inflate: unique symbol = Symbol.for("ZlibSync#zlib")

export class ZlibSync extends Decompressor {
    // private static readonly Z_SYNC_FLUSH = 2;

    private [_inflate]: zlibSync.Inflate;

    init() {
        this[_inflate] = new zlibSync.Inflate({ chunkSize: CHUNK_SIZE });
    }

    protected _addBuffer(buf: Buffer) {
        /* check if this is the last frame by looking at the 4 ending bytes. */
        if (buf.length >= 4 && buf.readUInt32BE(buf.length - 4) === 0xFFFF) {
            this[_inflate].push(buf, zlibSync.Z_SYNC_FLUSH);
            if (this[_inflate].err) {
                const msg = `${this[_inflate].err}: ${this[_inflate].msg}`;
                this.emit("error", new Error(msg));
                return;
            }

            if (this[_inflate].result) {
                const result = Buffer.from(this[_inflate].result!);
                this.emit("data", result);
            }

            return;
        }

        this[_inflate].push(buf, false);
    }
}
