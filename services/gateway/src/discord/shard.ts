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

import WebSocket from "ws";
import type { GatewayDispatchPayload, GatewayReceivePayload, GatewaySendPayload } from "discord-api-types/v9";
import { GatewayCloseCodes, GatewayDispatchEvents, GatewayOpcodes } from "discord-api-types/v9";
import type { Cluster } from "./cluster";
import { TypedEmitter } from "tiny-typed-emitter";
import { normalize, sleep } from "../tools/functions";
import * as metrics from "../tools/metrics";
import type { CompressionLibrary, DiscordShard, Encoding, Intents } from "../tools/types";
import type { Compression } from "./decompressor";
import { CHUNK_SIZE, decompressors } from "./decompressor";
import { Encoder, encoders, Json } from "../tools/encoding";
import { AsyncLimiter } from "./limiter";
import { Heartbeater } from "./heartbeater";
import { Session } from "./session";
import { getLogger } from "log4js";
import type { IBackoff } from "cockatiel";
import { backoffFactory, closeReasons, OpCodes, UNRECOVERABLE_CLOSE_CODES } from "../tools/constants";
import { clearScope, clearTimeout, createTimeout, TimeoutScope } from "../tools/timeouts";

const _logger = getLogger("shard");

/*
 * TODO: handle states better, they're a bit jumpy when it comes to reconnections
 * TODO: maybe emit ShardState changes over RMQ?
 */

enum ShardState {
    /**
     * The shard is currently idle, doing nothing.
     * @type {ShardState.Idle}
     */
    Idle,
    /**
     * The shard has
     * @type {ShardState.Ready}
     */
    Ready,
    /**
     * The shard is currently disconnecting.
     * @type {ShardState.Disconnecting}
     */
    Disconnecting,
    /**
     * The shard has been disconnected.
     * @type {ShardState.Disconnected}
     */
    Disconnected,
    /**
     * The shard is currently reconnecting.
     * @type {ShardState.Reconnecting}
     */
    Reconnecting,
    /**
     * The shard is currently connecting.
     * @type {ShardState.Connecting}
     */
    Connecting,
    /**
     * The shard is resuming the current session.
     * @type {ShardState.Resuming}
     */
    Resuming,
    /**
     * The shard is identifying with the gateway.
     * @type {ShardState.Identifying}
     */
    Identifying,
    /**
     * The shard has been destroyed, it must be remade to function again.
     * @type {ShardState.Destroyed}
     */
    Destroyed
}

export interface Shard extends TypedEmitter {
    readonly cluster: Cluster;
    readonly settings: ShardSettings;
    readonly session: Session;

    get id(): number;

    get latency(): number;

    connect(): void;

    disconnect(options?: DisconnectOptions): Promise<void>;

    destroy(): Promise<void>;

    send(payload: GatewaySendPayload, important?: boolean): Promise<void>;

    sendNow(payload: GatewaySendPayload): Promise<void>;

    log(level: LogLevel, msg: string, ...args: any[]): void;
}

export class ShardImpl extends TypedEmitter<ShardEvents> implements Shard, TimeoutScope {
    private static readonly DEFAULT_TOKENS = 120;
    private static readonly DEFAULT_EXPIRATION = 60 * 1000;

    readonly encoder!: Encoder;
    readonly rateLimiter: AsyncLimiter;
    readonly heartBeater: Heartbeater;
    readonly session: Session;

    decompressor?: Compression;
    state: ShardState;

    private ws?: WebSocket;
    private connectedAt?: number;
    private connections: number;
    private backoff?: IBackoff<number>;

    constructor(readonly cluster: Cluster, readonly settings: ShardSettings) {
        super();

        this.encoder = new (encoders[settings.encoding] ?? Json)();
        this.heartBeater = new Heartbeater(this);
        this.session = new Session(this);
        this.rateLimiter = new AsyncLimiter(ShardImpl.DEFAULT_TOKENS, ShardImpl.DEFAULT_EXPIRATION)
            .on("limited", () => _logger.warn(`hit the request rate-limit, waiting 60 seconds.`))

        this.state = ShardState.Idle;
        this.connections = 0;
    }

    private get _url(): string {
        let url = this.settings.url.endsWith("/") ? this.settings.url : `${this.settings.url}/`;
        url += `?v=${this.settings.version}`;
        url += `&encoding=${this.encoder.encoding}`;

        if (this.decompressor) {
            url += `&compress=${this.decompressor?.type}`;
        }

        return url;
    }

