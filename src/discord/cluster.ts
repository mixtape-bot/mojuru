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

import { Collection } from "@discordjs/collection";
import { Shard, ShardSettings } from "./shard";
import { Queue } from "./queue";
import { createShards, getClusterShards, range } from "../tools/discord";
import type { Mojuru } from "../Mojuru";
import config, { AutoSpawningOptions, ClusteredSpawningOptions, ManualSpawningOptions } from "../tools/config";
import type { GatewaySendPayload } from "discord-api-types/gateway/v9";
import { decompressors } from "./decompressor";
import * as metrics from "../tools/metrics";
import { getLogger } from "log4js";
import type { APIUser } from "discord-api-types/v9";

const _logger = getLogger("cluster")

export class Cluster {
    readonly shards: Collection<number, Shard>;
    readonly queue: Queue;

    whoami?: APIUser;
    totalShards!: number;

    constructor(readonly mojuru: Mojuru) {
        this.shards = new Collection<number, Shard>();
        this.queue = new Queue(this);
    }

    get latency(): number {
        return this.shards.reduce((avg, shard) => avg + shard.latency, 0) / this.shards.size
    }

    async broadcast(message: GatewaySendPayload) {
        _logger.debug("broadcasting message:", JSON.stringify(message))
        for (const [, shard] of this.shards) {
            await shard.send(message);
        }
    }

    async spawn(options: AutoSpawningOptions | ManualSpawningOptions | ClusteredSpawningOptions) {
        await this.queue.setup();

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
                        : range(options.shards.first_id, options.shards.last_id)
                } else {
                    shards = createShards(options.shard_total);
                }
                break;
            case "auto":
                shards = createShards(this.queue.suggestedShards);
                totalShards = this.queue.suggestedShards;
                break;
            default:
                throw new TypeError(`Unknown spawn type: ${options.type}`);
        }

        const shardOptions = {
            version: config.discord.gateway_version,
            url: "wss://gateway.discord.gg/",
            intents: [],
            encoding: "json",
            ...config.cluster.shard_options,
        } as ShardSettings

        if (shardOptions.decompressor && !decompressors[shardOptions.decompressor]) {
            delete shardOptions["decompressor"];
        }

        _logger.debug(`using ${shardOptions.encoding} encoding${shardOptions.decompressor ? `, and ${shardOptions.decompressor}` : " without"} compression`);
        for (const id of shards) {
            metrics.shardsTotal.inc();

            const shard = new Shard(this, {
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
            await shard.destroy({ reconnect: false, code: 1_001 });
        }
    }
}

