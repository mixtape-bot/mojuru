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
