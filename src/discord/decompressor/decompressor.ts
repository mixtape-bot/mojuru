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
import { createLogger } from "../../tools/createLogger";

export const CHUNK_SIZE = 128 * 1024;
export const decompressorLogger = createLogger();

export abstract class Decompressor extends TypedEmitter<DecompressorEvents> {
    abstract init(): void;

    add(data: CompressedData) {
        if (data instanceof Buffer) {
            this._addBuffer(data);
            return;
        } else if (Array.isArray(data)) {
            this.emit("debug", "decompressor received fragmented buffer message.");
            for (const buf of data) this._addBuffer(buf);
            return;
        } else if (data instanceof ArrayBuffer) {
            this.emit("debug", "decompressor received array buffer message.");
            this._addBuffer(Buffer.from(data));
            return;
        }

        decompressorLogger.warn("decompressor received invalid data.");
    }

    protected abstract _addBuffer(buf: Buffer): void;
}

export type CompressedData = string | Buffer | ArrayBuffer | Buffer[];

export interface DecompressorEvents {
    data: (data: Buffer) => void;
    debug: (msg: string) => void;
    error: (err: Error)  => void;
}
