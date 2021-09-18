import type { GatewayDispatchPayload } from "discord-api-types";
import type { Mojuru } from "../Mojuru";

export class Cluster {
    constructor(readonly mojuru: Mojuru) {
    }

    handleDispatch(shardId: number, payload: GatewayDispatchPayload) {
        const bytes = Buffer.from(JSON.stringify(payload));
        this.mojuru.broker.publish("event", {
            shard_id: shardId,
            payload: bytes
        });
    }
}
