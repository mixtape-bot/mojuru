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

import type { GatewayDispatchEvents } from "discord-api-types/v9";
import type { ShardSettings } from "../discord/shard";
import type { AutoSpawningOptions, ClusteredSpawningOptions, ManualSpawningOptions } from "../discord/cluster";
import * as path from "path";
import * as fs from "fs";
import * as YAML from "yaml";

export interface Config {
    discord: ConfigDiscord;
    cluster: ConfigCluster;
    amqp: ConfigAmqp;
}

export interface ConfigDiscord {
    token: string;
    gatewayVersion: number;
}

export interface ConfigCluster {
    events: GatewayDispatchEvents[];
    shard: ConfigClusterShard;
    spawning: AutoSpawningOptions | ManualSpawningOptions | ClusteredSpawningOptions;
}

export type ConfigClusterShard = Omit<ShardSettings, "id" | "token" | "version">;

export interface ConfigAmqp {
    host: string;
    group: string;
    subgroup?: string;
    commandEvent: string;
}

const configPath = path.join(process.cwd(), "mojuru.yml");

export default (function load(): Config {
    try {
        fs.accessSync(configPath, fs.constants.R_OK);
    } catch {
        throw new Error(`Unable to read config file at: ${configPath}`);
    }

    const contents = fs.readFileSync(configPath, { encoding: "utf-8" });
    return YAML.parse(contents);
})();
