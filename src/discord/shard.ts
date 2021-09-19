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

import WebSocket from "ws";
import type { GatewayDispatchPayload, GatewayReceivePayload, GatewaySendPayload } from "discord-api-types/v9";
import { GatewayCloseCodes, GatewayDispatchEvents, GatewayIntentBits, GatewayOpcodes } from "discord-api-types/v9";
import { createLogger } from "../tools/createLogger";
import { normalize } from "../tools/buffer";
import { _heartbeater_acked, _session_id, _shard_close_sequence, _shard_log, _shard_sequence } from "./keys";
import type { Cluster } from "./cluster";
import type { Decompressor, Decompressors } from "./decompressor";
import { decompressors } from "./decompressor";
import { RateLimiter } from "./rateLimiter";
import { Heartbeater } from "./heartbeater";
import { Session } from "./session";
import { TypedEmitter } from "tiny-typed-emitter";
import { sleep } from "../tools/sleep";

const _logger = createLogger()

const _ws:           unique symbol = Symbol.for("Shard#ws")
const _state:        unique symbol = Symbol.for("Shard#state")
const _queue:        unique symbol = Symbol.for("Shard#queue")
const _connected_at: unique symbol = Symbol.for("Shard#connectedAt")

const _decompressor: unique symbol = Symbol.for("Shard#decompressor")
const _rate_limiter: unique symbol = Symbol.for("Shard#rateLimiter")
const _heart_beater: unique symbol = Symbol.for("Shard#heartBeater")
const _session:      unique symbol = Symbol.for("Shard#session")

const UNRECOVERABLE_CLOSE_CODES = [
    1005,
    GatewayCloseCodes.AuthenticationFailed,
    GatewayCloseCodes.InvalidShard,
    GatewayCloseCodes.InvalidIntents,
    GatewayCloseCodes.ShardingRequired,
    GatewayCloseCodes.DisallowedIntents
]

export class Shard extends TypedEmitter<{ state: (newState: ShardState, oldState: ShardState) => void }> {
    [_ws]?: WebSocket;

    [_decompressor]?: Decompressor;
    [_rate_limiter]: RateLimiter;
    [_heart_beater]: Heartbeater;
    [_session]: Session;

    [_state]: ShardState;
    [_queue]: GatewaySendPayload[];
    [_connected_at]?: number;
    [_shard_sequence]: number;
    [_shard_close_sequence]: number = -1;

    constructor(readonly cluster: Cluster, readonly settings: ShardSettings) {
        super()

        if (settings.decompressor) {
            this._setupDecompressor(settings.decompressor);
        }

        this[_rate_limiter] = new RateLimiter(this._logPrefix);
        this[_heart_beater] = new Heartbeater(this);
        this[_session] = new Session(this);

        this[_state] = ShardState.Idle;
        this[_queue] = [];
        this[_shard_sequence] = -1;
        this[_shard_close_sequence] = -1;
    }

    private get _url(): string {
        let url = this.settings.url!!.endsWith("/") ? this.settings.url!! : `${this.settings.url}/`;
        url += `?v=${this.settings.version}`;
        url += "&encoding=json"

        if (this[_decompressor]) {
            url += "&compress=zlib-stream"
        }

        return url;
    }

    private get _logPrefix(): string {
        const [id, total] = this.settings.id
        return `shard[${id}, ${total}] -`;
    }

    private set state(state: ShardState) {
        this.emit("state", state, this.state);
        this[_state] = state;
    }

    get state(): ShardState {
        return this[_state];
    }

    get latency(): number {
        return this[_heart_beater].latency;
    }

    get connected(): boolean {
        return this[_ws]?.readyState === WebSocket.OPEN;
    }

    connect() {
        /* update our state. */
        this.state = this.state === ShardState.Disconnected ? ShardState.Reconnecting : ShardState.Connecting;


        /* create the websocket. */
        this[_connected_at] = Date.now();
        this[_ws] = new WebSocket(this._url);
        this[_ws]!.onopen = this._onopen.bind(this);
        this[_ws]!.onmessage = this._onmessage.bind(this);
        this[_ws]!.onerror = this._onerror.bind(this);
        this[_ws]!.onclose = this._onclose.bind(this);
    }

    async destroy(reconnect: boolean = true, code: number = 1000) {
        if (!this[_ws]) {
            return;
        }

        this.state = ShardState.Disconnecting;

        this[_heart_beater].reset();
        if (this[_ws]?.readyState !== WebSocket.CLOSED) {
            try {
                if (this[_session].canResume) {
                    if (this.connected) {
                        this[_ws]?.close(4420 /* nice */, "mojuru: reconnecting...");
                    } else {
                        this[_ws]?.terminate();
                    }
                } else {
                    this[_ws]?.close(code, "mojuru: reconnecting...");
                }
            } catch (e) {
                this[_shard_log]("error", "unable to terminate ws connection.", e);
            }
        }

        this.state = ShardState.Disconnected;
        delete this[_ws];

        if (reconnect) {
            await this.reconnect();
        } else {
            this[_shard_log]("info", "disconnected from the gateway.");
        }
    }

