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
import { createLogger } from "./tools/createLogger";
import type { GatewaySendPayload, GatewayDispatchPayload } from "discord-api-types";
import type { ShardIdentifiedMessage } from "./tools/events";
import config from "./tools/config";
import { createAmqpBroker } from "./tools/amqp";

const _logger = createLogger();

export class Mojuru {
    readonly broker: Amqp;
    readonly cluster: Cluster;
    readonly rest: REST

    constructor() {
        this.cluster = new Cluster(this);
        this.rest = new REST({ version: `${config.discord.gatewayVersion}` });
        this.rest.setToken(config.discord.token);

        /* setup the broker. */
        this.broker = createAmqpBroker(config.amqp.group, config.amqp.subgroup);
        this.broker.on("command", this.onCommand.bind(this));
    }

    async onCommand(message: ShardIdentifiedMessage, options: AmqpResponseOptions) {
        const shard = this.cluster.shards.get(message.shard_id);
        if (!shard) {
            options.nack(false, false);
            _logger.warn("received command for unknown shard:", message.shard_id);
            return
        }

        options.ack();
        const command = JSON.parse(message.payload.toString()) as GatewaySendPayload;
        await shard.send(command)
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
}

export interface Command {
    shardId: number;
    payload: Buffer;
}
