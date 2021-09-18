import type { Cluster } from "./cluster";
import type { RESTGetAPIGatewayBotResult, APIGatewaySessionStartLimit } from "discord-api-types/v9";
import { Collection } from "@dimensional-fun/common";
import { createArray, getRateLimitKey, MaxConcurrency } from "../tools/shards";
import { sleep } from "../tools/sleep";
import { createLogger } from "../tools/createLogger";

const _logger = createLogger();
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

    private static _createRateLimiter(bucket: number) {
        return new RateLimiter(bucket, 5000)
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
        const maxConcurrency = this[_max_concurrency] ?? (await this.getGatewayBot()).session_start_limit.max_concurrency;

        /* create the buckets. */
        const buckets = createArray(maxConcurrency, Queue._createRateLimiter);
        _logger.debug(`created buckets:`, ...buckets.map(b => b.bucket));

        /* now use them ;) */
        this.buckets = Collection.from(buckets);
    }

    async getRateLimiter(shardId: number) {
        const maxConcurrency = this[_max_concurrency];
        if (!maxConcurrency) throw new Error("Queue#setup has not been called yet.")
        return this.buckets.get(getRateLimitKey(shardId, maxConcurrency));
    }

    async getGatewayBot(): Promise<RESTGetAPIGatewayBotResult> {
        const resp = await this.cluster.mojuru.rest.get("/gateway/bot") as RESTGetAPIGatewayBotResult;
        this[_start_limit] = resp.session_start_limit;
        this[_max_concurrency] = resp.session_start_limit.max_concurrency as MaxConcurrency;
        this[_suggested_shards] = resp.shards;

        return resp;
    }
}
