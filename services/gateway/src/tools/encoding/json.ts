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

import type { Encoder } from "./encoder";
import type { GatewayReceivePayload, GatewaySendPayload } from "discord-api-types/v9";
import { getLogger } from "log4js";
import type { EncodedData } from "../types";

const _logger = getLogger("json");

interface JsonParser {
    parse(json: string): any;
}

export let json: JsonParser;
try {
    json = require("simdjson");
} catch {
    json = JSON;
}

export class Json<E = GatewaySendPayload, R = GatewayReceivePayload> implements Encoder<E, R> {
    readonly encoding = "json";

    decode(data: EncodedData): R {
        if (data instanceof Buffer) {
            return json.parse(data.toString());
        } else if (data instanceof ArrayBuffer) {
            data = Buffer.from(data);
            return json.parse(data.toString());
        } else if (Array.isArray(data)) {
            _logger.debug("received fragmented buffer message.");
            data = Buffer.concat(data);
            return json.parse(data.toString());
        }

        return json.parse(data);
    }

    encode(payload: E): EncodedData {
        return JSON.stringify(payload);
    }
}
