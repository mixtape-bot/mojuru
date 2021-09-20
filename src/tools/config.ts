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
import * as path from "path";
import * as fs from "fs";
import * as TOML from "toml";

export interface Config {
    discord: DiscordConfig;
    cluster: ClusterConfig;
    amqp: AmqpConfig;
    metrics: MetricsConfig
    redis?: RedisConfig;
}

export interface MetricsConfig {
    enabled: boolean;
    port: number;
    endpoint: string;
}

export interface DiscordConfig {
    token: string;
    gateway_version: number;
    api_url: string;
}

export interface ClusterConfig {
    events: GatewayDispatchEvents[];
    shard_options: ConfigClusterShard;
    sharding: AutoSpawningOptions | ManualSpawningOptions | ClusteredSpawningOptions;
}

export interface RedisConfig {
    host?: string;
    port?: number;
    password?: string;
    database?: number;
}

export interface SpawningOptions {
    type?: "auto" | "manual" | "clustered";
}

export interface AutoSpawningOptions extends SpawningOptions {
    type?: "auto";
}

export interface ManualSpawningOptions extends SpawningOptions {
    type: "manual";
    shard_total: number;
    shards?: number[] | ShardRange;
}

export interface ClusteredSpawningOptions extends SpawningOptions {
    type: "clustered";
    cluster_id: number;
    shard_total: number;
    shards_per_cluster: number;
}

export interface ShardRange {
    first_id: number;
    last_id: number;
}

export type ConfigClusterShard = Partial<Omit<ShardSettings, "shard" | "token" | "version">>;

export interface AmqpConfig {
    host: string;
    group: string;
    subgroup?: string;
    command_event: string;
}

const configPath = path.join(process.cwd(), "mojuru.toml");

function load(): Config {
    try {
        fs.accessSync(configPath, fs.constants.R_OK);
    } catch {
        throw new Error(`Unable to read config file at: ${configPath}`);
    }

    const contents = fs.readFileSync(configPath, { encoding: "utf-8" });
    return TOML.parse(contents);
}

export default load();
