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

export const _shard_sequence:       unique symbol = Symbol.for("Shard#sequence");
export const _shard_close_sequence: unique symbol = Symbol.for("Shard#closeSequence");
export const _shard_log:            unique symbol = Symbol.for("Shard#log()");
export const _heartbeater_acked:    unique symbol = Symbol.for("Heartbeater#acked")
export const _session_id:           unique symbol = Symbol.for("Session#id")
