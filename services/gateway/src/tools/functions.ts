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

import * as http from "http";
import * as https from "https";
import { json } from "./encoding";
import crypto from "crypto";

export function sleep(duration: number, beforeUnlock: () => any = () => {
}): Promise<void> {
    return new Promise(res => setTimeout(async () => {
        await beforeUnlock();
        res();
    }, duration).ref());
}

export function range(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min)) + min;
}

export function normalize(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
    return data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Array.isArray(data) ? Buffer.concat(data) : data;
}

export function createArray<T>(length: number, mapper: (index: number) => T): T[] {
    return Array.from({ length }, (_, i) => mapper(i));
}

export function fetchJson<T>(url: `https://${string}` | `http://${string}`, options: FetchOptions = {}): Promise<T> {
    return new Promise((res, rej) => {
        const request = (/^https:\//.test(url) ? https : http).request(url, options, resp => {
            let chunk = Buffer.alloc(+(resp.headers["content-length"] ?? ""));
            resp.on("data", c => chunk = Buffer.concat([ chunk, c ]));
            resp.on("error", rej);
            resp.on("end", () => res(json.parse(chunk.toString())));
        });

        request.on("error", rej);
        if (options.body !== undefined) {
            request.write(options.body);
        }

        request.end();
    });
}

export function createIdentifier(bytes = 128): string {
    return crypto
        .createHash("sha1")
        .update(crypto.randomBytes(bytes))
        .digest("hex");
}

type FetchOptions =
    Omit<http.RequestOptions, "host" | "hostname" | "path" | "port" | "protocol" | "defaultPort">
    & { body?: any }
