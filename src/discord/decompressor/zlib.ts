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

import * as zlib from "zlib";
import { CHUNK_SIZE, Decompressor } from "./decompressor";

const _chunks = Symbol.for("Zlib#chunks");
const _incomingChunks = Symbol.for("Zlib#incomingChunks");
const _flushing = Symbol.for("Zlib#flushing");
const _unzip = Symbol.for("Zlib#unzip");

export class Zlib extends Decompressor {
    private [_chunks]: Buffer[] = [];
    private [_incomingChunks]: Buffer[] = [];
    private [_flushing] = false;
    private [_unzip]: zlib.Unzip;

    init() {
        this[_unzip] = zlib.createUnzip({
            flush: zlib.constants.Z_SYNC_FLUSH,
            chunkSize: CHUNK_SIZE
        });

        this[_unzip].on("data", c => this[_chunks].push(c));
        this[_unzip].on("error", e => this.emit("error", e));
    }

    protected _addBuffer(buf: Buffer) {
        this[_flushing]
            ? this[_incomingChunks].push(buf)
            : this._write(buf)
    }

    private _flush() {
        this[_flushing] = false;
        if (!this[_chunks].length) {
            return;
        }

        let buf = this[_chunks][0];
        if (this[_chunks].length > 1) {
            buf = Buffer.concat(this[_chunks]);
        }

        this[_chunks] = [];
        while (this[_incomingChunks].length > 0) {
            const incoming = this[_incomingChunks].shift();
            if (incoming && this._write(incoming)) break;
        }

        this.emit("data", buf);
    }

    private _write(buf: Buffer) {
        this[_unzip].write(buf);

        const len = buf.length;
        if (len >= 4 && buf.readUInt32BE(len - 4) === 0xFFFF) {
            this[_flushing] = true;
            this[_unzip].flush(zlib.constants.Z_SYNC_FLUSH, this._flush.bind(this));
        }

        return this[_flushing];
    }
}
