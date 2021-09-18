import "reflect-metadata";
import { Shard } from "./discord/shard";
import { Cluster } from "./discord/cluster";
import { Mojuru } from "./Mojuru";
import { GatewayIntentBits } from "discord-api-types/v9";

const mojuru = new Mojuru();
const cluster = new Cluster(mojuru);

const shard = new Shard(cluster, {
    url: "wss://gateway.discord.gg/?v=9&compress=zlib-stream",
    token: process.env["TOKEN"]!,
    decompressor: "zlib",
    version: 9,
    id: [ 0, 1 ],
    intents: [ GatewayIntentBits.GuildMessages ]
});

shard.connect();
