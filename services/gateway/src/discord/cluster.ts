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

import { ShardImpl, Shard, ShardSettings } from "./shard";
import { createShards, getClusterShards, createShardsForRange } from "../tools/discord";
import type { Mojuru } from "../Mojuru";
import config, { AutoSpawningOptions, ClusteredSpawningOptions, ManualSpawningOptions } from "../tools/config";
import type { GatewaySendPayload } from "discord-api-types/gateway/v9";
import { decompressors } from "./decompressor";
import * as metrics from "../tools/metrics";
import { getLogger } from "log4js";
import type { APIUser } from "discord-api-types/v9";
import { Gateway } from "./gateway";

const _logger = getLogger("cluster")

export class Cluster {
    readonly shards: Map<number, Shard>;
    readonly gateway: Gateway;

    whoami?: APIUser;
    totalShards!: number;

    constructor(readonly mojuru: Mojuru) {
        this.shards = new Map<number, Shard>();
        this.gateway = new Gateway(this);
    }

    get latency(): number {
        let latency = 0;
        for (const [, shard] of this.shards) latency += shard.latency;
        return latency / this.shards.size;
    }

    async broadcast(message: GatewaySendPayload) {
        _logger.debug("broadcasting message:", JSON.stringify(message))
        for (const [, shard] of this.shards) {
            await shard.send(message);
        }
    }

    async spawn(options: AutoSpawningOptions | ManualSpawningOptions | ClusteredSpawningOptions) {
        await this.gateway.createBuckets();

        let shards: number[], totalShards;
        switch (options.type) {
            case "clustered":
                shards = getClusterShards(options.cluster_id, options.shard_total, options.shards_per_cluster);
                totalShards = options.shard_total
                break;
            case "manual":
                totalShards = options.shard_total;
                if (options.shards) {
                    shards = Array.isArray(options.shards)
                        ? options.shards
                        : createShardsForRange(options.shards.first_id, options.shards.last_id)
                } else {
                    shards = createShards(options.shard_total);
                }
                break;
            case "auto":
                shards = createShards(this.gateway.suggestedShards!);
                totalShards = shards.length;
                break;
            default:
                throw new TypeError(`Unknown spawn type: ${options.type}`);
        }

        const shardOptions = {
            version: config.discord.gateway_version,
            url: "wss://gateway.discord.gg/",
            intents: [],
            encoding: "json",
            ready_timeout: 5000,
            ...config.cluster.shard_options,
        } as ShardSettings

        if (shardOptions.decompressor && !decompressors[shardOptions.decompressor]) {
            delete shardOptions["decompressor"];
        }

        _logger.debug(`using ${shardOptions.encoding} encoding${shardOptions.decompressor ? `, and ${shardOptions.decompressor}` : " without"} compression`);
        for (const id of shards) {
            metrics.shardsTotal.inc();

            const shard = new ShardImpl(this, {
                ...shardOptions,
                shard: [ id, totalShards ],
                token: config.discord.token,
            });

            shard.connect();
            this.shards.set(id, shard);
        }

        this.totalShards = totalShards;
        return this;
    }

    async destroy() {
        for (const [, shard] of this.shards) {
            await shard.disconnect({ reconnect: false, code: 1_001 });
        }
    }
}

