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

import { APIUser, GatewayOpcodes, GatewayIntentBits } from "discord-api-types/v9";
import { _session_id, _shard_close_sequence, _shard_log } from "./keys";

import type { Shard } from "./shard";

export class Session {
    [_session_id]?: string;

    constructor(readonly shard: Shard) {
    }

    get canResume() {
        return !!this[_session_id];
    }

    ready(id: string, user: APIUser) {
        this[_session_id] = id;
        this.shard[_shard_log]("debug", `identify: identified as ${user.username}#${user.discriminator},`, "session id:", id);
    }

    async identify() {
        return this.canResume
            ? this.resume()
            : this.new();
    }

    async resume() {
        if (!this[_session_id]) {
            this.shard[_shard_log]("warn", "identify: trying to resume without a session id present?");
            return
        }

        await this.shard.send({
            op: GatewayOpcodes.Resume,
            d: {
                session_id: this[_session_id]!,
                token: this.shard.settings.token,
                seq: this.shard[_shard_close_sequence]
            }
        });

        this.shard[_shard_log]("debug", "identify: sent resume payload for session", this[_session_id]);
    }

    async new(force: boolean = false) {
        if (this[_session_id]) {
            if (!force) {
                this.shard[_shard_log]("warn", "identify: we've already identified, maybe use the force option?");
                return;
            }

            this.shard[_shard_log]("warn", "identify: a session id is already present, identifying anyways.");
        }

        const intents = Array.isArray(this.shard.settings.intents)
            ? this.shard.settings.intents.reduce((a, i) => a | GatewayIntentBits[i], 0)
            : this.shard.settings.intents ?? 0;

        await this.shard.send({
            op: GatewayOpcodes.Identify,
            d: {
                shard: this.shard.settings.id,
                intents,
                token: this.shard.settings.token,
                properties: {
                    $os: process.platform,
                    $browser: "Mojuru",
                    $device: "Mojuru"
                }
            }
        });

        this.shard[_shard_log]("debug", "identify: sent shard identify");
    }
}
