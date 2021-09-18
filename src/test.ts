import { createAmqpBroker } from "./tools/amqp";
import type { ShardIdentifiedMessage } from "./tools/events";
import { ActivityType, GatewayOpcodes,  PresenceUpdateStatus } from "discord-api-types/v9";

async function main() {
    const broker = createAmqpBroker("mojuru", "gateway");
    broker.on("MESSAGE_CREATE", (event: ShardIdentifiedMessage, { ack }) => {
        console.log(JSON.parse(event.payload.toString()));
        ack();
    });

    broker.on("GUILD_CREATE", (event: ShardIdentifiedMessage, { ack }) => {
        console.log(JSON.parse(event.payload.toString()));
        ack();
    });

    await broker.connect("localhost")
    broker.subscribe(["MESSAGE_CREATE", "GUILD_CREATE"]);
    broker.publish("command", {
        shard_id: 0,
        payload: Buffer.from(JSON.stringify({
            op: GatewayOpcodes.PresenceUpdate,
            d: {
                status: PresenceUpdateStatus.DoNotDisturb,
                activities: [
                    {
                        type: ActivityType.Listening,
                        name: "events using Mojuru!"
                    }
                ],
                afk: false,
                since: null,
            }
        }))
    });
}

void main();
