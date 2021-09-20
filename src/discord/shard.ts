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
import { normalize } from "../tools/buffer";
import { _heartbeater_acked, _redis, _session_id, _shard_close_sequence, _shard_log, _shard_sequence } from "./keys";
import type { Cluster } from "./cluster";
import { TypedEmitter } from "tiny-typed-emitter";
import { sleep } from "../tools/sleep";
import * as metrics from "../tools/metrics";
import type { CompressionLibrary } from "../tools/types";
import type { Decompressor } from "./decompressor";
import { decompressors } from "./decompressor";
import type { Encoder, Encoding } from "../tools/encoding";
import { encoders, Json } from "../tools/encoding";
import { RateLimiter } from "./rateLimiter";
import { Heartbeater } from "./heartbeater";
import { Session } from "./session";
import { getLogger } from "log4js";
import { ExponentialBackoff, IBackoff, noJitterGenerator } from "cockatiel";

const _logger = getLogger("shard")

const _ws:            unique symbol = Symbol.for("Shard#ws")
const _state:         unique symbol = Symbol.for("Shard#state")
const _queue:         unique symbol = Symbol.for("Shard#queue")
const _connected_at:  unique symbol = Symbol.for("Shard#connectedAt")
const _connections:   unique symbol = Symbol.for("Shard#connections")
const _back_off:      unique symbol = Symbol.for("Shard#retryPolicy")

const _decompressor: unique symbol = Symbol.for("Shard#decompressor")
const _rate_limiter: unique symbol = Symbol.for("Shard#rateLimiter")
const _encoder:      unique symbol = Symbol.for("Shard#encoding")
const _heart_beater: unique symbol = Symbol.for("Shard#heartBeater")
const _session:      unique symbol = Symbol.for("Shard#session")

const UNRECOVERABLE_CLOSE_CODES = [
    1005,
    // 1006,
    GatewayCloseCodes.AuthenticationFailed,
    GatewayCloseCodes.InvalidShard,
    GatewayCloseCodes.InvalidIntents,
    GatewayCloseCodes.ShardingRequired,
    GatewayCloseCodes.DisallowedIntents
]

const maxAttempts = 3;
const backoffFactory = new ExponentialBackoff({ generator: noJitterGenerator, maxDelay: 30000, initialDelay: 5000 });

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

export class Shard extends TypedEmitter<{ state: (newState: ShardState, oldState: ShardState) => void }> {
    [_ws]?: WebSocket;

    [_decompressor]?: Decompressor;
    [_encoder]: Encoder;
    [_rate_limiter]: RateLimiter;
    [_heart_beater]: Heartbeater;
    [_session]: Session;

    [_state]: ShardState;
    [_queue]: GatewaySendPayload[];
    [_connected_at]?: number;
    [_connections]: number;
    [_back_off]?: IBackoff<number>;
    [_shard_sequence]: number;
    [_shard_close_sequence]: number = -1;

    constructor(readonly cluster: Cluster, readonly settings: ShardSettings) {
        super()

        if (settings.decompressor) {
            this._setupDecompressor(settings.decompressor);
        }

        this._setupEncoder(settings.encoding);

        this[_rate_limiter] = new RateLimiter(this._logPrefix);
        this[_heart_beater] = new Heartbeater(this);
        this[_session] = new Session(this);

        this[_state] = ShardState.Idle;
        this[_queue] = [];
        this[_connections] = 0;
        this[_shard_sequence] = -1;
        this[_shard_close_sequence] = -1;
    }

    private get _url(): string {
        let url = this.settings.url!.endsWith("/") ? this.settings.url! : `${this.settings.url}/`;
        url += `?v=${this.settings.version}`;
        url += `&encoding=${this[_encoder].encoding}`;

        if (this[_decompressor]) {
            url += `&compress=${this[_decompressor]?.type}`
        }

        return url;
    }

    private get _logPrefix(): string {
        return `[${this.id}]`;
    }

    get id(): number {
        return this.settings.shard[0];
    }

    get state(): ShardState {
        return this[_state];
    }

    set state(state: ShardState) {
        this.emit("state", state, this.state);
        this[_state] = state;
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
        try {
            this[_shard_log]("debug", "[ws] creating websocket connection with url:", this._url)
            this[_ws] = new WebSocket(this._url);
            this[_connected_at] = Date.now();
        } catch (e) {
            this[_shard_log]("fatal", "[ws] cannot connect to the gateway?", e);
            return;
        }

        this[_ws]!.onopen = this._onopen.bind(this);
        this[_ws]!.onmessage = this._onmessage.bind(this);
        this[_ws]!.onerror = this._onerror.bind(this);
        this[_ws]!.onclose = this._onclose.bind(this);
    }

