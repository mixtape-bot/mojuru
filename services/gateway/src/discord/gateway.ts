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

import type { Cluster } from "./cluster";
import redis, { redisKeys } from "../tools/redis";
import { fetchJson, range } from "../tools/functions";
import type {
    APIGatewaySessionStartLimit,
    GatewayIdentifyData,
    RESTGetAPIGatewayBotResult,
} from "discord-api-types/v9";
import { GatewayOpcodes } from "discord-api-types/v9";
import config from "../tools/config";
import type { MaxConcurrency } from "../tools/discord";
import { getLogger } from "log4js";
import RedLock from "redlock";
import { AsyncLimiter } from "./limiter";

const _logger = getLogger("gateway");

export interface SessionLock<Lock = any> {
    acquire: () => Promise<Lock>;
    release: (lock: Lock) => Promise<void>;
}

const redisSessionLock = (bucket: number, redLock: RedLock): SessionLock<RedLock.Lock> => ({
    acquire: () => redLock.acquire(redisKeys.bucket(bucket), 10000) as any,
    release: lock => redLock.release(lock) as any
})

const limiterLock = (limiter: AsyncLimiter): SessionLock<void> => {
    let promise: Promise<void> | undefined;
    let resolver: (() => void) | undefined;
    return {
        acquire: () => {
            return limiter.consume(() => promise ??= new Promise<void>(res => { resolver = res }))
        },
        release: async () => {
            promise = undefined;
            await resolver?.();
        }
    }
};

export class Gateway {
    /** the rate-limit buckets used for shard identifies */
    readonly buckets = new Map<number, SessionLock>();

    /** the sessions stored in memory, if redis is available this map will be empty. */
    readonly sessions = new Map<number, ShardSession>();

    maxConcurrency!: number;
    startLimit!: APIGatewaySessionStartLimit;
    suggestedShards!: number;
    redlock?: RedLock

    constructor(readonly cluster: Cluster) {
        this.redlock = new RedLock([ redis! ], {
            retryDelay: 5000,
            retryJitter: 200,
            driftFactor: 0.01
        });
    }

    async createBuckets() {
        await this.fetchGateway();
        for (let bucket = 0; bucket < this.maxConcurrency; bucket++) {
            const lock = this.createLock(bucket);
            this.buckets.set(bucket, lock)
        }
    }

    async getSession(id: number): Promise<ShardSession> {
        const session = await redis?.hgetall(redisKeys.session(id));
        if (session) {
            return { id: session.id, sequence: +session.sequence };
        }

        return this.sessions.get(id) ?? { sequence: -1 };
    }

    async invalidateSession(shard: number) {
        if (!redis?.del(redisKeys.session(shard))) this.sessions.delete(shard);
    }

    async canResume(shard: number): Promise<boolean> {
        if (redis) {
            return Boolean(await redis?.hexists(redisKeys.session(shard), "id"));
        }

        return !!this.sessions.get(shard)?.id
    }

    async setSessionId(shard: number, sessionId: string) {
        await this.setField(shard, "id", sessionId);
    }

    async setSessionSeq(shard: number, sequence: number) {
        await this.setField(shard, "sequence", sequence);
    }

    async queueIdentify(shard: number, d: GatewayIdentifyData) {
        /* get the rate-limit bucket for the supplied shard. */
        const bucket = this.buckets.get(shard % this.maxConcurrency)!;

        /* acquire the lock, identify, and then release the lock. */
        const lock = await bucket.acquire();
        await this.identify(shard, d);
        await bucket.release(lock);
    }

    async identify(shardId: number, d: GatewayIdentifyData) {
        const shard = this.cluster.shards.get(shardId)
        if (!shard) {
            throw new Error(`This cluster doesn't know of a shard with the id of ${shardId}`);
        }

        await shard.send({ op: GatewayOpcodes.Identify, d }, true);
    }

    private createLock(bucket: number): SessionLock {
        if (this.redlock) {
            _logger.debug("using redlock-based identify rate-limiting.");
            return redisSessionLock(bucket, this.redlock);
        } else {
            const limiter = new AsyncLimiter(1, range(5000, 5 * (1 + 0.09) * 1000));
            _logger.debug("using delay-based identify rate-limiting.");
            return limiterLock(limiter);
        }
    }

    private async fetchGateway() {
        try {
            const { session_start_limit: limit, shards, } = await fetchJson<RESTGetAPIGatewayBotResult>(`${config.discord.api_url}/v${config.discord.gateway_version}/gateway/bot`, {
                headers: {
                    Authorization: `Bot ${config.discord.token}`,
                },
            });

            this.startLimit = limit;
            this.maxConcurrency = limit.max_concurrency as MaxConcurrency;
            this.suggestedShards = shards;

            _logger.debug("received session limit,", `identifies: ${limit.remaining}/${limit.total}`, "shards:", shards, "max_concurrency:", limit.max_concurrency);
        } catch (e) {
            throw new Error("Incorrect Token Passed");
        }
    }

    private async setField<K extends keyof ShardSession>(shard: number, field: K, value: ShardSession[K]) {
        if (redis) {
            return value != null
                ? redis.hset(redisKeys.session(shard), field, value)
                : redis.hdel(redisKeys.session(shard), field);
        }

        const session = this.sessions.get(shard);
        if (!session) {
            const obj = { [field]: value };
            return this.sessions.set(shard, { sequence: -1, ...obj });
        }

        session[field] = value;
    }
}

export interface ShardSession {
    sequence: number;
    id?: string;
}