    async reconnect() {
        if (this[_ws]) {
            this.state = ShardState.Disconnecting;
            if (this.connected) {
                this[_ws]?.close(4420, "mojuru: reconnecting...");
            } else {
                this[_ws]?.terminate();
            }

            this.state = ShardState.Disconnected;
        }

        if (this[_session].canResume) {
            this[_shard_log]("debug", "attempting to resume this session.");
            await this.queueIdentify();
        } else {
            this[_shard_log]("debug", "attempting to reconnect to the gateway.");
            await this.reconnect();
        }
    }

    async send(payload: GatewaySendPayload) {
        await this[_rate_limiter].consume();
        await this.sendNow(payload);
    }

    async sendNow(payload: GatewaySendPayload) {
        if (!this.connected) {
            this[_queue].push(payload);
            return;
        }

        const json = JSON.stringify(payload);
        this[_shard_log]("trace", "sending op", payload.op, json);
        this[_ws]?.send(json);
    }

    async awaitState(state: ShardState, timeout: number): Promise<void> {
        return new Promise(async (res, rej) => {
            const listener = (newState: ShardState) => {
                if (newState == state) {
                    res();
                    this.removeListener("state", listener);
                }
            }

            this.on("state", listener.bind(this));
            await sleep(timeout)
            rej(`Didn't receive state: ${ShardState[state]} in time.`);
        });
    }

    async queueIdentify() {
        const rateLimiter = await this.cluster.queue.getRateLimiter(this.settings.id[0]);
        rateLimiter?.consume(async () => {
            this[_session].identify().then();
            await this.awaitState(ShardState.Ready, 5000);
        });
    }

    /* websocket events */
    private _onopen() {
        this[_queue].forEach(this.send.bind(this));
        this[_shard_log]("info", "connected to the gateway, took", Date.now() - this[_connected_at]!, "ms");
    }

    private _onmessage({ data }: WebSocket.MessageEvent) {
        this[_decompressor]
            ? this[_decompressor]?.add(data)
            : this._onpacket(typeof data === "string" ? data : normalize(data));
    }

    private _onerror({ error }: WebSocket.ErrorEvent) {
        if (!error) {
            return;
        }

        this[_shard_log]("error", "websocket encountered error", error);
    }

    private async _onclose({ code, reason, wasClean }: WebSocket.CloseEvent) {
        if (this[_state] === ShardState.Disconnecting) {
            /* we meant to disconnect, nothing to do here. */
            return
        }

        this[_shard_log]("warn", `${wasClean ? "" : "non-"}clean close... code:`, code, "reason:", reason ?? "no reason provided");

        /* set the closing sequence in case we need to resume. */
        if (this[_shard_sequence] !== -1) {
            this[_shard_close_sequence] = this[_shard_sequence];
        }

        /* reset the heart-beater. */
        this[_heart_beater].reset();

        /* update our state. */
        this.state = ShardState.Disconnected;

        /* handle the close code correctly */
        switch (code) {
            case GatewayCloseCodes.UnknownError:
                this[_shard_log]("warn", "gateway encountered an unknown error, reconnecting..");
                await this.reconnect()
                break;
            case GatewayCloseCodes.UnknownOpcode:
                this[_shard_log]("warn", "gateway received an invalid opcode...");
                break;
            case GatewayCloseCodes.NotAuthenticated:
                this[_shard_log]("warn", "session wasn't authenticated.");
                this._invalidateSession();
                break;
            case GatewayCloseCodes.AuthenticationFailed:
                this[_shard_log]("emerg", "authentication failed, destroying all shards...");
                break;
            case GatewayCloseCodes.AlreadyAuthenticated:
                break;
            case GatewayCloseCodes.InvalidSeq:
                this[_shard_log]("error", "invalid sequence:", this[_shard_sequence]);
                this[_shard_sequence] = -1;
                break;
            case GatewayCloseCodes.RateLimited:
                this[_shard_log]("warn", "rate-limited? report this to the devs");
                break;
            case GatewayCloseCodes.SessionTimedOut:
                this[_shard_log]("warn", "session has timed out.");
                this._invalidateSession();
                break
            case GatewayCloseCodes.InvalidShard:
                this[_shard_log]("warn", "session has timed out.");
                this._invalidateSession();
                break;
            case GatewayCloseCodes.ShardingRequired:
                this[_shard_log]("warn", "sharding is required...");
                this._invalidateSession();
                break;
            case GatewayCloseCodes.InvalidAPIVersion:
                this[_shard_log]("warn", "an invalid api version was passed.");
                this._invalidateSession();
                break;
            case GatewayCloseCodes.InvalidIntents:
                this[_shard_log]("warn", "invalid intents were specified.");
                this._invalidateSession();
                break;
            case GatewayCloseCodes.DisallowedIntents:
                this[_shard_log]("warn", "disallowed intents were specified");
                this._invalidateSession();
                break;
            case 1006:
                this[_shard_log]("warn", "connection was reset.");
                break;
        }

        this[_shard_log]("debug", UNRECOVERABLE_CLOSE_CODES.includes(code)
            ? "unable to recover, shard is ded..."
            : "shard is able to recover, unzombifying...");

        await this.destroy(!UNRECOVERABLE_CLOSE_CODES.includes(code));
    }

