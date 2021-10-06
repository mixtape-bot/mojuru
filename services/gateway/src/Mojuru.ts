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

import { Cluster } from "./discord/cluster";
import type { GatewayDispatchPayload, GatewaySendPayload } from "discord-api-types";
import type { Channel, Connection } from "amqplib";
import { getShardForGuild } from "./tools/discord";
import { getLogger } from "log4js";
import type { GuildIdentifiedMessage, ShardIdentifiedMessage } from "./tools/types";
import config from "./tools/config";
import { ResponseOptions, createConsumer, createAmqp, publishMessage } from "./tools/amqp";

const _logger = getLogger("mojuru");

export class Mojuru {
    readonly cluster: Cluster;

    connection!: Connection;
    channel!: Channel;

    private commandsExchange!: string;
    private eventsExchange!: string;

    constructor() {
        this.cluster = new Cluster(this);
    }

    async init() {
        const { connection, channel } = await createAmqp(config.amqp.host);
        connection.on("error", (e) => _logger.error("[amqp] connection threw an error:", e));
        connection.on("exit", () => {
            // TODO: maybe don't exit the process?
            _logger.fatal("[amqp] connection has closed.");
            process.exit();
        });

        this.connection = connection;
        this.channel = channel;

        /* setup commands exchange */
        this.commandsExchange = (await channel.assertExchange(`${config.amqp.group}.commands`, "direct")).exchange;

        await channel.assertQueue(config.amqp.commands_queue);
        await channel.bindQueue(config.amqp.commands_queue, this.commandsExchange, "commands");
        await channel.consume(config.amqp.commands_queue, createConsumer(channel, this.onCommand.bind(this)));
    }

    async onCommand(message: ShardIdentifiedMessage | GuildIdentifiedMessage, options: ResponseOptions) {
        const command = JSON.parse(message.payload.toString()) as GatewaySendPayload;
        if ("guild_id" in message) {
            const shard = getShardForGuild(BigInt(message.guild_id), this.cluster.totalShards);
            if (this._sendToShard(shard, command)) {
                options.ack();
            } else {
                options.nack(false, false);
                _logger.debug("received command for a guild we haven't spawned, guild:", message.guild_id);
            }

            return;
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
        if (config.cluster.events !== "all" && !config.cluster.events.includes(payload.t)) {
            return;
        }

        const bytes = Buffer.from(JSON.stringify(payload));
        publishMessage(this.channel, this.eventsExchange, "events", {
            shard_id: shardId,
            payload: bytes,
        }, {
            expiration: 60000
        });
    }

    private _sendToShard(id: number, payload: GatewaySendPayload): boolean {
        return !!this.cluster.shards.get(id)?.send(payload);
    }
}