    private get _logPrefix(): string {
        return `[${this.id}]`;
    }

    get id(): number {
        return this.settings.shard[0];
    }

    get latency(): number {
        return this.heartBeater.latency;
    }

    get connected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    connect() {
        if (this.state === ShardState.Destroyed) {
            return;
        }

        this._setState(this.state === ShardState.Disconnected ? ShardState.Reconnecting : ShardState.Connecting);
        if (this.settings.decompressor) {
            this._setupDecompressor(this.settings.decompressor);
        }

        try {
            this.log("debug", "[ws] creating websocket connection with url:", this._url);
            this.ws = new WebSocket(this._url, {
                perMessageDeflate: this.settings.encoding === "json"
                    ? { zlibInflateOptions: { chunkSize: CHUNK_SIZE } }
                    : void 0
            });

            this.connectedAt = Date.now();
        } catch (e) {
            this.log("fatal", "[ws] cannot connect to the gateway?", e);
            return;
        }

        this.ws!.onopen = this._onopen.bind(this);
        this.ws!.onmessage = this._onmessage.bind(this);
        this.ws!.onerror = this._onerror.bind(this);
        this.ws!.onclose = this._onclose.bind(this);
    }

    async disconnect({ reconnect = false, code = 1_000, fatal = false }: DisconnectOptions = {}): Promise<void> {
        if (!this.ws) {
            return;
        }

        this._setState(ShardState.Disconnecting);

        this.ws.removeAllListeners();
        this.heartBeater.reset();
        if (this.ws!.readyState === WebSocket.OPEN) {
            const canResume = await this.cluster.gateway.canResume(this.id)
            await this._close("reconnecting...", { code: reconnect && canResume ? 4_420 : code });
        }

        this._setState(ShardState.Disconnected);
        if (fatal) {
            await this.cluster.gateway.invalidateSession(this.id);
        }

        if (reconnect) {
            await this.reconnect(true);
            return;
        }

        this.log("info", "[lifecycle] disconnected from the gateway.");
    }

    async destroy() {
        this.log("fatal", "shard is now being destroyed.");
        this._setState(ShardState.Destroyed);
        await this.disconnect({ reconnect: false, fatal: true });
        clearScope(this);
    }

    async reconnect(wait = true) {
        if (this.connected) {
            await this._close("reconnecting...");
        }

        this.log("debug", await this.cluster.gateway.canResume(this.id)
            ? "[lifecycle] attempting to resume the current session."
            : "[lifecycle] attempting to reconnect to the gateway.");

        return this.queueConnect(wait);
    }

    async send(payload: GatewaySendPayload, important: boolean = false) {
        if (this.state === ShardState.Destroyed) {
            return;
        }

        await this.rateLimiter.consume(this.sendNow.bind(this, payload), important);
    }

    async sendNow(payload: GatewaySendPayload) {
        if (this.state === ShardState.Destroyed) {
            return;
        }

        let data;
        try {
            data = this.encoder.encode(payload);
        } catch (e) {
            this.log("warn", "[encoding] failed to encode payload", JSON.stringify(payload), e);
            return;
        }

        metrics.packetsSent.labels({ shard: this.id, op: OpCodes[payload.op] }).inc();
        this.ws?.send(data);
    }

    async awaitState(timeout: number, ...states: ShardState[]): Promise<ShardState | null> {
        return new Promise(async (res, rej) => {
            let _timeout: NodeJS.Timeout;
            const listener = (state: ShardState) => {
                if (states.includes(state)) {
                    res(state);
                    clearTimeout(this, _timeout);
                    this.removeListener("state", listener);
                }
            };

            this.on("state", listener.bind(this));
            _timeout = createTimeout(this, timeout, () => rej(`Didn't receive state(s): ${states
                .map(s => ShardState[s])
                .join(", ")} in time.`));
        });
    }

    async queueConnect(wait: boolean = true): Promise<void> {
        if (this.settings.max_reconnects !== -1 && this.connections >= this.settings.max_reconnects) {
            this.log("debug", "[ws] exceeded the maximum of", this.settings.max_reconnects, "back-to-back reconnections...");
            return this.disconnect({ reconnect: false, fatal: true, code: 1_001 });
        }

        if (wait && this.backoff) {
            const duration = this.backoff!.duration;
            this.log("debug", "[ws] waiting", duration, "ms");
            await sleep(duration);
            this.backoff = this.backoff?.next(this.connections++) ?? backoffFactory.next();
        }

        this.connect();
    }

