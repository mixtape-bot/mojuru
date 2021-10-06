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

export interface TimeoutScope {
}

const TIMEOUTS = new WeakMap<TimeoutScope, NodeJS.Timeout[]>();
const INTERVALS = new WeakMap<TimeoutScope, NodeJS.Timeout[]>();

export function clearScope(scope: TimeoutScope): boolean {
    const timeouts = TIMEOUTS.delete(scope)
        , intervals = INTERVALS.delete(scope);

    return timeouts || intervals;
}

export function createTimeout(scope: TimeoutScope, delay: number, callback: () => void) {
    const timeouts = TIMEOUTS.get(scope) ?? []
        , id = setTimeout(callback, delay);

    timeouts.push(id);
    TIMEOUTS.set(scope, timeouts);

    return id;
}

export function clearTimeout(scope: TimeoutScope, id: NodeJS.Timeout) {
    const timeouts = TIMEOUTS.get(scope);
    if (!timeouts) {
        return;
    }

    timeouts.splice(timeouts.indexOf(id), 1);
    if (!timeouts.length) {
        TIMEOUTS.delete(scope);
    } else {
        TIMEOUTS.set(scope, timeouts);
    }
}

export function createInterval(scope: TimeoutScope, delay: number, callback: () => void) {
    const intervals = INTERVALS.get(scope) ?? []
        , id = setInterval(callback, delay);

    intervals.push(id);
    INTERVALS.set(scope, intervals);

    return id;
}

export function clearInterval(scope: TimeoutScope, id?: NodeJS.Timeout): boolean {
    if (!id) {
        return INTERVALS.delete(scope);
    }

    const intervals = INTERVALS.get(scope);
    if (!intervals) {
        return false;
    }

    intervals.splice(intervals.indexOf(id), 1);
    if (!intervals.length) {
        INTERVALS.delete(scope);
    } else {
        INTERVALS.set(scope, intervals);
    }

    return true;
}
