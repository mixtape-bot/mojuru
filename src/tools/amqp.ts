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

import "reflect-metadata";
import { Amqp, AmqpOptions } from "@spectacles/brokers";
import { encode, decode } from "@msgpack/msgpack";

export function createAmqpBroker(group: string, subgroup?: string, options: AmqpOptions = {}): Amqp {
    return new Amqp<any, any>(group, subgroup, {
        ...options,
        serialize: send => {
            const encoded = encode(send);
            return Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
        },
        deserialize: decode
    })
}