    /* other private stuff */
    private async _onpacket(packet: string | Buffer) {
        let payload: GatewayReceivePayload;
        try {
            const json = packet.toString()
            payload = JSON.parse(json);
            this[_shard_log]("trace", "received payload:", json);
        } catch (e) {
            this[_shard_log]("error", "error occurred while parsing payload", e)
            return
        }

        await this._onpayload(payload);
    }

    private async _onpayload(payload: GatewayReceivePayload) {
        if (payload.s !== null) {
            const _current = this[_shard_sequence]
            if (_current !== -1 && payload.s > _current + 1) {
                this[_shard_log]("debug", `nonconsecutive sequence, ${_current} => ${payload.s}`);
            }

            this[_shard_sequence] = payload.s;
        }

        switch (payload.op) {
            case GatewayOpcodes.Hello:
                this[_shard_log]("debug", "received HELLO");
                this[_heart_beater].start(payload.d.heartbeat_interval);
                await this.queueIdentify();
                break;
            case GatewayOpcodes.Heartbeat:
                this[_heart_beater].heartbeat("request");
                break;
            case GatewayOpcodes.HeartbeatAck:
                this[_heart_beater].ack();
                break;
            case GatewayOpcodes.Dispatch:
                this._ondispatch(payload);
                break
            case GatewayOpcodes.InvalidSession:
                this[_shard_log]("warn", "session has been invalidated, resumable:", payload.d);
                if(payload.d) {
                    this[_session].resume();
                    break
                }

                this.state = ShardState.Reconnecting;
                this._invalidateSession();
                await this.queueIdentify();
                break;
            case GatewayOpcodes.Reconnect:
                this[_shard_log]("debug", "gateway asked us to reconnect.");
                await this.destroy(true);
                break;
        }
    }

    private _invalidateSession() {
        this[_shard_sequence] = -1;
        delete this[_session][_session_id];
    }

    private _ondispatch(payload: GatewayDispatchPayload) {
        switch (payload.t) {
            case GatewayDispatchEvents.Ready:
                this[_session].ready(payload.d.session_id, payload.d.user);
                this.state = ShardState.Ready;
                this[_heart_beater][_heartbeater_acked] = true;
                this[_heart_beater].heartbeat("ready");
                break
            case GatewayDispatchEvents.Resumed:
                this.state = ShardState.Ready;
                this[_heart_beater][_heartbeater_acked] = true;
                this[_heart_beater].heartbeat("resumed");
                break
        }

        this.cluster.mojuru.publishEvent(this.settings.id[0], payload);
    }

    private _setupDecompressor(decompressor: Decompressors) {
        const Decompressor = decompressors[decompressor]
        if (!Decompressor) {
            this[_shard_log]("warn", "unknown decompressor:", decompressor);
            return;
        }

        _logger.debug(`${this._logPrefix} using decompressor:`, decompressor);
        this[_decompressor] = new Decompressor()
            .on("data", this._onpacket.bind(this))
            .on("error", e => this[_shard_log]("error", "decompressor ran into an error", e))
            .on("debug", msg => this[_shard_log]("debug", msg));

        this[_decompressor]?.init();
    }

    /* internal basically. */
    [_shard_log](level: "info" | "warn" | "error" | "debug" | "trace" | "emerg", msg: string, ...args: any[]) {
        const log = `${this._logPrefix} ${msg}`;
        _logger[level](log, ...args)
    }
}

enum ShardState { Ready, Disconnected, Disconnecting, Reconnecting, Connecting, Idle }

type ShardID = [ id: number, total: number ];
type Intents = keyof typeof GatewayIntentBits;

export interface ShardSettings {
    readonly id: ShardID
    readonly url?: string;
    readonly token: string;
    readonly decompressor?: Decompressors;
    readonly version?: number;
    readonly intents?: Intents[] | number;
}
