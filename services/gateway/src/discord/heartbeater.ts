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

import { GatewayOpcodes } from "discord-api-types/v9";
import * as metrics from "../tools/metrics";

import type { Shard } from "./shard";
import { clearInterval, createInterval } from "../tools/timeouts";

export class Heartbeater {
    acked = false;
    latency = -1;

    private last = 0;
    private delay?: number;
    private interval?: NodeJS.Timeout;

    constructor(readonly shard: Shard) {
    }

    start(delay: number) {
        this.reset();

        this.shard.log("debug", "[heartbeat] now heart-beating every", delay, "milliseconds");

        this.delay = delay;
        this.interval = createInterval(this.shard, delay, this.heartbeat.bind(this, "interval")).ref();
    }

    reset() {
        if (this.interval) {
            clearInterval(this.shard, this.interval!);
            delete this.interval;
        }

        this.acked = false;
        this.last = 0;
        this.latency = -1;

        delete this.delay;
    }

    ack() {
        this.acked = true;
        this.latency = Date.now() - this.last
        metrics.latency.labels({ id: this.shard.id }).observe(this.latency);
        this.shard.log("trace", "[heartbeat] last heartbeat was acknowledged, latency:", this.latency, "ms");
    }

    async heartbeat(reason: string, ignoreNonAcked: boolean = false) {
        if (!this.acked) {
            this.shard.log("warn", `[heartbeat/${reason}]`, "last heartbeat was not acked,", `ignoring=${ignoreNonAcked}`);
            if (!ignoreNonAcked) {
                await this.shard.disconnect({ reconnect: true, code: 1_012 });
                return;
            }
        }

        const { sequence } = await this.shard.session.get()
        await this.shard.send({ op: GatewayOpcodes.Heartbeat, d: sequence === -1 ? null : sequence });

        this.acked = false;
        this.last = Date.now();
        this.shard.log("trace", `[heartbeat/${reason}]`, "sent heartbeat");
    }
}
