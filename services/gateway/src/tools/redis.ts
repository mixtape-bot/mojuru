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

import config from "./config";
import type IORedis from "ioredis";
import { getLogger } from "log4js";

let Redis: typeof IORedis;
try {
    Redis = require("ioredis");
} catch {}

const _logger = getLogger("redis");
const _prefix = config.redis?.shard_prefix ?? "mojuru.shards:";

export const redisKeys = {
    session: (id: number) => `${_prefix}${id}`,
    bucket: (id: number) => `${_prefix}bucket.${id}`,
    shard_seq: (id: number) => `${_prefix}${id}.seq`,
    session_id: (id: number) => `${_prefix}${id}.session`,
};

function create() {
    if (config.redis?.host) {
        if (!Redis) {
            throw new Error("Cannot use redis without the package 'ioredis', please disable redis or install the required package.");
        }

        const redis = new Redis(config.redis.port, config.redis.host, {
            password: config.redis.password,
            db: config.redis.database,
        });

        _logger.info("Connected to redis.");
        return redis;
    }

    return null;
}

export default create();
