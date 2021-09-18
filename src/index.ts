import { Mojuru } from "./Mojuru";
import config from "./tools/config";

async function main() {
    const mojuru = new Mojuru();
    await mojuru.broker.connect(config.amqp.host);
    await mojuru.cluster.spawn(config.cluster.spawning);
}

void main();
