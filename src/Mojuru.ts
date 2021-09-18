import { group, Group, subscription } from "./tools/amqp";
import { Cluster } from "./discord/cluster";
import { REST } from "@discordjs/rest";
import type { AmqpResponseOptions } from "@spectacles/brokers";
import { createLogger } from "./tools/createLogger";
import type { GatewaySendPayload, GatewayDispatchPayload } from "discord-api-types";
import type { ShardIdentifiedMessage } from "./tools/events";

const _logger = createLogger();

@group("mojuru", "gateway")
export class Mojuru extends Group {
    readonly cluster: Cluster;
    readonly rest: REST

    constructor(token: string) {
        super();

        this.cluster = new Cluster(this, token);
        this.rest = new REST({ version: "9" });
        this.rest.setToken(token);
    }

    @subscription("command")
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
