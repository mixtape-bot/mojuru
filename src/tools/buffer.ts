export function normalize(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
    return data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Array.isArray(data) ? Buffer.concat(data) : data;
}
