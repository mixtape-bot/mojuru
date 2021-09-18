import WebSocket from "ws";
import type { GatewayDispatchPayload, GatewayReceivePayload, GatewaySendPayload } from "discord-api-types";
import { GatewayOpcodes, GatewayDispatchEvents, GatewayIntentBits } from "discord-api-types/v9";
import { createLogger } from "../tools/createLogger";
import { normalize } from "../tools/buffer";
import { _heartbeater_acked, _shard_close_sequence, _shard_log, _shard_sequence } from "./keys";
import type { Cluster } from "./cluster";
import { decompressors } from "./decompressor";
import type { Decompressor, Decompressors } from "./decompressor";
import { RateLimiter } from "./rateLimiter";
import { Heartbeater } from "./heartbeater";
import { Session } from "./session";
import { TypedEmitter } from "tiny-typed-emitter";
import { sleep } from "../tools/sleep";

const _logger = createLogger()

const _ws:           unique symbol = Symbol.for("Shard#ws")
const _state:        unique symbol = Symbol.for("Shard#state")
const _queue:        unique symbol = Symbol.for("Shard#queue")

const _decompressor: unique symbol = Symbol.for("Shard#decompressor")
const _rateLimiter:  unique symbol = Symbol.for("Shard#rateLimiter")
const _heartBeater:  unique symbol = Symbol.for("Shard#heartBeater")
const _session:      unique symbol = Symbol.for("Shard#session")

enum ShardState { Ready, Disconnected, Idle, WaitingToIdentify }

export class Shard extends TypedEmitter<{ state: (newState: ShardState, oldState: ShardState) => void }> {
    [_ws]!: WebSocket;

    [_decompressor]?: Decompressor;
    [_rateLimiter]: RateLimiter;
    [_heartBeater]: Heartbeater;
    [_session]: Session;

    [_state]: ShardState;
    [_queue]: GatewaySendPayload[];
    [_shard_sequence]: number;
    [_shard_close_sequence]: number = -1;

    constructor(readonly cluster: Cluster, readonly settings: ShardSettings) {
        super()

        if (settings.decompressor) {
            this._setupDecompressor(settings.decompressor);
        }

        this[_rateLimiter] = new RateLimiter(this._logPrefix);
        this[_heartBeater] = new Heartbeater(this);
        this[_session] = new Session(this);

        this[_state] = ShardState.Idle;
        this[_queue] = [];
        this[_shard_sequence] = -1;
        this[_shard_close_sequence] = -1;
    }

    private get _url(): string {
        let url = this.settings.url.endsWith("/") ? this.settings.url : `${this.settings.url}/`;
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
        return this[_heartBeater].latency;
    }

    get connected(): boolean {
        return this[_ws]?.readyState === WebSocket.OPEN;
    }

    connect() {
        this[_ws] = new WebSocket(this._url);
        this[_ws].onopen = this._onopen.bind(this);
        this[_ws].onmessage = this._onmessage.bind(this);
    }

    async send(payload: GatewaySendPayload) {
        await this[_rateLimiter].consume();
        await this.sendNow(payload);
    }

    async sendNow(payload: GatewaySendPayload) {
        if (!this.connected) {
            this[_queue].push(payload);
            return;
        }

        const json = JSON.stringify(payload);
        this[_shard_log]("trace", "sending op", payload.op, json);
        this[_ws].send(json);
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
            rej("timed out");
        });
    }

    async queueIdentify() {
        const rateLimiter = await this.cluster.queue.getRateLimiter(this.settings.id[0]);
        rateLimiter?.consume(async () => {
            this[_session].identify()
            await this.awaitState(ShardState.Ready, 5000);
        });
    }

    private _onopen() {
        this[_queue].forEach(this.send.bind(this));
        this[_shard_log]("info", "connected to discord gateway.");
    }

    private _onmessage({ data }: WebSocket.MessageEvent) {
        this[_decompressor]
            ? this[_decompressor]?.add(data)
            : this._onpacket(typeof data === "string" ? data : normalize(data));
    }

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
                this[_heartBeater].start(payload.d.heartbeat_interval);
                await this.queueIdentify();
                break;
            case GatewayOpcodes.Heartbeat:
                this[_heartBeater].heartbeat("request");
                break;
            case GatewayOpcodes.HeartbeatAck:
                this[_heartBeater].ack();
                break;
            case GatewayOpcodes.Dispatch:
                this._ondispatch(payload);
                break
        }
    }

    private _ondispatch(payload: GatewayDispatchPayload) {
        switch (payload.t) {
            case GatewayDispatchEvents.Ready:
                this[_session].ready(payload.d.session_id, payload.d.user);
                this.state = ShardState.Ready;
                this[_heartBeater][_heartbeater_acked] = true;
                this[_heartBeater].heartbeat("ready");
                break
            case GatewayDispatchEvents.Resumed:
                this.state = ShardState.Ready;
                this[_heartBeater][_heartbeater_acked] = true;
                this[_heartBeater].heartbeat("resumed");
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
    [_shard_log](level: "info" | "warn" | "error" | "debug" | "trace", msg: string, ...args: any[]) {
        const log = `${this._logPrefix} ${msg}`;
        _logger[level](log, ...args)
    }
}

type ShardID = [ id: number, total: number ];

interface ShardSettings {
    readonly id: ShardID
    readonly url: string;
    readonly token: string;
    readonly decompressor?: Decompressors;
    readonly version: number;
    readonly intents: GatewayIntentBits[] | number;
}
