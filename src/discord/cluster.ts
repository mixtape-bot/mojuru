import { Collection } from "@dimensional-fun/common";
import { Shard } from "./shard";
import { Queue } from "./queue";
import { createShards, getClusterShards, range } from "../tools/shards";
import type { Mojuru } from "../Mojuru";
import config from "../tools/config";

export class Cluster {
    readonly shards: Collection<number, Shard>;
    readonly queue: Queue;

    constructor(readonly mojuru: Mojuru) {
        this.shards = new Collection<number, Shard>();
        this.queue = new Queue(this);
    }

    get latency(): number {
        return this.shards.reduce((avg, shard) => avg + shard.latency, 0) / this.shards.size
    }

    async spawn(options: AutoSpawningOptions | ManualSpawningOptions | ClusteredSpawningOptions) {
        await this.queue.setup();

        let shards: number[], totalShards;
        switch (options.type) {
            case "clustered":
                shards = getClusterShards(options.clusterId, options.shardTotal, options.shardsPerCluster);
                totalShards = options.shardTotal
                break;
            case "manual":
                totalShards = options.shardTotal;
                if (options.shards) {
                    shards = Array.isArray(options.shards)
                        ? options.shards
                        : range(options.shards.firstId, options.shards.lastId)
                } else {
                    shards = createShards(options.shardTotal);
                }
                break;
            case "auto":
                shards = createShards(this.queue.suggestedShards);
                totalShards = this.queue.suggestedShards;
                break;
            default:
                throw new TypeError(`Unknown spawn type: ${options.type}`);
        }

        for (const id of shards) {
            const shard = new Shard(this, {
                version: config.discord.gatewayVersion,
                url: "wss://gateway.discord.gg/",
                intents: [],
                ...config.cluster.shard,
                id: [ id, totalShards ],
                token: config.discord.token,
            });

            shard.connect();
            this.shards.set(id, shard);
        }

        return this;
    }

    async destroy() {
        for (const [, shard] of this.shards) await shard.destroy(false);
    }
}

export interface SpawningOptions {
    type?: "auto" | "manual" | "clustered";
}

export interface AutoSpawningOptions extends SpawningOptions {
    type?: "auto";
}

export interface ManualSpawningOptions extends SpawningOptions {
    type: "manual";
    shardTotal: number;
    shards?: number[] | ShardRange;
}

export interface ClusteredSpawningOptions extends SpawningOptions {
    type: "clustered";
    clusterId: number;
    shardTotal: number;
    shardsPerCluster: number;
}

export interface ShardRange {
    firstId: number;
    lastId: number;
}
