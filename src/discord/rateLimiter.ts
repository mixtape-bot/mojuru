import type { Shard } from "./shard";
import { _shard_log } from "./keys";

const _tokens: unique symbol = Symbol.for("Ratelimiter#tokens");
const _lock: unique symbol = Symbol.for("Ratelimiter#lock");

export class RateLimiter {
    private static readonly DEFAULT_TOKENS = 120;
    private static readonly DEFAULT_EXPIRATION = 60 * 1000;

    private [_tokens]: number;
    private [_lock]?: Promise<void>;

    constructor(
        readonly shard: Shard,
        readonly defaultTokens: number = RateLimiter.DEFAULT_TOKENS,
        readonly ratelimitDuration: number = RateLimiter.DEFAULT_EXPIRATION
    ) {
        this[_tokens] = +defaultTokens;
    }

    get tokens() {
        return this[_tokens];
    }

    async consume(): Promise<void> {
        await this[_lock];
        await this._check()
        this[_tokens]--
    }

    private async _check() {
        if (this[_tokens] <= 0) {
            this.shard[_shard_log]("warn", "ratelimter: ran out of tokens, waiting", this.ratelimitDuration, "milliseconds!");1
            this[_lock] = new Promise(res => setTimeout(this._free.bind(this, res), this.ratelimitDuration));
            await this[_lock];
        }
    }

    private _free(res: () => void) {
        this[_tokens] = this.defaultTokens;
        delete this[_lock];
        res();
    }
}
