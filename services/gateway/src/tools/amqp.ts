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

import { decode, encode } from "@msgpack/msgpack";
import { Channel, connect, Connection, ConsumeMessage, Options } from "amqplib";

export interface ResponseOptions {
    ack: () => void;
    nack: (allUpTo?: boolean, requeue?: boolean) => void;
    reject: (requeue?: boolean) => void;
    reply: (data: any) => void;
}

export async function createAmqp(host: string): Promise<{ connection: Connection, channel: Channel }> {
    const connection = await connect(`amqp://${host}`);
    return {
        connection,
        channel: await connection.createChannel(),
    };
}

export function publishMessage(channel: Channel, exchange: string, routingKey: string, data: any, options?: Options.Publish) {
    channel.publish(exchange, routingKey, encodeMsgpack(data), options);
}

export function encodeMsgpack(data: any): Buffer {
    const encoded = encode(data);
    return Buffer.from(encoded, encoded.byteOffset, encoded.byteLength);
}

export async function createCallback(channel: Channel, callback: (data: any) => void): Promise<string> {
    const { queue } = await channel.assertQueue("", { exclusive: true });
    await channel.consume(queue, createConsumer(channel, callback), { noAck: true });
    return queue;
}

export function createConsumer(channel: Channel, fn: (data: any, response: ResponseOptions) => void): Consumer {
    return msg => {
        if (!msg) {
            return;
        }

        const responseOptions: ResponseOptions = {
            ack: () => channel.ack(msg),
            nack: (allUpTo, requeue) => channel.nack(msg, allUpTo, requeue),
            reject: requeue => channel.reject(msg, requeue),
            reply: data => channel.sendToQueue(msg.properties.replyTo, encodeMsgpack(data), { correlationId: msg.properties.correlationId }),
        };

        fn(decode(msg.content), responseOptions);
    };
}

type Consumer = (msg: ConsumeMessage | null) => void
