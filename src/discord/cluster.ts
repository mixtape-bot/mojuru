import { Collection } from "@dimensional-fun/common";
import { Shard } from "./shard";
import { Queue } from "./queue";
import { createShards, getClusterShards, range } from "../tools/shards";
import { GatewayIntentBits } from "discord-api-types/v9";
import type { Mojuru } from "../Mojuru";

export class Cluster {
    readonly shards: Collection<number, Shard>;
    readonly queue: Queue;

    constructor(readonly mojuru: Mojuru, readonly token: string) {
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
                id: [ id, totalShards ],
                token: this.token,
                url: "wss://gateway.discord.gg/",
                version: 9,
                intents: [ GatewayIntentBits.GuildMessages ],
                decompressor: "zlib-sync"
            });

            shard.connect();
            console.log(id);
            this.shards.set(id, shard);
        }

        return this;
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
