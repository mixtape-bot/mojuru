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
