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

import { createArray } from "./functions";

export type MaxConcurrency = 1 | 16 | 32 | 64;

export function getShardForGuild(guildId: bigint, shardCount: number): number {
    return Number((guildId >> 22n) % BigInt(shardCount));
}

export function getRateLimitKey(id: number, maxConcurrency: MaxConcurrency): number {
    return id % maxConcurrency;
}

/** taken from https://github.com/arcanebot/redis-sharder */
export function getClusterShards(cluster: number, totalShards: number, shardCount: number) {
    const initial = shardCount * cluster;
    let shards = [ initial, initial + (shardCount - 1) ];
    if (shards[1] + shardCount > (totalShards - 1)) {
        shards[1] = totalShards - 1;
    }

    return shards;
}

export function createShards(amount: number, offset: number = 0): number[] {
    return createArray(amount, i => i + offset);
}

export function createShardsForRange(min: number, max: number) {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
