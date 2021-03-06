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

import type { Cluster } from "./cluster";
import type { RESTGetAPIGatewayBotResult, APIGatewaySessionStartLimit } from "discord-api-types/v9";
import { Collection } from "@discordjs/collection";
import { createArray, getRateLimitKey, MaxConcurrency } from "../tools/discord";
import { sleep } from "../tools/sleep";
import { getLogger } from "log4js";

const _logger = getLogger("queue");
const _start_limit:      unique symbol = Symbol.for("Queue#startLimit");
const _max_concurrency : unique symbol = Symbol.for("Queue#maxConcurrency");
const _suggested_shards: unique symbol = Symbol.for("Queue#suggested");

const _rate_limiter_queue:  unique symbol = Symbol.for("RateLimiter#queue");
const _rate_limiter_last:   unique symbol = Symbol.for("RateLimiter#last");
const _rate_limiter_locked: unique symbol = Symbol.for("RateLimiter#locked");

// TODO: handle session start limit

class RateLimiter {
    private [_rate_limiter_queue]: Token[] = [];
    private [_rate_limiter_locked] = false;
    private [_rate_limiter_last]?: number;

    constructor(readonly bucket: number, readonly waitTime: number) {
    }

    async consume(token: Token) {
        this[_rate_limiter_queue].push(token);
        await this._check();
    }

    private async _check() {
        /* check if we're currently locked, or if the queue is empty. */
        if (this[_rate_limiter_locked] || !this[_rate_limiter_queue].length) {
            return;
        }

        /* check if we're still waiting */
        const last = this[_rate_limiter_last], now = Date.now();
        if (last && last + this.waitTime >= now) {
            const sleeping = now - last;
            await sleep(sleeping);
        }

        /* run the token. */
        const token = this[_rate_limiter_queue].shift();
        if (token) {
            this[_rate_limiter_locked] = true;
            await token();
            this[_rate_limiter_last] = Date.now();
            this[_rate_limiter_locked] = false;
            await this._check();
        }
    }
}

type Token = () => void | Promise<void>;

export class Queue {
    buckets!: Collection<number, RateLimiter>;

    private [_max_concurrency]?: MaxConcurrency;
    private [_start_limit]?: APIGatewaySessionStartLimit;
    private [_suggested_shards]?: number;

    constructor(readonly cluster: Cluster) {
    }

    private static _createRateLimiter(bucket: number): [ number, RateLimiter ] {
        return [ bucket, new RateLimiter(bucket, 5000) ]
    }

    get startLimit(): APIGatewaySessionStartLimit {
        const startLimit = this[_start_limit];
        if (!startLimit) throw new Error("Queue#setup has not been called.");
        return startLimit;
    }

    get suggestedShards(): number {
        const shards = this[_suggested_shards];
        if (!shards) throw new Error("Queue#setup has not been called.");
        return shards;
    }

    async setup() {
        let maxConcurrency = this[_max_concurrency];
        if (!maxConcurrency) {
            await this.get();
            maxConcurrency = this[_max_concurrency]!;
        }

        /* create the buckets. */
        const buckets = createArray(maxConcurrency, Queue._createRateLimiter);
        _logger.debug(`created buckets:`, ...buckets.map(b => b[0]));

        /* now use them ;) */
        this.buckets = new Collection(buckets);
    }

    getRateLimiter(shardId: number) {
        const maxConcurrency = this[_max_concurrency];
        if (!maxConcurrency) throw new Error("Queue#setup has not been called yet.")
        return this.buckets.get(getRateLimitKey(shardId, maxConcurrency));
    }

    private async get() {
        try {
            const { session_start_limit: limit, shards } = await this.cluster.mojuru.rest.get("/gateway/bot") as RESTGetAPIGatewayBotResult;
            this[_start_limit] = limit;
            this[_max_concurrency] = limit.max_concurrency as MaxConcurrency;
            this[_suggested_shards] = shards;

            _logger.debug(`received session limit,`, `identifies: ${limit.remaining}/${limit.total}`, "shards:", shards, "max_concurrency:", limit.max_concurrency);
        } catch (e) {
            throw new Error("Incorrect Token Passed")
        }
    }
}
