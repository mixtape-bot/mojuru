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

import type { GatewayIntentBits } from "discord-api-types";

export type CompressionLibrary = "fast-zlib" | "zlib-sync" | "zlib";

export type CompressionAlgorithm = "zlib-stream";

export type CompressedData = string | Buffer | ArrayBuffer | Buffer[];

export type EncodedData = string | Buffer | Buffer[] | ArrayBuffer;

export type Encoding = "etf" | "json";

export type DiscordShard = [ id: number, total: number ];

export type Intents = keyof typeof GatewayIntentBits;

export interface ShardIdentifiedMessage {
    shard_id?: number;
    payload: Buffer;
}

export interface GuildIdentifiedMessage {
    guild_id: string;
    payload: Buffer;
}