    async queueIdentify() {
        await this.session.new();
        try {
            await this.awaitState(this.settings.ready_timeout, ShardState.Ready);
        } catch {
            this.log("debug", "[lifecycle] didn't become ready in time, reconnecting...");
            await this.disconnect({ reconnect: true, fatal: true });
        }
    }

    /* websocket events */
    private async _onopen() {
        metrics.shardsAlive.labels({ id: this.id }).inc();

        this.log("info", "[ws] connected to the gateway, took", Date.now() - this.connectedAt!, "ms");
        await this.rateLimiter.unlock();

        /* reset old-connection stuff. */
        this.connections = 0;
        this.backoff = backoffFactory.next();
    }

    private _onmessage({ data }: WebSocket.MessageEvent) {
        this.decompressor /*&& typeof data !== "string"*/ // don't decompress non-binary data?
            ? this.decompressor?.decompress(data)
            : this._handlePayload(typeof data === "string" ? data : normalize(data));
    }

    private _onerror({ error }: WebSocket.ErrorEvent) {
        if (!error) {
            return;
        }

        this.log("error", "[ws] websocket encountered error", error);
    }

    private async _onclose({ code, reason, wasClean }: WebSocket.CloseEvent) {
        if ([ ShardState.Disconnecting, ShardState.Disconnected ].includes(this.state)) {
            /* we meant to disconnect, nothing to do here. */
            return;
        }

        this.log("warn", `[ws/CLOSE] ${wasClean ? "" : "non-"}clean close... code:`, code, "reason:", reason ?? "no reason provided");

        /* reset the heart-beater. */
        this.heartBeater.reset();

        /* update our state. */
        this._setState(ShardState.Disconnected);

        /* handle the close code correctly */
        let invalidateSession = false;
        switch (code) {
            case GatewayCloseCodes.UnknownError:
                this.log("warn", "[lifecycle] gateway encountered an unknown error, reconnecting...");
                await this.reconnect();
                break;
            case GatewayCloseCodes.UnknownOpcode:
            case GatewayCloseCodes.DecodeError:
            case GatewayCloseCodes.AuthenticationFailed:
            case GatewayCloseCodes.AlreadyAuthenticated:
            case GatewayCloseCodes.RateLimited:
                this.log("warn", closeReasons[code]);
                break;
            case GatewayCloseCodes.InvalidSeq:
                this.log("error", "[lifecycle] invalid sequence");
                await this.cluster.gateway.setSessionSeq(this.id, -1);
                break;
            case GatewayCloseCodes.NotAuthenticated:
            case GatewayCloseCodes.SessionTimedOut:
            case GatewayCloseCodes.InvalidShard:
            case GatewayCloseCodes.ShardingRequired:
            case GatewayCloseCodes.InvalidAPIVersion:
            case GatewayCloseCodes.InvalidIntents:
            case GatewayCloseCodes.DisallowedIntents:
                this.log("warn", closeReasons[code]);
                invalidateSession = true;
                break;
            case 1006:
                this.log("warn", "[ws] connection was reset.");
                break;
        }

        // TODO think of messages for these.
        this.log("debug", UNRECOVERABLE_CLOSE_CODES.includes(code)
            ? "[lifecycle] "
            : "[lifecycle] ");

        await this.disconnect({ reconnect: !UNRECOVERABLE_CLOSE_CODES.includes(code), fatal: invalidateSession });
    }

    private async _handlePayload(packet: string | Buffer) {
        let payload: GatewayReceivePayload;
        try {
            payload = this.encoder.decode(packet);
        } catch (e) {
            this.log("error", "[lifecycle] error occurred while parsing payload", e);
            return;
        }

        metrics.packetsReceived
            .labels({ shard: this.id, t: "t" in payload ? payload.t : "", op: OpCodes[payload.op] })
            .inc();

        await this._handleReceivePayload(payload);
    }

