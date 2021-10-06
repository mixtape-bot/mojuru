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

import * as zlib from "zlib";
import { CHUNK_SIZE, Compression } from "./compression";

export class Zlib extends Compression {
    readonly type = "zlib-stream";

    private chunks: Buffer[] = [];
    private incomingChunks: Buffer[] = [];
    private flushing = false;
    private unzip!: zlib.Unzip;

    init() {
        this.unzip = zlib.createUnzip({
            flush: zlib.constants.Z_SYNC_FLUSH,
            chunkSize: CHUNK_SIZE
        });

        this.unzip.on("data", c => this.chunks.push(c));
        this.unzip.on("error", e => this.emit("error", e));
    }

    close() {
        this.unzip.close();
    }

    protected _decompress(buf: Buffer) {
        this.flushing
            ? this.incomingChunks.push(buf)
            : this._write(buf)
    }

    private _flush() {
        this.flushing = false;
        if (!this.chunks.length) {
            return;
        }

        let buf = this.chunks[0];
        if (this.chunks.length > 1) {
            buf = Buffer.concat(this.chunks);
        }

        this.chunks = [];
        while (this.incomingChunks.length > 0) {
            const incoming = this.incomingChunks.shift();
            if (incoming && this._write(incoming)) break;
        }

        this.emit("decompressed", buf);
    }

    private _write(buf: Buffer) {
        this.unzip.write(buf);

        const len = buf.length;
        if (len >= 4 && buf.readUInt32BE(len - 4) === 0xFFFF) {
            this.flushing = true;
            this.unzip.flush(zlib.constants.Z_SYNC_FLUSH, this._flush.bind(this));
        }

        return this.flushing;
    }
}
