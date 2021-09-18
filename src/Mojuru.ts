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
