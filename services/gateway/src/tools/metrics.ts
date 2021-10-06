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

import { collectDefaultMetrics, Counter, Gauge, register, Summary } from "prom-client";
import { createServer, IncomingMessage, ServerResponse } from "http";
import config from "./config";
import { getLogger } from "log4js";

collectDefaultMetrics({
    gcDurationBuckets: [ 0.001, 0.01, 0.1, 1, 2, 5 ],
});

export const packetsReceived = new Counter({
    name: "packets_received",
    help: "The number of packets that have been received.",
    labelNames: [ "op", "shard", "t" ],
});

export const packetsSent = new Counter({
    name: "packets_sent",
    help: "The number of packets that have been sent.",
    labelNames: [ "op", "shard" ],
});

export const latency = new Summary({
    name: "latency",
    help: "Latency between shard heartbeats and their acknowledgements (in milliseconds).",
    percentiles: [ 0.5, 0.9, 0.95, 0.99 ],
    labelNames: [ "id" ],
});

export const shardsAlive = new Gauge({
    name: "shards_alive",
    help: "Number of shards that are online.",
    labelNames: [ "id" ],
});

export const shardsTotal = new Gauge({
    name: "shards_total",
    help: "Number of shards that should be online.",
});

if (config.metrics.enabled) {
    const _logger = getLogger("metrics");
    const _server = createServer(onRequest);

    _server.once("listening", () => _logger.info(`metrics now listening on http://localhost:${config.metrics.port}${config.metrics.endpoint}`));
    _server.on("error", (e) => _logger.error("metrics errored:", e));
    _server.listen(config.metrics.port);
}

async function onRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.url! === config.metrics.endpoint) {
        res.writeHead(200, { "Content-Type": register.contentType });
        res.write(await register.metrics());
    } else if (req.url! === "/favicon.ico") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.write("{\"message\":\"no\"}");
    } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.write("{\"message\":\"no\"}");
    }

    res.end();
}
