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

import { sleep } from "../tools/functions";
import { TypedEmitter } from "tiny-typed-emitter";

type LimiterEvents = { limited: (duration: number) => void }
type Callback = () => void | Promise<void>;

export interface Limiter extends TypedEmitter<LimiterEvents> {
    /**
     *
     * @returns {Promise<void>}
     */
    consume(...args: any[]): Promise<void>;
}

export class AsyncLimiter extends TypedEmitter<LimiterEvents> implements Limiter {
    private queue: Callback[] = [];
    private tokens: number;
    private executing = false;
    private locked = false;
    private last = 0;
    // private resetTimeout?: NodeJS.Timeout;

    constructor(readonly defaultTokens: number, readonly waitTime: number) {
        super();
        this.tokens = +defaultTokens;
    }

    async consume(callback: Callback, important: boolean = false) {
        this.queue[important ? "unshift" : "push"](callback);
        await this._check();
    }

    async lock(wait = 0) {
        this.locked = true;
        if (wait) {
            await sleep(wait);
            await this.unlock();
        }
    }

    async unlock() {
        this.locked = false;
        this._reset();
        await this._check();
    }

    private _reset() {
        this.tokens = this.defaultTokens;
    }

    private async _check() {
        if (this.locked || this.executing || !this.queue.length) {
            return;
        }

        if (this.tokens <= 0) {
            const waitTime = Math.max(this.waitTime - (Date.now() - this.last), 0);
            this.emit("limited", waitTime);
            return this.lock(waitTime);
        }

        const token = this.queue.shift();
        if (token) {
            /* make sure to reset our tokens after the specified wait time. */
            if (this.tokens === this.defaultTokens) {
                setTimeout(this._reset.bind(this), this.waitTime).ref();
            }

            this.tokens--;
            this.last = Date.now();

            /* execute the token */
            try {
                this.executing = true;
                await token();
            } finally {
                this.executing = false;
                this._check();
            }
        }
    }
}
