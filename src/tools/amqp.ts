import "reflect-metadata";
import { Amqp, AmqpOptions, AmqpResponseOptions } from "@spectacles/brokers";
import { encode, decode } from "@msgpack/msgpack";

export enum GroupMetadataKey {
    GROUP_NAME = "groupName",
    SUBSCRIPTIONS = "subscriptions"
}

export function group(name: string, subGroup?: string): ClassDecorator {
    return (target) => Reflect.defineMetadata(GroupMetadataKey.GROUP_NAME, [ name, subGroup ], target);
}

export function subscription(event: string): MethodDecorator {
    return (target, propertyKey, descriptor) => {
        if (typeof descriptor.value !== "function") {
            throw new TypeError("The subscription decorator can only be called on methods.");
        }

        const subscriptions: Subscription[] = Reflect.getMetadata(GroupMetadataKey.SUBSCRIPTIONS, target.constructor) ?? [];
        subscriptions.push({ propertyKey, event, });

        Reflect.defineMetadata(GroupMetadataKey.SUBSCRIPTIONS, subscriptions, target.constructor);
    };
}

export interface Subscription {
    propertyKey: PropertyKey;
    event: string;
}

export class Group {
    /**
     * The amqp broker for this group.
     */
    broker: Amqp<NodeJS.Dict<any>, NodeJS.Dict<any>>;

    constructor() {
        const [ group, subGroup ] = Reflect.getMetadata(GroupMetadataKey.GROUP_NAME, this.constructor) as string[]
        this.broker = createAmqpBroker(group, subGroup);
        this._setup()
    }

    private async _setup() {
        const subscriptions = Reflect.getMetadata(GroupMetadataKey.SUBSCRIPTIONS, this.constructor) as Subscription[];
        await this.broker.connect("localhost");
        this.broker.subscribe([ ...subscriptions.reduce((a, { event }) => a.add(event), new Set<string>()) ]);

        for (const subscription of subscriptions) {
            this.broker.on(subscription.event, (data: NodeJS.Dict<any>, options: AmqpResponseOptions) => {
                const fun = Reflect.get(this, subscription.propertyKey) as Function;
                Reflect.apply(fun, this, [ data, options ]);
            });
        }
    }
}

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
