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

import { Cluster } from "./discord/cluster";
import { REST } from "@discordjs/rest";
import type { Amqp, AmqpResponseOptions } from "@spectacles/brokers";
import type { GatewaySendPayload, GatewayDispatchPayload } from "discord-api-types";
import type { GuildIdentifiedMessage, ShardIdentifiedMessage } from "./tools/events";
import config from "./tools/config";
import { createAmqpBroker } from "./tools/amqp";
import { getShardForGuild } from "./tools/discord";
import IORedis from "ioredis";
import { getLogger } from "log4js";

const _logger = getLogger("mojuru");

export class Mojuru {
    readonly broker: Amqp;
    readonly cluster: Cluster;
    readonly rest: REST
    readonly redis?: IORedis.Redis;

    constructor() {
        /* setup redis */
        if (config.redis?.host) {
            this.redis = new IORedis(config.redis.port, config.redis.host, {
                password: config.redis.password,
                db: config.redis.database
            });

            _logger.info("Connected to redis.");
        }

        /* setup the cluster. */
        this.cluster = new Cluster(this);
        this.rest = new REST({ version: `${config.discord.gateway_version}`, api: config.discord.api_url });
        this.rest.setToken(config.discord.token);

        /* setup the broker. */
        this.broker = createAmqpBroker(config.amqp.group, config.amqp.subgroup);
        this.broker.on("command", this.onCommand.bind(this));
        this.broker.on("stats", this.onStats.bind(this));
    }

    async onStats(message: {}, options: AmqpResponseOptions) {
        void message;
        options.reply({
            shards: this.cluster.shards.map(shard => ({
                latency: shard.latency,
                id: shard.id,
                state: shard.state,
            })),
            latency: this.cluster.latency
        });
    }

    async onCommand(message: ShardIdentifiedMessage | GuildIdentifiedMessage, options: AmqpResponseOptions) {
        const command = JSON.parse(message.payload.toString()) as GatewaySendPayload;
        if ("guild_id" in message) {
            const shard = getShardForGuild(BigInt(message.guild_id), this.cluster.totalShards);
            if (this._sendToShard(shard, command)) {
                options.ack()
            } else {
                options.nack(false, false);
                _logger.debug("received command for a guild we haven't spawned, guild:", message.guild_id);
            }

            return
        }

        if (!message.shard_id) {
            options.ack();
            await this.cluster.broadcast(command);
            return;
        }

        if (!this._sendToShard(message.shard_id, command)) {
            options.nack(false, false);
            _logger.warn("received command for unknown shard:", message.shard_id);
        } else {
            options.ack();
        }
    }

    publishEvent(shardId: number, payload: GatewayDispatchPayload) {
        if (!config.cluster.events.includes(payload.t)) {
            return;
        }

        const bytes = Buffer.from(JSON.stringify(payload));
        this.broker.publish(payload.t, {
            shard_id: shardId,
            payload: bytes
        });
    }

    private _sendToShard(id: number, payload: GatewaySendPayload): boolean {
        return !!this.cluster.shards.get(id)?.send(payload);
    }
}