    async destroy({ reconnect = false, code = 1_000, invalidateSession = false }: DestroyOptions = {}) {
        if (!this[_ws]) {
            return;
        }

        this.state = ShardState.Disconnecting;

        this[_heart_beater].reset();
        // @ts-expect-error
        if ([ WebSocket.CLOSED, WebSocket.CLOSING ].includes(this[_ws]!.readyState)) {
            try {
                if (reconnect && this[_session].canResume) {
                    if (this.connected) {
                        this[_ws]?.close(4_420 /* nice */, "[mojuru] reconnecting...");
                    } else {
                        this[_ws]?.terminate();
                    }
                } else {
                    this[_ws]?.close(code, "[mojuru] reconnecting...");
                }
            } catch (e) {
                this[_shard_log]("error", "[ws] unable to terminate ws connection.", e);
            }
        }

        /* reset the decompressor context. */
        if (this.settings.decompressor) {
            this[_decompressor]?.close();
            this._setupDecompressor(this.settings.decompressor);
        }

        /* set our state as disconnected... */
        this.state = ShardState.Disconnected;

        /* delete the current websocket. */
        delete this[_ws];

        /* invalidate our current session if required. */
        if (invalidateSession) {
            this._invalidateSession();
        }

        /* reconnect if required. */
        if (reconnect) {
            return await this.reconnect();
        }

        this[_shard_log]("info", "[lifecycle] disconnected from the gateway.");
    }

    async reconnect() {
        if (this[_ws]) {
            this.state = ShardState.Disconnecting;
            if (this.connected) {
                this[_ws]?.close(4_420, "[mojuru] reconnecting...");
            } else {
                this[_ws]?.terminate();
            }

            this.state = ShardState.Disconnected;
        }

        this[_shard_log]("debug", this[_session].canResume
            ? "[lifecycle] attempting to resume the current session."
            : "[lifecycle] attempting to reconnect to the gateway.");

        return this.queueConnect();
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

        let data
        try {
            data = this[_encoder].encode(payload);
        } catch (e) {
            this[_shard_log]("warn", "[encoding] failed to encode payload", JSON.stringify(payload), e)
            return
        }

        metrics.packetsSent.labels({ shard: this.id, op: OpCodes[payload.op] }).inc();
        this[_ws]?.send(data);
    }

    async awaitState(state: ShardState, timeout: number): Promise<void> {
        return new Promise(async (res, rej) => {
            let _timeout: NodeJS.Timeout;
            const listener = (newState: ShardState) => {
                if (newState == state) {
                    res();
                    clearTimeout(_timeout);
                    this.removeListener("state", listener);
                }
            }

            this.on("state", listener.bind(this));
            _timeout = setTimeout(() => rej(`Didn't receive state: ${ShardState[state]} in time.`), timeout);
        });
    }

    async queueConnect(): Promise<void> {
        if (this[_connections] >= maxAttempts) {
            this[_shard_log]("debug", "[ws] exceeded the maximum of", maxAttempts, "back-to-back reconnections...");
            return await this.destroy({ reconnect: false, invalidateSession: true, code: 1_001 });
        }

        if (this[_back_off]) {
            const duration = this[_back_off]!.duration
            this[_shard_log]("debug", "[ws] waiting", duration, "ms")
            await sleep(duration);
        }

        this.connect();
        this[_back_off] = this[_back_off]?.next(this[_connections]++) ?? backoffFactory.next();
    }

    queueIdentify() {
        const rateLimiter = this.cluster.queue.getRateLimiter(this.settings.shard[0]);
        rateLimiter?.consume(async () => {
            void this[_session].identify();
            try {
                await this.awaitState(ShardState.Ready, 5000);
            } catch {
                this[_shard_log]("debug", "[lifecycle] didn't become ready in time, attempting to re-identify?");
                this.queueIdentify();
            }
        });
    }

    /* websocket events */
    private _onopen() {
        metrics.shardsAlive.labels({ id: this.id }).inc();
        this[_connections] = 0;
        this[_queue].forEach(this.send.bind(this));
        this[_shard_log]("info", "[ws] connected to the gateway, took", Date.now() - this[_connected_at]!, "ms");
    }

    private _onmessage({ data }: WebSocket.MessageEvent) {
        this[_decompressor] /*&& typeof data !== "string"*/ // don't decompress non-binary data?
            ? this[_decompressor]?.add(data)
            : this._handlePayload(typeof data === "string" ? data : normalize(data));
    }

