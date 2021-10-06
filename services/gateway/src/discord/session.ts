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

import type { Shard } from "./shard";
import type { ShardSession } from "./gateway";

// hacky workaround for a possible typescript bug?
const INTENTS = {
    Guilds: 1,
    GuildMembers: 2,
    GuildBans: 4,
    GuildEmojisAndStickers: 8,
    GuildIntegrations: 16,
    GuildWebhooks: 32,
    GuildInvites: 64,
    GuildVoiceStates: 128,
    GuildPresences: 256,
    GuildMessages: 512,
    GuildMessageReactions: 1024,
    GuildMessageTyping: 2048,
    DirectMessages: 4096,
    DirectMessageReactions: 8192,
    DirectMessageTyping: 16384,
};

const properties = {
    $os: process.platform,
    $browser: "Mojuru Gateway",
    $device: "Mojuru Gateway",
};

// TODO: some how phase out this class.

export class Session {
    constructor(readonly shard: Shard) {
    }

    async get(): Promise<ShardSession> {
        return this.shard.cluster.gateway.getSession(this.shard.id);
    }

    async resume(id?: string, sequence?: number) {
        if (!id || !sequence) {
            const session = await this.get();
            if (!session.sequence || !session.id) {
                this.shard.log("warn", "unable to resume.");
                return this.new();
            }

            id = session.id;
            sequence = session.sequence;
        }

        const d = {
            session_id: id!,
            token: this.shard.settings.token,
            seq: sequence!,
        }

        await this.shard.send({ op: GatewayOpcodes.Resume, d, }, true);
    }

    async new() {
        await this.shard.cluster.gateway.setSessionSeq(this.shard.id, -1);

        const intents = Array.isArray(this.shard.settings.intents)
            ? this.shard.settings.intents.reduce((a, i) => a | INTENTS[i], 0)
            : this.shard.settings.intents;

        const d = {
            shard: this.shard.settings.shard,
            token: this.shard.settings.token,
            intents: intents === -1 ? 32509 : intents,
            properties,
        };

        await this.shard.cluster.gateway.queueIdentify(this.shard.id, d);
    }
}
