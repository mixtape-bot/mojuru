import { createLogger } from "../tools/createLogger";

const _tokens: unique symbol = Symbol.for("Ratelimiter#tokens");
const _lock: unique symbol = Symbol.for("Ratelimiter#lock");
const _logger = createLogger();

export class RateLimiter {
    private static readonly DEFAULT_TOKENS = 120;
    private static readonly DEFAULT_EXPIRATION = 60 * 1000;

    private [_tokens]: number;
    private [_lock]?: Promise<void>;

    constructor(
        readonly id: string,
        readonly defaultTokens: number = RateLimiter.DEFAULT_TOKENS,
        readonly ratelimitDuration: number = RateLimiter.DEFAULT_EXPIRATION,
    ) {
        this[_tokens] = +defaultTokens;
    }

    get tokens() {
        return this[_tokens];
    }

    async consume(): Promise<void> {
        await this[_lock];
        await this._check();
        this[_tokens]--
    }

    private async _check() {
        /* check if we're out of tokens, if so lock token consumption. */
        if (this[_tokens] <= 0) {
            _logger.warn(`(${this.id})`, "rate-limiter: ran out of tokens, waiting", this.ratelimitDuration, "milliseconds!");
            this[_lock] = new Promise(res => setTimeout(this._free.bind(this, res), this.ratelimitDuration));
            await this[_lock];
        }

        /* as this method is only called when a token is being consumed check if we haven't consumed any tokens, if so queue a reset. */
        if (this[_tokens] === this.defaultTokens) {
            setTimeout(this._reset.bind(this), this.ratelimitDuration);
        }
    }

    private _reset() {
        this[_tokens] = this.defaultTokens;
    }

    private _free(res: () => void) {
        this._reset();
        delete this[_lock];
        res();
    }
}
