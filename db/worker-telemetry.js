'use strict';

/**
 * What a worker's own reading looks like when MARP keeps it.
 *
 * Shared because two paths write the same sample: the poll, where the reading arrives in
 * `capabilities.resources`, and the heartbeat, where worker 0.1.10 sends the same objects
 * beside its GPU telemetry. One function so the column cannot end up holding two shapes
 * depending on which path a machine happened to take.
 *
 * @module db/worker-telemetry
 */

/** The blocks a sample keeps, under the worker's own names. */
const SYSTEM_BLOCKS = ['cpu', 'memory', 'disk'];

/**
 * The machine's own reading, as a sample stores it.
 *
 * **Null rather than an empty object when a worker sends none.** A machine on an older
 * build reports nothing here, and `{}` would read as *measured, and empty* to anything
 * checking the column — where null reads as *not measured*, which is what happened. The
 * dashboard draws a gap for one and a zero for the other, and a CPU chart that dips to
 * the floor because nobody looked is the failure this platform keeps paying to avoid.
 *
 * @param {?Object} source - `capabilities.resources`, or a heartbeat's telemetry.
 * @returns {?Object} `{cpu, memory, disk}` with whichever arrived, or null.
 */
function systemReading(source) {
    if (!source || typeof source !== 'object') return null;

    const kept = {};

    for (const name of SYSTEM_BLOCKS) {
        if (source[name] && typeof source[name] === 'object') kept[name] = source[name];
    }

    return Object.keys(kept).length ? kept : null;
}

module.exports = { systemReading, SYSTEM_BLOCKS };
