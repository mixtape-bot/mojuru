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

import { GatewayCloseCodes } from "discord-api-types/v9";
import { ExponentialBackoff, noJitterGenerator } from "cockatiel";

export const UNRECOVERABLE_CLOSE_CODES = [
    1005,
    // 1006,
    GatewayCloseCodes.AuthenticationFailed,
    GatewayCloseCodes.InvalidShard,
    GatewayCloseCodes.InvalidIntents,
    GatewayCloseCodes.ShardingRequired,
    GatewayCloseCodes.DisallowedIntents,
];

export const backoffFactory = new ExponentialBackoff({
    generator: noJitterGenerator,
    maxDelay: 30000,
    initialDelay: 5000
});

export const closeReasons = {
    [GatewayCloseCodes.UnknownOpcode]: "[lifecycle] gateway received an invalid opcode...",
    [GatewayCloseCodes.DecodeError]: "[ws] gateway received an invalid message...",
    [GatewayCloseCodes.NotAuthenticated]: "[lifecycle] session wasn't authenticated.",
    [GatewayCloseCodes.AuthenticationFailed]: "[lifecycle] authentication failed, destroying all shards...",
    [GatewayCloseCodes.AlreadyAuthenticated]: "[lifecycle] this shard has already been authenticated.",
    [GatewayCloseCodes.RateLimited]: "[lifecycle] rate-limited? report this to the devs",
    [GatewayCloseCodes.SessionTimedOut]: "[lifecycle] session has timed out.",
    [GatewayCloseCodes.InvalidShard]: "[lifecycle] session has timed out.",
    [GatewayCloseCodes.ShardingRequired]: "[lifecycle] sharding is required...",
    [GatewayCloseCodes.InvalidAPIVersion]: "[lifecycle] an invalid api version was passed.",
    [GatewayCloseCodes.InvalidIntents]: "[lifecycle] invalid intents were specified.",
    [GatewayCloseCodes.DisallowedIntents]: "[lifecycle] disallowed intents were specified",
}

export enum OpCodes {
    Dispatch = 0,
    Heartbeat = 1,
    Identify = 2,
    PresenceUpdate = 3,
    VoiceStateUpdate = 4,
    Resume = 6,
    Reconnect = 7,
    RequestGuildMembers = 8,
    InvalidSession = 9,
    Hello = 10,
    HeartbeatAck = 11
}
