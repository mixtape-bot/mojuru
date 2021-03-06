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

import { FastZlib } from "./fastZlib";
import { ZlibSync } from "./zlibSync";
import { Zlib } from "./zlib";

export const decompressors = {
    "fast-zlib": FastZlib,
    "zlib-sync": ZlibSync,
    "zlib": Zlib
}

export * from "./decompressor";
export * from "./zlibSync";
export * from "./fastZlib";
