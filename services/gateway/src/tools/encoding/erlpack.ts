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

import type { GatewayReceivePayload, GatewaySendPayload } from "discord-api-types/v9";
import { getLogger } from "log4js";
import type { EncodedData } from "../types";
import type { Encoder } from "./encoder";

interface Packer {
    pack(data: any): Buffer;

    unpack(data: Buffer): any;
}

const _logger = getLogger("erlpack");

let erlpack: Packer;
try {
    erlpack = require("@yukikaze-bot/erlpack");
} catch {

}

export class Erlpack<E = GatewaySendPayload, R = GatewayReceivePayload> implements Encoder<E, R> {
    readonly encoding = "etf";

    decode(data: EncodedData): R {
        if (data instanceof Buffer) {
            return erlpack.unpack(data);
        } else if (data instanceof ArrayBuffer) {
            _logger.debug("received array buffer message.");
            return erlpack.unpack(Buffer.from(data));
        } else if (Array.isArray(data)) {
            _logger.debug("received fragmented buffer message.");
            return erlpack.unpack(Buffer.concat(data));
        }

        throw new TypeError("[erlpack] received invalid data");
    }

    encode(payload: E): EncodedData {
        return erlpack.pack(payload);
    }
}
