import { Zlib } from "./zlib";
import { ZlibSync } from "./zlibSync";

export const decompressors = {
    "zlib": Zlib,
    "zlib-sync": ZlibSync
}

export * from "./decompressor";
export * from "./zlibSync";
export * from "./zlib";

export type Decompressors = "zlib" | "zlib-sync"
