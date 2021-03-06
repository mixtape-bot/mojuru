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

import { TypedEmitter } from "tiny-typed-emitter";
import { getLogger } from "log4js";
import type { CompressionAlgorithm } from "../../tools/types";

export const CHUNK_SIZE = 128 * 1024;
export const decompressorLogger = getLogger("compress");

export abstract class Decompressor extends TypedEmitter<DecompressorEvents> {
    readonly abstract type: CompressionAlgorithm;

    abstract init(): void;

    abstract close(): void;

    add(data: CompressedData) {
        if (data instanceof Buffer) {
            this._addBuffer(data);
            return;
        } else if (Array.isArray(data)) {
            this.emit("debug", "received fragmented buffer message.");
            for (const buf of data) this._addBuffer(buf);
            return;
        } else if (data instanceof ArrayBuffer) {
            this.emit("debug", "received array buffer message.");
            this._addBuffer(Buffer.from(data));
            return;
        }

        decompressorLogger.warn("received invalid data.");
    }

    protected abstract _addBuffer(buf: Buffer): void;
}

export type CompressedData = string | Buffer | ArrayBuffer | Buffer[];

export interface DecompressorEvents {
    data: (data: Buffer) => void;
    debug: (msg: string) => void;
    error: (err: any)  => void;
}
