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

export type MaxConcurrency = 1 | 16 | 32 | 64;

export function getShardForGuild(guildId: bigint, shardCount: bigint): number {
    return Number((guildId >> 22n) % shardCount);
}

export function getRateLimitKey(id: number, maxConcurrency: MaxConcurrency): number {
    return id % maxConcurrency;
}

export function getClusterShards(cluster: number, totalShards: number, shardCount: number) {
    const initial = shardCount * cluster;
    let shards = [initial, initial + (shardCount - 1)];
    if (shards[1] + shardCount > (totalShards - 1)) {
        shards[1] = totalShards - 1;
    }

    return shards;
}

export function createArray<T>(length: number, mapper: (index: number) => T): T[] {
    return Array.from({ length }, (_, i) => mapper(i));
}

export function createShards(amount: number, offset: number = 0): number[] {
    return createArray(amount, i => i + offset);
}

export function range(min: number, max: number) {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