    private async _handleReceivePayload(payload: GatewayReceivePayload) {
        if (payload.s !== null) {
            /* update the stored sequence. */
            await this.cluster.gateway.setSessionSeq(this.id, payload.s)
        }

        switch (payload.op) {
            case GatewayOpcodes.Hello:
                this.log("debug", "[lifecycle] received HELLO");
                this.heartBeater.start(payload.d.heartbeat_interval);
                this._setState(ShardState.Identifying);
                await this._handleIdentify();
                break;
            case GatewayOpcodes.Heartbeat:
                await this.heartBeater.heartbeat("request");
                break;
            case GatewayOpcodes.HeartbeatAck:
                this.heartBeater.ack();
                break;
            case GatewayOpcodes.Dispatch:
                await this._handleDispatch(payload);
                break;
            case GatewayOpcodes.InvalidSession:
                this.log("warn", "[identify] session has been invalidated, resumable:", payload.d);
                if (payload.d) {
                    this._setState(ShardState.Resuming);
                    await this.session.resume();
                    break;
                }

                this._setState(ShardState.Identifying);
                await this.cluster.gateway.invalidateSession(this.id);
                await this.queueIdentify();
                break;
            case GatewayOpcodes.Reconnect:
                this.log("debug", "[lifecycle] gateway asked us to reconnect.");
                await this.disconnect({ reconnect: true });
                break;
        }
    }

    private async _handleIdentify() {
        this.log("debug", "[identify] attempting to retrieve an old session.");

        const { id, sequence } = await this.cluster.gateway.getSession(this.id);

        /* if we found a session id & sequence then resume the session. */
        if (id && sequence !== -1) {
            this.log("debug", "[identify] found old session, resuming.");
            return this.session.resume(id, sequence);
        }

        this.log("debug", "[identify/redis] couldn't find old session, identifying.");
        await this.queueIdentify();
    }

    private async _handleDispatch(payload: GatewayDispatchPayload) {
        switch (payload.t) {
            case GatewayDispatchEvents.Ready:
                this._setState(ShardState.Ready);
                this.cluster.whoami ??= payload.d.user;

                /* send a ready heartbeat. */
                await this.heartBeater.heartbeat("ready", true);

                /* update the stored session */
                await this.cluster.gateway.setSessionId(this.id, payload.d.session_id)

                const user = this.cluster.whoami;
                if (user) {
                    this.log("debug", `[identify] identified as ${user.username}#${user.discriminator},`, "session id:", payload.d.session_id);
                } else {
                    this.log("debug", "[identify] identified as an unknown bot?", "session id:", payload.d.session_id);
                }
                break;
            case GatewayDispatchEvents.Resumed:
                this.log("debug", "[identify] session has been resumed.");
                this._setState(ShardState.Ready);

                /* send a ready heartbeat */
                await this.heartBeater.heartbeat("resumed", true);
                break;
        }

        this.cluster.mojuru.publishEvent(this.id, payload);
    }

    private _setupDecompressor(decompressor: CompressionLibrary) {
        if (this.decompressor) {
            this.decompressor?.close();
            this.decompressor?.removeAllListeners();
            delete this.decompressor;
        }

        this.decompressor = new decompressors[decompressor]()
            .on("decompressed", this._handlePayload.bind(this))
            .on("error", e => this.log("error", "[compress] ran into an error", e))
            .on("debug", msg => this.log("debug", msg));

        this.decompressor.init();
    }

    private _setState(state: ShardState) {
        this.emit("state", state, this.state);
        this.state = state;
    }

    private async _close(reason: string, { code = 4_420, terminate = false }: CloseOptions = {}): Promise<boolean> {
        try {
            this.connected && !terminate
                ? this.ws?.close(code, `[mojuru] ${reason}`)
                : this.ws?.terminate();

            return true;
        } catch (e) {
            this.log("error", "[ws] unable to terminate ws connection.", e);
            return false;
        } finally {
            await this.rateLimiter.lock();
            delete this.ws;
        }
    }

    /* internal basically. */
    log(level: LogLevel, msg: string, ...args: any[]) {
        const log = `${this._logPrefix} ${msg}`;
        _logger[level](log, ...args);
    }
}

type LogLevel = "info" | "warn" | "error" | "debug" | "trace" | "fatal";

interface CloseOptions {
    terminate?: boolean;
    code?: number;
}

interface ShardEvents {
    state: (newState: ShardState, oldState: ShardState) => void;
}

interface DisconnectOptions {
    code?: number;
    reconnect?: boolean;
    fatal?: boolean;
}

export interface ShardSettings extends RequiredShardSettings {
    decompressor?: CompressionLibrary;
}

export interface RequiredShardSettings {
    max_reconnects: number;
    encoding: Encoding;
    version: number;
    intents: Intents[] | number;
    token: string;
    url: string;
    shard: DiscordShard;
    ready_timeout: number;
}
