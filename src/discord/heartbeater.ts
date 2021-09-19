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

import { _heartbeater_acked, _shard_log, _shard_sequence } from "./keys";
import { GatewayOpcodes } from "discord-api-types/v9";

import type { Shard } from "./shard";

const _last:     unique symbol = Symbol.for("Heartbeater#last")
const _latency:  unique symbol = Symbol.for("Heartbeater#latency")
const _delay:    unique symbol = Symbol.for("Heartbeater#delay")
const _interval: unique symbol = Symbol.for("Heartbeater#interval")

export class Heartbeater {
    [_heartbeater_acked] = false;

    private [_last] = 0;
    private [_latency] = -1;
    private [_delay]?: number;
    private [_interval]?: NodeJS.Timeout;

    constructor(readonly shard: Shard) {
    }

    get latency() {
        return this[_latency];
    }

    start(delay: number) {
        this.reset();

        this.shard[_shard_log]("debug", "heartbeat: now heartbeating every", delay, "milliseconds");

        this[_delay] = delay;
        this[_interval] = setInterval(this.heartbeat.bind(this, "interval"), delay);
    }

    reset() {
        if (this[_interval]) {
            clearInterval(this[_interval]!);
        }

        this[_heartbeater_acked] = false;
        this[_last] = 0;
        this[_latency] = -1;

        delete this[_delay];
        delete this[_interval];
    }

    ack() {
        this[_heartbeater_acked] = true;
        this[_latency] = Date.now() - this[_last]
        this.shard[_shard_log]("debug", "heartbeat: last heartbeat was acknowledged, latency:", this[_latency], "ms");
    }

    async heartbeat(reason: string, ignoreNonAcked: boolean = false) {
        if (!this[_heartbeater_acked]) {
            this.shard[_shard_log]("warn", `heartbeat(${reason}):`, "last heartbeat was not acked,", `ignoring=${ignoreNonAcked}`);
            if (!ignoreNonAcked) {
                await this.shard.destroy(true, 1012);
                return;
            }
        }

        await this.shard.send({
            op: GatewayOpcodes.Heartbeat,
            d: this.shard[_shard_sequence]
        });

        this[_last] = Date.now();
        this.shard[_shard_log]("debug", `heartbeat(${reason}):`, "sent heartbeat");
    }
}