    private _onerror({ error }: WebSocket.ErrorEvent) {
        if (!error) {
            return;
        }

        this[_shard_log]("error", "[ws] websocket encountered error", error);
    }

    private async _onclose({ code, reason, wasClean }: WebSocket.CloseEvent) {
        if ([ ShardState.Disconnecting, ShardState.Disconnected ].includes(this.state)) {
            /* we meant to disconnect, nothing to do here. */
            return
        }

        this[_shard_log]("warn", `[ws] ${wasClean ? "" : "non-"}clean close... code:`, code, "reason:", reason ?? "no reason provided");

        /* set the closing sequence in case we need to resume. */
        if (this[_shard_sequence] !== -1) {
            this[_shard_close_sequence] = this[_shard_sequence];
            this[_shard_sequence] = -1;
        }

        /* reset the heart-beater. */
        this[_heart_beater].reset();

        /* update our state. */
        this.state = ShardState.Disconnected;

        /* handle the close code correctly */
        let invalidateSession = false;
        switch (code) {
            case GatewayCloseCodes.UnknownError:
                this[_shard_log]("warn", "[lifecycle] gateway encountered an unknown error, reconnecting...");
                await this.reconnect()
                break;
            case GatewayCloseCodes.UnknownOpcode:
                this[_shard_log]("warn", "[lifecycle] gateway received an invalid opcode...");
                break;
            case GatewayCloseCodes.DecodeError:
                this[_shard_log]("warn", "[ws] gateway received an invalid message...");
                break;
            case GatewayCloseCodes.NotAuthenticated:
                this[_shard_log]("warn", "[lifecycle] session wasn't authenticated.");
                invalidateSession = true;
                break;
            case GatewayCloseCodes.AuthenticationFailed:
                this[_shard_log]("fatal", "[lifecycle] authentication failed, destroying all shards...");
                break;
            case GatewayCloseCodes.AlreadyAuthenticated:
                this[_shard_log]("fatal", "[lifecycle] this shard has already been authenticated.");
                break;
            case GatewayCloseCodes.InvalidSeq:
                this[_shard_log]("error", "[lifecycle] invalid sequence:", this[_shard_sequence]);
                this[_shard_sequence] = -1;
                break;
            case GatewayCloseCodes.RateLimited:
                this[_shard_log]("warn", "[lifecycle] rate-limited? report this to the devs");
                break;
            case GatewayCloseCodes.SessionTimedOut:
                this[_shard_log]("warn", "[lifecycle] session has timed out.");
                invalidateSession = true;
                break
            case GatewayCloseCodes.InvalidShard:
                this[_shard_log]("warn", "[lifecycle] session has timed out.");
                invalidateSession = true;
                break;
            case GatewayCloseCodes.ShardingRequired:
                this[_shard_log]("warn", "[lifecycle] sharding is required...");
                invalidateSession = true;
                break;
            case GatewayCloseCodes.InvalidAPIVersion:
                this[_shard_log]("warn", "[lifecycle] an invalid api version was passed.");
                invalidateSession = true;
                break;
            case GatewayCloseCodes.InvalidIntents:
                this[_shard_log]("warn", "[lifecycle] invalid intents were specified.");
                invalidateSession = true;
                break;
            case GatewayCloseCodes.DisallowedIntents:
                this[_shard_log]("warn", "[lifecycle] disallowed intents were specified");
                invalidateSession = true;
                break;
            case 1006:
                this[_shard_log]("warn", "[ws] connection was reset.");
                break;
        }

        this[_shard_log]("debug", UNRECOVERABLE_CLOSE_CODES.includes(code)
            ? "[lifecycle] unable to recover, shard is ded..."
            : "[lifecycle] shard is able to recover, unzombifying...");

        await this.destroy({ reconnect: !UNRECOVERABLE_CLOSE_CODES.includes(code), invalidateSession });
    }

    /* other private stuff */
    private async _handlePayload(packet: string | Buffer) {
        let payload: GatewayReceivePayload;
        try {
            payload = this[_encoder].decode(packet);
        } catch (e) {
            this[_shard_log]("error", "[lifecycle] error occurred while parsing payload", e)
            return
        }

        metrics.packetsReceived
            .labels({ shard: this.id, t: "t" in payload ? payload.t : "", op: OpCodes[payload.op] })
            .inc();

        await this._handleReceivePayload(payload);
    }

