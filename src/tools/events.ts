export interface ShardIdentifiedMessage {
    shard_id: number;
    payload: Buffer;
}