    private async _handleReceivePayload(payload: GatewayReceivePayload) {
        if (payload.s !== null) {
            const _current = this[_shard_sequence]
            if (_current !== -1 && payload.s > _current + 1) {
                this[_shard_log]("debug", `[lifecycle] nonconsecutive sequence, ${_current} => ${payload.s}`);
            }

            this[_shard_sequence] = payload.s;
            this.cluster.mojuru.redis?.set(_redis.shard_seq(this.id), this[_shard_sequence]);
        }

        switch (payload.op) {
            case GatewayOpcodes.Hello:
                this[_shard_log]("debug", "[lifecycle] received HELLO");
                this[_heart_beater].start(payload.d.heartbeat_interval);
                await this._handleIdentify();
                break;
            case GatewayOpcodes.Heartbeat:
                this[_heart_beater].heartbeat("request");
                break;
            case GatewayOpcodes.HeartbeatAck:
                this[_heart_beater].ack();
                break;
            case GatewayOpcodes.Dispatch:
                this._handleDispatch(payload);
                break
            case GatewayOpcodes.InvalidSession:
                this[_shard_log]("warn", "[identify] session has been invalidated, resumable:", payload.d);
                if (payload.d) {
                    this[_session].resume();
                    break
                }

                this.state = ShardState.Reconnecting;
                this._invalidateSession();
                await this.queueIdentify();
                break;
            case GatewayOpcodes.Reconnect:
                this[_shard_log]("debug", "[lifecycle] gateway asked us to reconnect.");
                await this.destroy({ reconnect: true });
                break;
        }
    }

    private _invalidateSession() {
        this[_shard_sequence] = -1;
        delete this[_session][_session_id];

        /* delete the seq & session id from redis. */
        this.cluster.mojuru.redis?.del(_redis.session_id(this.id));
        this.cluster.mojuru.redis?.del(_redis.shard_seq(this.id));
    }

    private async _handleIdentify() {
        if (this.cluster.mojuru.redis) {
            this[_shard_log]("debug", "[identify] attempting to retrieve session from redis.");

            /* get the sequence & session. */
            const sessionId = await this.cluster.mojuru.redis.get(_redis.session_id(this.id))
                , sequence = await this.cluster.mojuru.redis.get(_redis.shard_seq(this.id));

            /* if we found a session id & sequence then resume the session. */
            if (sessionId && sequence) {
                this[_shard_log]("debug", "[identify] found session id & sequence.");
                this[_shard_sequence] = this[_shard_close_sequence] = +sequence;
                this[_session][_session_id] = sessionId;
                return this[_session].resume()
            }
        }

        /* queue an identify. */
        this.queueIdentify();
    }

    private _handleDispatch(payload: GatewayDispatchPayload) {
        switch (payload.t) {
            case GatewayDispatchEvents.Ready:
                this.state = ShardState.Ready;
                this.cluster.whoami ??= payload.d.user;

                /* notify the session manager that we have received READY. */
                this[_session].ready(payload.d.session_id);

                /* send a ready heartbeat. */
                this[_heart_beater][_heartbeater_acked] = true;
                this[_heart_beater].heartbeat("ready");
                break
            case GatewayDispatchEvents.Resumed:
                this[_shard_log]("debug", "[identify] session", this[_session][_session_id], "has been resumed.");
                this.state = ShardState.Ready;
                this[_heart_beater][_heartbeater_acked] = true;
                this[_heart_beater].heartbeat("resumed");
                break
        }

        this.cluster.mojuru.publishEvent(this.id, payload);
    }

    private _setupDecompressor(decompressor: CompressionLibrary) {
        this[_decompressor] = new decompressors[decompressor]()
            .on("data", this._handlePayload.bind(this))
            .on("error", e => this[_shard_log]("error", "[compress] ran into an error", e))
            .on("debug", msg => this[_shard_log]("debug", msg));

        this[_decompressor]?.init();
    }

    private _setupEncoder(encoding: Encoding) {
        let Encoder = encoders[encoding] ?? Json;
        this[_encoder] = new Encoder();
    }

    /* internal basically. */
    [_shard_log](level: "info" | "warn" | "error" | "debug" | "trace" | "fatal", msg: string, ...args: any[]) {
        const log = `${this._logPrefix} ${msg}`;
        _logger[level](log, ...args)
    }
}

enum ShardState { Ready, Disconnected, Disconnecting, Reconnecting, Connecting, Idle }

type DiscordShard = [ id: number, total: number ];
type Intents = keyof typeof GatewayIntentBits;

interface DestroyOptions {
    code?: number;
    reconnect?: boolean;
    invalidateSession?: boolean;
}

export interface ShardSettings {
    shard: DiscordShard
    url?: string;
    token: string;
    decompressor?: CompressionLibrary;
    encoding: Encoding;
    version?: number;
    intents?: Intents[] | number;
}
