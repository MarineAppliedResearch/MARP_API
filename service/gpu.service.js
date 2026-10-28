/**
 * Service layer for GPU orchestration.
 *
 * Validates what a caller sent, shapes what goes back, and holds the two pieces
 * of behaviour that are not database access: the long poll's waiting, and
 * expanding one submission over a long video into a batch of jobs.
 *
 * The atomic state decisions are deliberately *not* here -- they are in
 * `repository/gpu.repository.js`, because each has to be made against rows locked
 * in the same transaction that then writes them. See that file's header.
 *
 * Everything a worker sends is treated as a claim rather than a fact. The
 * validation below is what makes that concrete: a worker cannot name a state that
 * only the coordinator may write, cannot send an unbounded batch, and cannot
 * report a result for an artifact it has not actually handed over.
 *
 * @fileoverview GPU orchestration request validation, shaping, and the long poll.
 * @author Isaac Travers
 * @module service/gpu
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const gpuRepository = require('../repository/gpu.repository');
const ingestRepository = require('../repository/observation-ingest.repository');
const jellyfinRepository = require('../repository/jellyfin.repository');
const gpuPlaybackService = require('./gpu-playback.service');
const observationIngestService = require('./observation-ingest.service');
const trainingMetricsService = require('./training-metrics.service');
const inferenceSessionService = require('./inference-session.service');
const logger = require('../logger/api.logger');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const {
    DATASET_DIRECTORY,
    HEARTBEAT_SECONDS,
    MEDIA_CLIENT_IDENTITY,
    LEASE_SECONDS,
    POLL_MAX_WAIT_SECONDS,
    POLL_RETRY_INTERVAL_MS,
    MAX_WORKER_NAME_LENGTH,
    MAX_JOB_NAME_LENGTH,
    MAX_WORKER_LOCAL_ID_LENGTH,
    MAX_PROGRESS_PHASE_LENGTH,
    MAX_EVENTS_PER_BATCH,
    ARTIFACT_PATH_PREFIX,
    ARTIFACT_DIRECTORY,
    JOB_KINDS,
    INGESTIBLE_JOB_KINDS,
    ENGINE_DATA_TYPES,
    JOB_STATES,
    REPORTABLE_ATTEMPT_STATES,
    WORKER_EVENT_KINDS,
    SETTING_VALUE_TYPES,
    SETTING_SOURCES,
    RESULT_OUTCOMES,
} = require('../config/gpu-orchestration');

/**
 * The frame rate MARP fixes video time at, from the one module that owns it.
 *
 * Imported rather than written again: `db/timecode.js` is what every timecode
 * column in the database was derived with, and a second copy here that drifted
 * would put a job's frame count at odds with the timecodes its own observations
 * are recorded at.
 */
const { ASSUMED_FPS } = require('../db/timecode');
const { systemReading } = require('../db/worker-telemetry');

/**
 * Which job states can be cleared wholesale.
 *
 * **One entry, and that is a decision rather than a stub.** `failed` is what was
 * asked for: a list cluttered with work that did not finish. `cancelled` is a bigger
 * pile nobody has asked about, and the two are not interchangeable --
 * `observations.gpu_job_id` is SET NULL, so clearing a state takes the provenance of
 * everything those jobs produced. Shared by the delete and by the count in front of
 * it, so a state cannot be countable and undeletable.
 *
 * @type {string[]}
 */
const DELETABLE_STATES = ['failed'];

/**
 * Jellyfin reports durations in 100-nanosecond ticks.
 *
 * @constant
 * @type {number}
 */
const TICKS_PER_SECOND = 10_000_000;

/**
 * Reject a request with the API's validation contract.
 *
 * @param {string} message - What is wrong, in terms the caller can act on.
 * @returns {void}
 * @throws {ApiError} Always. 400/VALIDATION_ERROR.
 */
function invalid(message) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message);
}

/**
 * Read a required non-empty string.
 *
 * @param {*} value - Value as supplied.
 * @param {string} field - Field name, for the message.
 * @returns {string} The trimmed value.
 * @throws {ApiError} When it is missing or not a string.
 */
function requiredString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        invalid(`${field} is required and must be a non-empty string.`);
    }

    return value.trim();
}

/**
 * Read a worker's name.
 *
 * Length-checked here rather than left to the column, because a name one
 * character too long would otherwise reach Postgres and come back as a 500 for
 * what is plainly a bad request.
 *
 * @param {*} value - Value as supplied.
 * @param {string} field - Field name, for the message.
 * @returns {string} The trimmed name.
 * @throws {ApiError} When it is missing, not a string, or too long.
 */
function requiredWorkerName(value, field) {
    const name = requiredString(value, field);

    if (name.length > MAX_WORKER_NAME_LENGTH) {
        invalid(`${field} must be ${MAX_WORKER_NAME_LENGTH} characters or fewer.`);
    }

    return name;
}

/**
 * Read a required integer.
 *
 * @param {*} value - Value as supplied.
 * @param {string} field - Field name, for the message.
 * @returns {number} The value as a number.
 * @throws {ApiError} When it is missing or not an integer.
 */
function requiredInteger(value, field) {
    if (!Number.isInteger(value)) {
        invalid(`${field} is required and must be an integer.`);
    }

    return value;
}

/**
 * Read an optional integer, defaulting when absent.
 *
 * @param {*} value - Value as supplied.
 * @param {string} field - Field name, for the message.
 * @param {number} fallback - What to use when absent.
 * @returns {number} The value, or the fallback.
 * @throws {ApiError} When present but not an integer.
 */
function optionalInteger(value, field, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }

    return requiredInteger(value, field);
}

/**
 * The fields the pool view carries out of one worker's device array.
 *
 * Shared by the heartbeat's reading and the poll's snapshot, because they are the same
 * array from the same NVML call and differ only in when it was taken. **Field names are
 * the worker's own**: a tidier `utilization` here would make this the one place in MARP
 * that calls it that, which `DESIGN.md` item 16 is entirely about.
 *
 * @param {Array<Object>} devices - The worker's per-GPU array.
 * @returns {Array<Object>} One entry per GPU, reduced to what a pool view draws.
 */
function reduceDevices(devices) {
    return devices.map((device) => ({
        device_index: device.device_index,
        name: device.name,
        gpu_utilization_percent: device.gpu_utilization_percent,
        memory_utilization_percent: device.memory_utilization_percent,
        memory_used_bytes: device.memory_used_bytes,
        memory_total_bytes: device.memory_total_bytes,
        memory_percent_used: device.memory_percent_used,
        temperature_c: device.temperature_c,
        power_usage_watts: device.power_usage_watts,
        power_limit_watts: device.power_limit_watts,
    }));
}

/**
 * Read the GPU reading a heartbeat may carry.
 *
 * **Lenient on the device fields, strict on the shape.** The fields are NVML's and a driver
 * that stops reporting one — fan speed on a passive card, power on a laptop GPU — must not
 * turn a heartbeat into a 400 and cost a running job its lease. So the devices travel as
 * they arrive and only the envelope is checked.
 *
 * Absent is normal: a machine with no GPU omits the field rather than sending null, so an
 * older worker that never heard of this is indistinguishable from a current one with
 * nothing to report, and both are fine.
 *
 * @param {*} telemetry - `body.telemetry`, as supplied.
 * @returns {?Object} `{devices}`, or null when there is nothing to record.
 * @throws {ApiError} 400 when present but not shaped like a reading.
 */
function validateTelemetry(telemetry) {
    if (telemetry === undefined || telemetry === null) {
        return null;
    }

    if (typeof telemetry !== 'object' || Array.isArray(telemetry)) {
        invalid('telemetry must be an object carrying a devices array.');
    }

    if (!Array.isArray(telemetry.devices)) {
        invalid('telemetry.devices must be an array.');
    }

    for (const [index, device] of telemetry.devices.entries()) {
        if (typeof device !== 'object' || device === null || Array.isArray(device)) {
            invalid(`telemetry.devices[${index}] must be an object.`);
        }
    }

    // An empty array is "I have no GPU", which is the same as not reporting.
    return telemetry.devices.length ? { devices: telemetry.devices } : null;
}

/**
 * The GPU telemetry out of an attempt's `capabilities_snapshot` (#104, gap 27).
 *
 * The worker reads NVML on every poll and the coordinator stores the whole
 * reading on the attempt it opens, so this information has always been in the
 * database -- `GET /gpu/jobs/:id` returns it. What the pool view could not do is
 * reach it, which is the entire gap.
 *
 * **Reduced rather than passed through.** The snapshot carries the machine's CPU,
 * disk, network, torch build, engine list and reduction registry alongside the
 * GPUs. Gap 12 already records `GET /gpu/workers` as megabytes a refresh at the
 * scale #104 assumes, and handing back a second whole blob per live attempt
 * makes the worse problem worse.
 *
 * **Field names are the worker's own**, not tidier ones invented here. Renaming
 * `gpu_utilization_percent` to `utilization` on the way through would make this
 * route the only place in MARP where the reading is called that, and item 16 of
 * `DESIGN.md` is about exactly that kind of silent mapping.
 *
 * @param {?Object} snapshot - The attempt's `capabilities_snapshot`, as stored.
 * @param {?Date} asOf - When the snapshot was taken, i.e. when the lease opened.
 * @returns {?Object} `{gpus, as_of}`, or null when the machine reported no GPU.
 */
function gpuTelemetryFrom(snapshot, asOf) {
    const devices = snapshot
        && snapshot.resources
        && snapshot.resources.nvidia
        && snapshot.resources.nvidia.devices;

    if (!Array.isArray(devices) || devices.length === 0) {
        return null;
    }

    return {
        gpus: reduceDevices(devices),

        // Not live. See `live` on the heartbeat's reading.
        live: false,

        // Carried deliberately. This is what the machine looked like when the
        // lease opened, not what it looks like now -- the heartbeat reports the
        // attempt's progress and nothing about the hardware -- so a screen that
        // drew it as a live reading would be overstating what is known.
        as_of: asOf,
    };
}

/**
 * Read an optional instant from a query string.
 *
 * An **absolute instant**, deliberately -- an ISO timestamp the caller worked
 * out, not a day name MARP interprets. "Completed today" is a question only the
 * caller can answer, because only the caller knows what timezone it is being
 * asked in, and a server that decided would be wrong silently for everyone
 * somewhere else (#104, gap 24).
 *
 * @param {*} value - Value as supplied.
 * @param {string} field - Field name, for the message.
 * @returns {?Date} The instant, or undefined when absent.
 * @throws {ApiError} When present but not a parseable timestamp.
 */
function optionalInstant(value, field) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        invalid(`${field} must be an ISO 8601 timestamp.`);
    }

    return parsed;
}

/**
 * Read a value that has to come from a fixed vocabulary.
 *
 * @param {*} value - Value as supplied.
 * @param {string} field - Field name, for the message.
 * @param {Array<string>} allowed - The vocabulary.
 * @returns {string} The value.
 * @throws {ApiError} When it is not one of them.
 */
function requiredEnum(value, field, allowed) {
    if (!allowed.includes(value)) {
        invalid(`${field} must be one of: ${allowed.join(', ')}.`);
    }

    return value;
}

/**
 * Whether a value is what its declared type says it is.
 *
 * `real` accepts an integral number: JSON cannot tell 1.0 from 1, so a real
 * setting that happens to be whole arrives looking like an integer.
 *
 * @param {*} value - Value as supplied.
 * @param {string} type - One of SETTING_VALUE_TYPES.
 * @returns {boolean} True when the value fits the type.
 */
function valueFitsType(value, type) {
    switch (type) {
        case 'real': return typeof value === 'number' && Number.isFinite(value);
        case 'int': return Number.isInteger(value);
        case 'bool': return typeof value === 'boolean';
        case 'text': return typeof value === 'string';
        default: return false;
    }
}

/**
 * Read a worker's report of the inference settings it applied (#232).
 *
 * `{engine, settings: {name: {value, type, source}}, ignored: {key: value}}`.
 * Checked whole before anything is written, so a malformed report is refused
 * rather than half-recorded. A null value is refused too: a default is recorded
 * as the value that was used, never as its absence.
 *
 * @param {*} payload - The event's payload as supplied.
 * @param {string} field - Field name, for the message.
 * @returns {{engine: string, settings: Array<Object>, ignored: Array<Object>}} The report.
 * @throws {ApiError} When any part of it is malformed.
 */
function settingsReport(payload, field) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        invalid(`${field} must be an object for a settings event.`);
    }

    const engine = requiredString(payload.engine, `${field}.engine`);

    if (engine.length > 64) {
        invalid(`${field}.engine must be 64 characters or fewer.`);
    }

    if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
        invalid(`${field}.settings must be an object of {name: {value, type, source}}.`);
    }

    const settings = Object.entries(payload.settings).map(([name, entry]) => {
        const where = `${field}.settings.${name}`;

        if (name.length === 0 || name.length > 64) {
            invalid(`${where}: a setting name must be 1 to 64 characters.`);
        }

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            invalid(`${where} must be an object of {value, type, source}.`);
        }

        const type = requiredEnum(entry.type, `${where}.type`, SETTING_VALUE_TYPES);
        const source = requiredEnum(entry.source, `${where}.source`, SETTING_SOURCES);

        if (entry.value === undefined || entry.value === null) {
            invalid(`${where}.value is required; a default is recorded as the value that was used.`);
        }

        if (!valueFitsType(entry.value, type)) {
            invalid(`${where}.value ${JSON.stringify(entry.value)} is not a ${type}.`);
        }

        return { name, type, source, value: entry.value };
    });

    const ignoredIn = payload.ignored === undefined || payload.ignored === null ? {} : payload.ignored;

    if (typeof ignoredIn !== 'object' || Array.isArray(ignoredIn)) {
        invalid(`${field}.ignored must be an object of {key: requested value}.`);
    }

    const ignored = Object.entries(ignoredIn).map(([key, requested]) => {
        if (key.length === 0 || key.length > 128) {
            invalid(`${field}.ignored: a key must be 1 to 128 characters.`);
        }

        // Kept as the JSON it was sent in: an ignored key's value can be any
        // shape, and the point is to show what the job asked for.
        return { key, requestedValue: requested === undefined ? null : JSON.stringify(requested) };
    });

    return { engine, settings, ignored };
}

/**
 * The filename part of a path, whichever separator it uses.
 *
 * A local copy of the same three lines in `repository/jellyfin.repository.js`
 * rather than a reach into that module's private helper: Jellyfin's own paths
 * use `/` and MARP's stored video sources are often old Windows paths, so both
 * separators have to be tolerated, and Node's `path` module only understands the
 * host's.
 *
 * @param {string} value - Path or bare filename.
 * @returns {string} The final segment, or '' when there is nothing to take.
 */
function fileNameFromPath(value) {
    if (!value) {
        return '';
    }

    const segments = String(value).replace(/\\/g, '/').split('/');

    return segments[segments.length - 1] || '';
}

/**
 * Wait, without blocking anything else the process is doing.
 *
 * @param {number} milliseconds - How long.
 * @returns {Promise<void>}
 */
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Coordinates GPU orchestration between the controller and repository layers.
 *
 * @class GpuService
 */
/**
 * How much of a dataset or model name a generated job name keeps.
 *
 * The Jobs table gives this column perhaps forty characters before it ellipsizes, and two
 * full names plus a time is more than that. Twenty-four keeps the distinctive part of
 * every name MARP currently holds -- the longest is `MBARI-Benthic-Supercategory-2025` at
 * thirty-two -- while leaving the result readable. The full names are in the spec either
 * way, so nothing is lost, only shortened.
 *
 * @constant
 * @type {number}
 */
const GENERATED_NAME_PART = 24;

/**
 * A name for a training job nobody named, from what it is actually training.
 *
 * **`Job 21782` is not a name**, and the submit form has been promising this all along --
 * its Run name field reads *"Optional. Blank is left to MARP."* So the UI said MARP names
 * it and MARP did not; `gpu_jobs.name` is null on every training job ever queued.
 *
 * **Dataset, model, and the time of day.** Isaac asked for the first two. The third is
 * there because he has run the same model over the same dataset three times in a day, and
 * a name that is identical across those stops being useful at exactly the moment there is
 * most to tell apart. The job id would disambiguate too, and is excluded deliberately --
 * not showing an id is the point of the exercise.
 *
 * **It collides when the same dataset and model are submitted inside the same minute**,
 * which is a double submission rather than two runs worth distinguishing. Uniqueness is
 * not enforced: that would mean a round trip per submit to ask what exists, and
 * `gpu_jobs.name` has never been unique -- two people may legitimately type the same
 * thing. A name is a label here, not a key.
 *
 * **Nothing parses this**, which is why it can be prose. The dashboard reads
 * `job.name || source || "Job <id>"` and the search box matches it as text; no code
 * anywhere splits it, and the job id remains the identifier. If that ever changes, this
 * is the comment that should stop it.
 *
 * **The time is the coordinator's local time**, which is the clock the person reading the
 * dashboard is on. Deliberately not UTC: this is a label for a human, and the Created
 * column already carries the date.
 *
 * **It leads, because the column truncates at about thirty-two characters.** The Job
 * column is 188px at a 1600px viewport, so every name here is cut: with the time last it
 * was the part that disappeared, which is the one part that cannot be spared -- three runs
 * of one model over one dataset are told apart by exactly those five characters.
 *
 * Putting the dataset first instead was tried and is worse: a long dataset name eats the
 * budget on its own and the time vanishes again. Leading with it is the only order where
 * the disambiguator survives whatever the names are, and it spends the ellipsis on the
 * model, which is the part least likely to differ between the runs somebody is comparing.
 * The full name is a hover away -- the cell carries it as a title.
 *
 * @param {Object} spec - The job spec, after the dataset has been composed.
 * @param {Date} [when] - When it was submitted; now by default.
 * @returns {?string} The name, or null when there is not enough to make one.
 */
function composeTrainingJobName(spec, when = new Date()) {
    const shorten = (value) => {
        const text = String(value === undefined || value === null ? '' : value).trim();

        return text.length > GENERATED_NAME_PART ? `${text.slice(0, GENERATED_NAME_PART - 1)}…` : text;
    };

    const dataset = shorten(spec && spec.dataset && spec.dataset.name);
    const model = shorten(spec && spec.model && spec.model.name);

    /* **Null rather than a name with a hole in it.** A spec missing one of the two is
       already refused by the time this runs, so this is the belt rather than the braces --
       but "undefined · rockfish5" reaching the screen would be worse than `Job 21782`,
       which at least resolves to something. */
    if (!dataset || !model) return null;

    const clock = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;

    return `${clock} · ${dataset} · ${model}`;
}

class GpuService {

    /**
     * Reclaim expired leases and close their Jellyfin sessions.
     *
     * @returns {Promise<Array<Object>>} Reclaimed attempt entries.
     */
    async expireStaleLeases() {
        const expired = await gpuRepository.expireStaleLeases();

        await gpuPlaybackService.stopExpired(expired);

        return expired;
    }

    /**
     * Mark every machine that has stopped talking `offline` (#202).
     *
     * Deliberately **not** folded into `expireStaleLeases`, though the two are
     * swept from the same places: one is about a job and the other about a
     * machine, and they are not the same event. A worker can be gone while
     * holding no lease at all -- which is the case this issue was reported
     * from -- and a lease can expire on a machine that is alive and merely slow.
     *
     * @returns {Promise<Array<Object>>} Machines marked offline.
     */
    async sweepStaleWorkers() {
        // Retention rides along here rather than on the heartbeat or the job
        // list. One row per machine per minute is small, but it is unbounded,
        // and a table nobody ever deletes from is a slow leak somebody finds in
        // a year. The pool read is the right place: far less frequent than the
        // job list, and the delete is a range scan on an indexed column that
        // answers instantly when there is nothing old.
        await gpuRepository.dropExpiredWorkerSamples();

        return gpuRepository.markStaleWorkersOffline();
    }

    // -----------------------------------------------------------------
    // Worker-facing
    // -----------------------------------------------------------------

    /**
     * Enrol a machine into the pool.
     *
     * `local_id` is the identity and is required: it is the durable id the
     * machine generated for itself, and keying on it is what lets a machine be
     * renamed without its next enrolment forking the pool row. The name is
     * required too, but only as the initial label -- a machine already enrolled
     * keeps whatever it is currently called.
     *
     * @async
     * @param {Object} body - `{local_id, name, capabilities, slot_count, worker_version}`.
     * @returns {Promise<Object>} `{worker_id, heartbeat_seconds, ...}`.
     * @throws {ApiError} 400 when the durable id or the name is missing.
     */
    async enrolWorker(body) {
        const localId = requiredString(body.local_id, 'local_id');

        if (localId.length > MAX_WORKER_LOCAL_ID_LENGTH) {
            invalid(`local_id must be ${MAX_WORKER_LOCAL_ID_LENGTH} characters or fewer.`);
        }

        const name = requiredWorkerName(body.name, 'name');

        // Left undefined when absent rather than defaulted to 1. A worker
        // re-enrolling without saying how many slots it has means "unchanged",
        // and defaulting here would quietly cut a machine that enrolled with
        // eight slots down to one -- which then looks like the scheduler
        // refusing to give it work.
        const slotCount = body.slot_count === undefined || body.slot_count === null
            ? undefined
            : requiredInteger(body.slot_count, 'slot_count');

        if (slotCount !== undefined && slotCount < 1) {
            invalid('slot_count must be at least 1.');
        }

        const worker = await gpuRepository.enrolWorker({
            localId,
            name,
            capabilities: body.capabilities,
            slotCount,
            workerVersion: body.worker_version,
        });

        // The stored name, which for a machine already enrolled is whatever it is
        // currently called rather than the name this request sent. A worker that
        // was renamed learns its new name here, and `local_id` is deliberately not
        // echoed: the identity stays internal, and `worker_id` is the handle
        // everything else uses.
        return {
            worker_id: worker.id,
            name: worker.name,
            state: worker.state,
            slot_count: worker.slot_count,
            // The interval is the coordinator's to set, so a fleet can be told to
            // beat faster or slower without touching any machine.
            heartbeat_seconds: HEARTBEAT_SECONDS,
            lease_seconds: LEASE_SECONDS,
        };
    }

    /**
     * Poll for work, waiting up to `wait_seconds` for some to appear.
     *
     * The claim is inside the repository's transaction, so there is nothing to
     * claim separately and nothing between "found a job" and "leased it".
     *
     * The stale-lease sweep runs first, on every poll. That is what turns a
     * machine that vanished into work somebody else can pick up, and it happens
     * here because a poll is the moment it matters.
     *
     * `isAbandoned` is what stops a poll whose worker has gone away from taking
     * a job with it. Found on the first live round trip: a worker was stopped
     * mid-long-poll, the socket closed, and the handler went on waiting -- then
     * claimed the next job submitted and opened an attempt for a machine that
     * no longer existed. The job sat leased, unheartbeated, for a full lease
     * period and burnt one of its attempts, and with `max_attempts` of three,
     * three dropped connections would expire a job no machine had ever touched.
     *
     * @async
     * @param {Object} body - `{worker_id, capabilities, slot_indexes, wait_seconds}`.
     * @param {Function} [isAbandoned] - Answers true once the caller's
     * connection has gone. Checked before every claim, so a poll nobody is
     * listening to stops rather than leasing work into the void.
     * @returns {Promise<Object|null>} The lease, or null when there is no work.
     * @throws {ApiError} 400 for a bad request, 404 for an unknown worker.
     */
    async pollForWork(body, isAbandoned) {
        const workerId = requiredInteger(body.worker_id, 'worker_id');
        const waitSeconds = Math.min(
            Math.max(optionalInteger(body.wait_seconds, 'wait_seconds', 0), 0),
            POLL_MAX_WAIT_SECONDS
        );

        const worker = await gpuRepository.getWorkerById(workerId);

        if (!worker) {
            throw new ApiError(
                404,
                ERROR_CODES.RESOURCE_NOT_FOUND,
                `Worker ${workerId} is not enrolled. Enrol before polling.`
            );
        }

        // Heard from, whatever the answer turns out to be. Before every other
        // branch below, because a machine that is paused, or full, or given
        // nothing is still demonstrably alive -- and `last_seen_at` is the only
        // thing a pool view has to tell an idle machine from a dead one.
        await gpuRepository.markWorkerSeen(workerId);

        /* **And the GPU reading it sent, which used to be discarded unless it got
           work.** `capabilities` arrives on every poll and was read only when a lease
           was granted, as the attempt snapshot -- so the activity charts could show only
           the minutes a machine happened to be holding one, and an idle pool looked like
           no pool. Same field, written down instead of dropped. */
        /* The machine's own reading goes with it. `capabilities.resources` is overwritten
           on every poll, so without keeping it here a worker's CPU ten minutes ago is not
           knowable anywhere -- which is why the Workers page could show a current figure
           and no history. */
        const resources = (body.capabilities && body.capabilities.resources) || null;

        await gpuRepository.sampleIdleWorker({
            workerId,
            devices: resources && resources.nvidia && resources.nvidia.devices,
            system: systemReading(resources),
        });

        // And while something is happening, retire whatever has stopped
        // happening (#202). One poll from any machine keeps the whole pool
        // honest, which is why this needs no timer of its own -- and it is after
        // `markWorkerSeen`, so this machine can never sweep itself.
        await this.sweepStaleWorkers();

        // A paused machine is not given work. Without this it would lease a job,
        // be told to pause at its first heartbeat, and give the job back -- so a
        // paused worker that kept polling would churn the whole queue through
        // pointless leases.
        if (worker.state === 'paused') {
            return null;
        }

        // A free slot the worker named, or slot 0 when it named none. Which slot
        // is bookkeeping for the worker's own benefit -- the coordinator only
        // records it so a pool view can say which GPU is busy.
        const slotIndex = Array.isArray(body.slot_indexes) && body.slot_indexes.length > 0
            ? requiredInteger(body.slot_indexes[0], 'slot_indexes[0]')
            : 0;

        await this.expireStaleLeases();

        const deadline = Date.now() + (waitSeconds * 1000);

        for (;;) {
            // Checked before the claim, not after: claiming is what opens an
            // attempt, and an attempt opened for a machine that has gone is
            // worse than no attempt at all.
            if (isAbandoned && isAbandoned()) {
                return null;
            }

            const { lease, slotsFull } = await gpuRepository.claimNextJob({
                workerId,
                slotIndex,
                capabilities: body.capabilities,
            });

            if (lease) {
                let spec;

                try {
                    spec = await this.resolveSpecForLease(this.applyResumePoint(lease.job));
                } catch (error) {
                    // The lease is given up rather than handed over. Two worse
                    // options were available: hand out a spec with no URL in it,
                    // which breaks the coordinator's one guarantee and makes the
                    // failure the worker's to explain; or put the job straight
                    // back in the queue, which retries an unresolvable item
                    // forever and never becomes visible to anybody. Failing the
                    // attempt spends one of the job's attempts, so a job whose
                    // video cannot be resolved exhausts them and lands `failed`,
                    // with the reason on every attempt row.
                    await gpuRepository.failAttemptUnresolved({
                        attemptId: lease.attempt.id,
                        failureReason: `This lease could not be resolved: ${error.message}`,
                    });

                    // 204, not a retry inside this poll. Looking again at once
                    // would re-lease the same job and burn every attempt in one
                    // request, hammering Jellyfin as it went.
                    return null;
                }

                await gpuPlaybackService.start(lease.attempt.id);

                return {
                    job_id: lease.job.id,
                    attempt_id: lease.attempt.id,
                    lease_epoch: lease.attempt.lease_epoch,
                    lease_expires_at: lease.attempt.lease_expires_at,
                    heartbeat_seconds: HEARTBEAT_SECONDS,
                    slot_index: lease.attempt.slot_index,
                    kind: lease.job.kind,
                    batch_id: lease.job.batch_id,
                    spec,
                };
            }

            // Already running as much as it said it can. Answered at once rather
            // than waited out: nothing that could appear in the queue would
            // change the answer until this machine finishes something.
            if (slotsFull) {
                return null;
            }

            const remaining = deadline - Date.now();

            if (remaining <= 0) {
                return null;
            }

            await sleep(Math.min(POLL_RETRY_INTERVAL_MS, remaining));
        }
    }

    /**
     * Turn a stored spec into the one a worker is handed.
     *
     * Two resolutions, both of them the coordinator's and neither of them the
     * worker's: **which source to open**, and **which survey convention counts**.
     * They happen together and at lease time for the same reason -- a stream URL
     * carries a credential that would rot in the queue, and a session's type can
     * change between a submission and a claim, so a spec frozen at submission
     * would be answering yesterday's question.
     *
     * A failure here gives the lease up rather than handing over a half-resolved
     * spec; the caller fails the attempt and says why.
     *
     * @async
     * @param {Object} spec - The stored spec, as submitted.
     * @returns {Promise<Object>} The spec a worker is handed.
     * @throws {Error} When either resolution fails.
     */
    async resolveSpecForLease(spec) {
        /* A training job has no video, no frame range and no session to file
           observations into, so three of the four steps below have nothing to
           work on and `resolveVideoForLease` would refuse the lease outright.
           Told apart by the dataset, not by the engine name: the engine is a
           free string the submitter chose, and a typo in it must not decide
           which resolution runs.

           The model's class names still matter, and arguably matter more here:
           they are what the finished weights will be registered with. */
        if (spec && typeof spec === 'object' && spec.dataset) {
            return this.declareModelClassesForLease(spec);
        }

        return this.declareModelClassesForLease(
            await this.describeSessionForLease(
                await this.resolveDataTypeForLease(await this.resolveVideoForLease(spec))
            )
        );
    }

    /**
     * Tell the worker which classes the model it asked for is supposed to have
     * (#214).
     *
     * **The sha256 on a spec verifies the file, not the model.** A worker hashes
     * what it fetched and then loads it and trusts it; nothing anywhere compares
     * the classes it ended up with against the model the job named. The window
     * makes that gap visible without closing it -- its labels come from
     * `yolo_model.names`, the weights actually in memory, while its footer comes
     * from `spec.model.name` -- so a run on the wrong weights reads as the right
     * model producing surprising animals.
     *
     * That is not hypothetical. On 2026-09-18 boxes were labelled with the coral
     * model's classes on two machines while every leased job was `rockfish5`,
     * and the only reason it was caught at all is that somebody was watching the
     * screen. Confident, plausible, wrong species is the worst thing this
     * pipeline can produce, because nothing downstream can tell it from data.
     *
     * So the spec now carries the model's registered trained species, and the
     * worker refuses to start when the loaded class names disagree. These are
     * the same names the ingest resolves detections against, so a mismatch was
     * always going to fail -- this moves the discovery from after an hour of GPU
     * time to before the first frame.
     *
     * **Attached when known, and its absence is not a refusal.** A model with no
     * `model_species` rows yet is a seeding gap rather than a wrong model, and a
     * coordinator that stops leasing over one has turned a missing label into an
     * outage. The worker treats an absent list as "cannot check" and says so.
     *
     * @async
     * @param {Object} spec - The spec being prepared for a lease.
     * @returns {Promise<Object>} The spec, with `model.class_names` where known.
     */
    async declareModelClassesForLease(spec) {
        const modelId = spec && spec.model && spec.model.ml_model_id;

        if (!modelId) {
            return spec;
        }

        try {
            const names = await ingestRepository.trainedSpeciesNames(modelId);

            if (!names.length) {
                return spec;
            }

            return { ...spec, model: { ...spec.model, class_names: names } };
        } catch {
            // Same rule as the session decoration above: a worker that cannot be
            // told what to expect still works, and refusing a lease over it
            // would make a reporting gap into a stopped pool.
            return spec;
        }
    }

    /**
     * Put the session's own details on the leased spec, for a worker to show.
     *
     * A spec carrying `{"session_id": 510}` tells a worker an integer. That is
     * all it has ever needed -- the session is MARP's business and the worker
     * only echoes it back -- but a machine that puts inference on screen for the
     * person whose GPU is running it has something to say, and "510" is not it.
     * Project, dive, line and type are what identify a piece of survey work to
     * somebody looking at it.
     *
     * **Added to the leased copy only.** The stored spec keeps what was
     * submitted, the same as the resolved video url and the resumed range: a
     * session can be renamed or retyped after a job is queued, so freezing its
     * details into the queue would preserve yesterday's answer.
     *
     * Failure is silent by design. This is decoration on a screen, and a worker
     * that cannot be told a dive name should still process the video -- unlike
     * the video url or the data type, where an unresolvable value means the run
     * would be wrong rather than unlabelled.
     *
     * @async
     * @param {Object} spec - The spec being prepared for a lease.
     * @returns {Promise<Object>} The spec, with `session` expanded where possible.
     */
    async describeSessionForLease(spec) {
        const session = observationIngestService.validateSpecSession(spec.session);

        if (!session) {
            return spec;
        }

        try {
            const described = await gpuRepository.describeSession(session);

            if (!described) {
                return spec;
            }

            // A declared top-level field, not an addition to `spec.session`.
            // The worker's `JobSpec` has no `session` at all -- it is MARP's
            // business and a worker only ever echoed it back -- so anything put
            // there is dropped by pydantic before the engine sees it, with no
            // error on either side. An undeclared field would have produced an
            // empty status bar and two agents wondering which half was wrong.
            return { ...spec, session_context: described };
        } catch {
            // Decoration, not contract. A worker with an unlabelled window is
            // working; a worker refused a lease over a label is not.
            return spec;
        }
    }

    /**
     * Move a resumed job's range forward to where the last worker stopped.
     *
     * A job an operator stopped part-way goes back to the queue carrying
     * `resume_from_frame`, and whoever leases it next must start there rather
     * than at the beginning -- otherwise every hand-over reprocesses everything
     * already done, and a job passed between three volunteers does the first
     * frames three times.
     *
     * **The stored spec is not rewritten**, here or anywhere: it is what was
     * submitted, and a scientific record that quietly edits the question it was
     * asked is worse than one that needs a second column read. This returns a
     * copy for the lease and leaves `gpu_jobs.spec` alone.
     *
     * Both bounds are half-open, and `resume_from_frame` is already an exclusive
     * upper bound on what was finished, so it is the next `start_frame` as it
     * stands. A resume point at or past `end_frame` is ignored rather than
     * producing an empty or inverted range -- that would mean the job is
     * finished, which is not this function's decision to make.
     *
     * **It also says where the job itself began**, as `job_start_frame`, which
     * is the start it has just moved. Without it the worker cannot tell a
     * resumed attempt from a fresh one -- it is handed a range beginning
     * part-way through a dive and nothing to say why -- so the watch window's
     * timeline draws the earlier attempt's frames as work this job skipped.
     * Added for MarineAppliedResearch/marp-inference-worker#60; a worker that
     * does not read it is unaffected, because nothing else in the spec moves.
     *
     * @param {Object} job - The `gpu_jobs` row being leased.
     * @returns {Object} The spec to resolve and hand over.
     */
    applyResumePoint(job) {
        const spec = job.spec;
        const resumeFrom = job.resume_from_frame;

        if (resumeFrom === null || resumeFrom === undefined || !spec || !spec.range) {
            return spec;
        }

        const startFrame = Number(spec.range.start_frame);
        const endFrame = Number(spec.range.end_frame);

        if (!(resumeFrom > startFrame) || !(resumeFrom < endFrame)) {
            return spec;
        }

        return {
            ...spec,
            range: {
                ...spec.range,
                start_frame: resumeFrom,
                job_start_frame: startFrame,
            },
        };
    }

    /**
     * Fill `params.data_type` from the session the job writes into.
     *
     * **This decides which frame of a track becomes the observation**, and so
     * its timecode. `pick_observation_time` counts a fish when its centre crosses
     * near the bottom of frame and an invertebrate when it enters the
     * bottom-centre trapezoid; those are survey conventions, not geometry, and
     * the worker cannot know which applies because it knows nothing about MARP.
     *
     * Left alone when the submitter set one. Filled from `sessions.type`
     * otherwise, which maps straight through -- the values are identical, which
     * is presumably why this went unnoticed while the worker defaulted it to
     * `Fish`.
     *
     * Nothing is filled for a job with no session: it produces no observations,
     * so there is no observation frame to choose and no session to choose it
     * from. Such a job still meets the worker's own default, which is its own
     * business.
     *
     * @async
     * @param {Object} spec - The spec, with its video already resolved.
     * @returns {Promise<Object>} A copy whose `params.data_type` is set, where
     * one could be.
     * @throws {Error} When the job names a session that cannot be read, or one
     * the engine has no counting rule for.
     */
    async resolveDataTypeForLease(spec) {
        if (this.submittedDataType(spec) !== null) {
            return spec;
        }

        const session = observationIngestService.validateSpecSession(spec.session);

        if (!session) {
            return spec;
        }

        const sessionType = await observationIngestService.sessionTypeForSpec(session);

        if (sessionType === null) {
            throw new Error(
                `the job names session ${session.session_id}, which does not exist, so there is no `
                + 'survey convention to score its observations by.'
            );
        }

        // Refused here as well as at submit, and this is the one that counts: a
        // session's type can be edited after a job is queued, and handing over a
        // type the engine does not branch on means the track's first frame is
        // used instead, silently.
        if (!ENGINE_DATA_TYPES.includes(sessionType)) {
            throw new Error(
                `session ${session.session_id} has type "${sessionType}", which the inference engine has `
                + `no counting rule for. It branches on ${ENGINE_DATA_TYPES.join(', ')}.`
            );
        }

        return {
            ...spec,
            params: { ...(spec.params && typeof spec.params === 'object' ? spec.params : {}), data_type: sessionType },
        };
    }

    /**
     * Turn a stored spec into the one a worker is handed.
     *
     * **This is the coordinator's guarantee: the leased spec carries
     * `video.url`.** A worker knows nothing about MARP or Jellyfin -- it is
     * handed a source it can open and opens it -- which is also why a worker can
     * process any reachable source and not only a Jellyfin item. Resolution
     * therefore belongs to the coordinator, and `jellyfin_item_id` travels
     * through untouched as provenance for the worker to echo into its output.
     *
     * At lease time rather than at job creation, and that placement is the whole
     * reason this function exists: a stream URL carries its own media credential,
     * and one minted when the job was queued would sit in the queue rotting until
     * somebody claimed it. Resolving here is also what makes a short-lived
     * per-attempt token possible later, which is the fix for handing a media key
     * to a machine MARP does not control.
     *
     * A spec that already carries a URL is passed through as it stands. Nothing
     * is written back to the job row either way: the stored spec keeps what was
     * submitted.
     *
     * @async
     * @param {Object} spec - The stored spec, as submitted.
     * @returns {Promise<Object>} A copy whose `video` carries `url` and `source_name`.
     * @throws {Error} When the video cannot be resolved. The caller fails the
     * attempt rather than handing out a lease with no URL in it.
     */
    async resolveVideoForLease(spec) {
        const video = spec && typeof spec === 'object' ? spec.video : null;

        if (!video || typeof video !== 'object') {
            throw new Error('the job spec carries no video to resolve.');
        }

        // Already playable. A submission of a bare URL is handed on exactly as it
        // was given, because the submitter is the only one who knows what that
        // source is.
        if (typeof video.url === 'string' && video.url.trim() !== '') {
            return spec;
        }

        const itemId = video.jellyfin_item_id;

        if (typeof itemId !== 'string' || itemId.trim() === '') {
            throw new Error('the job spec carries neither a video.url nor a video.jellyfin_item_id.');
        }

        // The name only when it was not submitted. It is what appears as
        // `video_source` on every observation the run produces and cannot be
        // guessed from a URL, so a leased spec without it would silently produce
        // unattributable observations.
        let sourceName = typeof video.source_name === 'string' ? video.source_name.trim() : '';

        if (sourceName === '') {
            const item = await jellyfinRepository.getItem(itemId, MEDIA_CLIENT_IDENTITY);

            if (!item) {
                throw new Error(`Jellyfin has no item ${itemId}.`);
            }

            // The basename of Jellyfin's own path first: a stored `video_source`
            // is a filename with its extension, and Jellyfin's display name is
            // usually the stem. The display name is the fallback for a library
            // that exposes no path.
            sourceName = fileNameFromPath(item.path) || item.name || '';

            if (sourceName === '') {
                throw new Error(
                    `Jellyfin item ${itemId} has neither a path nor a name, so there is nothing to record as video_source.`
                );
            }
        }

        const url = await jellyfinRepository.buildDirectStreamUrl(itemId, MEDIA_CLIENT_IDENTITY);

        if (typeof url !== 'string' || url.trim() === '') {
            throw new Error(`Jellyfin returned no stream URL for item ${itemId}.`);
        }

        // The nominal rate, so the worker numbers frames on the video's own clock
        // rather than by counting them (#231). Optional: a worker that is not
        // given it uses the rate its decoder reports.
        let frameRate = null;

        try {
            const rates = await jellyfinRepository.getVideoFrameRate(itemId, MEDIA_CLIENT_IDENTITY);
            frameRate = rates && rates.realFrameRate ? rates.realFrameRate : null;
        } catch (error) {
            logger.info(`no frame rate for Jellyfin item ${itemId} at lease: ${error.message}`);
        }

        return {
            ...spec,
            video: { ...video, url, source_name: sourceName, ...(frameRate ? { frame_rate: frameRate } : {}) },
        };
    }

    /**
     * Record a heartbeat and return the one control instruction MARP has.
     *
     * @async
     * @param {number|string} attemptId - Attempt from the path.
     * @param {Object} body - `{worker_id, lease_epoch, state, progress}`.
     * @returns {Promise<Object>} `{action, lease_expires_at, ...}`.
     * @throws {ApiError} 400 for a bad request, including a worker trying to
     * declare itself finished.
     */
    async heartbeat(attemptId, body) {
        const workerId = requiredInteger(body.worker_id, 'worker_id');
        const leaseEpoch = requiredInteger(body.lease_epoch, 'lease_epoch');

        // A worker may say it is preparing, running or uploading. It may not say
        // it succeeded: the coordinator's row is the truth, and a terminal state
        // is something the coordinator decides when it accepts a result.
        if (body.state !== undefined && !REPORTABLE_ATTEMPT_STATES.includes(body.state)) {
            invalid(
                `state must be one of: ${REPORTABLE_ATTEMPT_STATES.join(', ')}. `
                + 'A finished attempt is reported through the result route, which is what decides what it means.'
            );
        }

        const progress = this.validateProgress(body.progress);

        const parsedAttemptId = this.attemptIdFromPath(attemptId);
        const outcome = await gpuRepository.recordHeartbeat({
            attemptId: parsedAttemptId,
            workerId,
            leaseEpoch,
            state: body.state,
            progress,
            telemetry: validateTelemetry(body.telemetry),
        });

        // A refused heartbeat carries no accepted attempt. It may have named a
        // live attempt owned by somebody else, so it must not close that slot's
        // Jellyfin session merely because the refusal says "abandon".
        if (outcome.attempt || outcome.job_state !== undefined) {
            await gpuPlaybackService.heartbeat(parsedAttemptId, outcome.action);
        }

        return {
            action: outcome.action,
            reason: outcome.reason || null,
            lease_expires_at: outcome.lease_expires_at,
            heartbeat_seconds: HEARTBEAT_SECONDS,
        };
    }

    /**
     * Append a batch of events.
     *
     * @async
     * @param {number|string} attemptId - Attempt from the path.
     * @param {Object} body - `{worker_id, lease_epoch, events: [{seq, kind, at, payload}]}`.
     * @returns {Promise<Object>} `{accepted, duplicates, next_seq, action}`.
     * @throws {ApiError} 400 for a bad batch.
     */
    async recordEvents(attemptId, body) {
        const workerId = requiredInteger(body.worker_id, 'worker_id');
        const leaseEpoch = requiredInteger(body.lease_epoch, 'lease_epoch');

        if (!Array.isArray(body.events)) {
            invalid('events must be an array.');
        }

        if (body.events.length === 0) {
            invalid('events must contain at least one event.');
        }

        if (body.events.length > MAX_EVENTS_PER_BATCH) {
            invalid(`events must contain at most ${MAX_EVENTS_PER_BATCH} events; send more than that as two batches.`);
        }

        const seen = new Set();

        const events = body.events.map((event, index) => {
            const seq = requiredInteger(event.seq, `events[${index}].seq`);

            if (seq < 0) {
                // Negative sequence numbers are the coordinator's own, for notes
                // it records against an attempt. A worker using one would have
                // its event silently swallowed as a duplicate.
                invalid(`events[${index}].seq must be zero or greater.`);
            }

            if (seen.has(seq)) {
                invalid(`events[${index}].seq ${seq} appears twice in this batch.`);
            }

            seen.add(seq);

            // A worker sends metrics and log lines. `note` is the coordinator's
            // own kind, and letting a worker write one would make the record of
            // why a lease was taken away untrustworthy.
            const kind = requiredEnum(event.kind, `events[${index}].kind`, WORKER_EVENT_KINDS);

            // A settings report is read whole here, so a malformed one refuses
            // the batch before anything is written. The raw payload is still
            // what gets stored as the event; the parsed report is what the
            // repository writes into the settings tables.
            const settings = kind === 'settings'
                ? settingsReport(event.payload, `events[${index}].payload`)
                : undefined;

            return { seq, kind, at: event.at, payload: event.payload, settings };
        });

        return gpuRepository.appendEvents({
            attemptId: this.attemptIdFromPath(attemptId),
            workerId,
            leaseEpoch,
            events,
        });
    }

    /**
     * Record an attempt's terminal report.
     *
     * Every named artifact has to be staged already. Refusing here rather than
     * recording a row that points at bytes MARP does not hold is the difference
     * between a result that can be opened and one that only looks like it can.
     *
     * @async
     * @param {number|string} attemptId - Attempt from the path.
     * @param {Object} body - `{worker_id, lease_epoch, outcome, failure_reason, artifacts}`.
     * @returns {Promise<Object>} The idempotent ack.
     * @throws {ApiError} 400 for a bad request, 409 for an artifact never handed over.
     */
    async recordResult(attemptId, body) {
        const workerId = requiredInteger(body.worker_id, 'worker_id');
        const leaseEpoch = requiredInteger(body.lease_epoch, 'lease_epoch');
        const outcome = requiredEnum(body.outcome, 'outcome', RESULT_OUTCOMES);

        const artifacts = body.artifacts === undefined ? [] : body.artifacts;

        if (!Array.isArray(artifacts)) {
            invalid('artifacts must be an array of {sha256, role}.');
        }

        const named = artifacts.map((artifact, index) => ({
            sha256: this.validateSha256(artifact.sha256, `artifacts[${index}].sha256`),
            role: artifact.role === undefined ? 'result' : requiredString(artifact.role, `artifacts[${index}].role`),
        }));

        for (const artifact of named) {
            const staged = await gpuRepository.findStagedArtifact(artifact.sha256);

            // The bytes, not the row (#225) -- the same reason `checkArtifact`
            // asks the disk. Refusing here is much the better place for it: the
            // worker still holds the file and is told to upload it, where an
            // accepted result would publish a success and then withdraw it.
            const held = Boolean(staged)
                && fs.existsSync(path.join(ARTIFACT_DIRECTORY, artifact.sha256));

            if (!held) {
                throw new ApiError(
                    409,
                    ERROR_CODES.CONFLICT,
                    `Artifact ${artifact.sha256} has not been handed over. Check and upload it before reporting a result that names it.`
                );
            }
        }

        // How far the worker actually got. It has always computed and sent this;
        // nothing here read it until `yielded` gave it something to mean. Kept
        // optional because only a stop has a part-way point to report.
        const completedThroughFrame = optionalInteger(
            body.completed_through_frame, 'completed_through_frame', null
        );

        if (completedThroughFrame !== null && completedThroughFrame < 0) {
            invalid('completed_through_frame must be zero or greater.');
        }

        const parsedAttemptId = this.attemptIdFromPath(attemptId);
        const published = await gpuRepository.publishResult({
            attemptId: parsedAttemptId,
            workerId,
            leaseEpoch,
            outcome,
            failureReason: body.failure_reason,
            artifacts: named,
            completedThroughFrame,
        });

        await gpuPlaybackService.stop(parsedAttemptId);

        const ingest = await this.ingestPublishedJob(published);

        // **What YOLO measured, which is not an ingest and must not behave like one.**
        // A training job is not in `INGESTIBLE_JOB_KINDS`, so the branch below never
        // fires for one, and this deliberately cannot withdraw a success: the
        // deliverable of a training run is the weights, which are already stored and
        // verified by hash. Costing a volunteer hours of GPU time because a plot's JSON
        // was malformed would be the wrong trade, so a failure here is reported and the
        // run stays succeeded.
        const trainingMetrics = await trainingMetricsService.ingestForPublishedAttempt(published);

        // **A success that did not reach the database is withdrawn** (#225).
        // `publishResult` marked the attempt succeeded because the bytes arrived;
        // that is only half of finishing, and an ingest that refused them means
        // MARP does not have data it was supposed to have. Isaac, 2026-09-19:
        // *"if a job is considered finished the api has actually ingested it's
        // data, otherwise the job isn't finished."*
        //
        // A retry costs GPU time and is the point rather than a side effect: it
        // is what turns a silent loss into something that either fixes itself --
        // a missing artifact is re-offered and re-uploaded -- or keeps failing
        // loudly until somebody looks.
        if (ingest && ingest.failed) {
            const withdrawn = await gpuRepository.failAttemptAfterIngest(
                published.attempt_id, ingest.failed
            );

            logger.error(
                `Error::attempt ${published.attempt_id} reported success but its results were not `
                + `ingested, so it is failed and job ${published.job_id} is `
                + `${withdrawn ? withdrawn.jobState : 'unchanged'}: ${ingest.failed}`
            );

            return {
                ...published,
                ingest,
                attempt_state: 'failed',
                job_state: withdrawn ? withdrawn.jobState : published.job_state,
            };
        }

        const answer = ingest === null ? { ...published } : { ...published, ingest };

        // Only when there was something to say. A `skipped` on every inference result
        // would be noise in an answer the worker reads.
        if (!trainingMetrics.skipped) {
            answer.training_metrics = trainingMetrics;
        }

        return answer;
    }

    /**
     * Turn a job that has just published a successful result into observations.
     *
     * **After the result transaction has committed, and in its own transaction.**
     * A parse failure must not roll back a job whose compute succeeded, or the
     * worker would be asked to redo hours of GPU work because a species name was
     * missing from a list -- and the bytes are already held, so the fix is to
     * correct the data and call the ingest route, not to run the model again.
     *
     * A failure is therefore recorded rather than thrown: as a coordinator note
     * on the attempt, in the log, and in the `ingest` block of the answer the
     * worker gets. That is what makes it loud without making it the worker's
     * problem.
     *
     * @async
     * @param {Object} published - What `publishResult` returned.
     * @returns {Promise<Object|null>} What was ingested, why it was not, or null
     * when this result was never a candidate.
     */
    async ingestPublishedJob(published) {
        // **Keyed on the attempt, not on the job.** A job an operator stopped
        // goes back to the pool and is finished by several attempts in sequence,
        // each carrying its own observations -- so `published_attempt_id`, which
        // names one attempt and is set once, can no longer be the guard. It would
        // let the first segment in and refuse every later one as already
        // ingested, silently losing the work of every volunteer but the first.
        if (!published || !published.ingestable) {
            return null;
        }

        // The same attempt reporting twice must not ingest twice. `ingested_at`
        // is the record of what has already been taken, and it is claimed inside
        // a transaction below rather than checked here, so two concurrent results
        // for one attempt cannot both pass this point.
        const claimed = await gpuRepository.claimAttemptForIngest(published.attempt_id);

        if (!claimed) {
            return { ingested: false, skipped: 'this attempt has already been ingested' };
        }

        const detail = await gpuRepository.getJobDetail(published.job_id);

        if (!detail || !INGESTIBLE_JOB_KINDS.includes(detail.job.kind)) {
            await gpuRepository.releaseAttemptIngestClaim(published.attempt_id);
            return null;
        }

        // A job submitted without a session has nowhere to put observations.
        // Skipped rather than failed: producing only a detections artifact is a
        // legitimate run, and every job predating spec.session is one.
        if (!detail.job.spec || !detail.job.spec.session) {
            await gpuRepository.releaseAttemptIngestClaim(published.attempt_id);
            return { ingested: false, skipped: 'the job spec names no session' };
        }

        // **Only this attempt's artifacts.** `getJobDetail` returns every
        // artifact the job has, and a job finished by several volunteers in
        // sequence accumulates one per segment -- so handing the lot over would
        // re-ingest every earlier segment on every hand-over. Each artifact
        // records the attempt that produced it when it is recorded.
        const mine = detail.artifacts.filter(
            (artifact) => artifact.metadata
                && Number(artifact.metadata.attempt_id) === Number(published.attempt_id)
        );

        if (mine.length === 0) {
            await gpuRepository.releaseAttemptIngestClaim(published.attempt_id);

            // **A success that handed over nothing is not a success** (#230).
            // Reaching here means the spec names a session, so observations were
            // expected; returned as `failed`, the caller withdraws it the way it
            // withdraws an ingest that refused. It used to be `skipped`, which
            // left the job `succeeded` with nothing ingested. A stop hands over
            // what it has and is not a claim of success, so it stays a skip.
            if (published.outcome === 'succeeded') {
                const reason = 'this attempt reported success but handed over no artifacts, '
                    + 'so none of its results reached the database';

                await gpuRepository.appendCoordinatorNote(published.attempt_id, {
                    note: 'observation ingest failed',
                    job_id: published.job_id,
                    reason,
                });

                return { ingested: false, failed: reason };
            }

            return { ingested: false, skipped: 'this attempt handed over no artifacts' };
        }

        try {
            // Named, so the ingest guards on this attempt rather than on the
            // job. A job finished by several attempts in sequence brings its
            // observations a segment at a time, and a job-level "does this
            // already have any" would let the first through and drop the rest.
            return await observationIngestService.ingestJob({
                ...detail.job,
                attempt_id: published.attempt_id,
                artifacts: mine,
            });
        } catch (error) {
            const reason = error && error.message ? error.message : String(error);

            logger.error(`Error::observation ingest failed for job ${published.job_id}: ${reason}`);

            // Put the claim back. An attempt whose ingest threw has not been
            // ingested, and leaving `ingested_at` set would make the recovery
            // route refuse to try again -- which is the one thing it exists for.
            await gpuRepository.releaseAttemptIngestClaim(published.attempt_id);

            await gpuRepository.appendCoordinatorNote(published.attempt_id, {
                note: 'observation ingest failed',
                job_id: published.job_id,
                reason,
            });

            return { ingested: false, failed: reason };
        }
    }

    // -----------------------------------------------------------------
    // Artifact hand-off
    // -----------------------------------------------------------------

    /**
     * Answer whether MARP already holds these bytes, and say where to put them
     * if not.
     *
     * @async
     * @param {Object} body - `{sha256, bytes}`.
     * @returns {Promise<Object>} `{already_have, upload_url, max_bytes}`.
     * @throws {ApiError} 400 for a bad hash or size.
     */
    async checkArtifact(body) {
        const sha256 = this.validateSha256(body.sha256, 'sha256');
        const bytes = optionalInteger(body.bytes, 'bytes', null);

        if (bytes !== null && bytes < 0) {
            invalid('bytes must be zero or greater.');
        }

        const staged = await gpuRepository.findStagedArtifact(sha256);

        // **The bytes decide this, not the row** (#225). A worker that is told
        // `already_have` sends nothing, correctly -- so a row that outlives its
        // file makes every later hand-over of that content a no-op and every
        // job producing it fail ingest, permanently and silently.
        //
        // That is not hypothetical and it is not rare. Artifacts are addressed
        // by content, so every job that detects nothing produces the same empty
        // file; when its one copy went missing, 179 attempts reported success
        // and ingested nothing. One `existsSync` per hand-over is the whole
        // cost of making the class impossible.
        if (staged && fs.existsSync(path.join(ARTIFACT_DIRECTORY, sha256))) {
            return {
                already_have: true,
                sha256,
                bytes: Number(staged.bytes),
                upload_url: null,
                path: `${ARTIFACT_PATH_PREFIX}/${sha256}`,
            };
        }

        return {
            already_have: false,
            sha256,
            bytes,
            // A plain path rather than a signed one. The upload route is gated on
            // the same permission this call needed, and it verifies the bytes
            // against the hash before keeping them, so a signature would be a
            // second and weaker credential for the same thing.
            upload_url: `/api/v2/gpu/artifacts/upload/${sha256}`,
        };
    }

    /**
     * Record that the bytes for a hash have arrived.
     *
     * Called by the upload route once it has written and verified the file. The
     * writing stays in the route because that is where the request stream is; the
     * row is this layer's business.
     *
     * @async
     * @param {Object} params - `{sha256, bytes, contentType, attemptId}`.
     * @returns {Promise<Object>} `{sha256, bytes, path, already_have}`.
     */
    async stageArtifact({ sha256, bytes, contentType, attemptId }) {
        const staged = await gpuRepository.recordStagedArtifact({
            sha256,
            bytes,
            contentType,
            attemptId,
        });

        return {
            sha256: staged.sha256,
            bytes: Number(staged.bytes),
            content_type: staged.content_type,
            path: `${ARTIFACT_PATH_PREFIX}/${staged.sha256}`,
            already_have: true,
        };
    }

    // -----------------------------------------------------------------
    // Human-facing
    // -----------------------------------------------------------------

    /**
     * The pool: every machine, what it is, and what it is doing.
     *
     * `activity` is derived rather than stored, because a stored one would have
     * to be kept in step with the attempts table and would eventually disagree
     * with it. A worker is busy when it holds a live attempt.
     *
     * @async
     * @returns {Promise<Array<Object>>} One entry per worker.
     */
    /**
     * One machine's readings over a window, shaped for a chart.
     *
     * **Parallel arrays, and nulls kept as nulls.** A caller plots `at` against each
     * series; a minute the machine did not report is a `null` in every one of them rather
     * than a missing entry, so the arrays stay the same length and a break is drawn where
     * the machine was off. Collapsing those would silently join Tuesday to Thursday.
     *
     * **The first GPU only.** Every machine in this pool has one card, and a second would
     * need its own series rather than an average — a mean across two cards is a number no
     * sensor reported, which is the rule the rest of this file keeps.
     *
     * @async
     * @param {number|string} workerId - The machine.
     * @param {Object} [window] - `{since, until}` as ISO instants. Defaults to an hour.
     * @returns {Promise<Object>} `{at, gpu, vram, temperature, power, cpu, memory, disk}`.
     */
    async readWorkerSeries(workerId, { since, until } = {}) {
        const end = until ? new Date(until) : new Date();
        const start = since ? new Date(since) : new Date(end.getTime() - 3600000);

        const rows = await gpuRepository.listWorkerSamples({
            workerId,
            since: start.toISOString(),
            until: end.toISOString(),
        });

        const series = {
            at: [], gpu: [], vram: [], temperature: [], power: [], cpu: [], memory: [], disk: [],
        };
        /* A reading that is absent is null, never zero: the difference between a machine
           that was idle and one that was not asked is the whole reason these charts are
           worth drawing. */
        const read = (from, key) => (from && from[key] !== undefined && from[key] !== null
            ? Number(from[key]) : null);

        for (const row of rows) {
            const device = Array.isArray(row.devices) ? row.devices[0] : null;
            const system = row.system || null;

            series.at.push(row.at);
            series.gpu.push(read(device, 'gpu_utilization_percent'));
            series.vram.push(read(device, 'memory_percent_used'));
            series.temperature.push(read(device, 'temperature_c'));
            series.power.push(read(device, 'power_usage_watts'));
            series.cpu.push(read(system && system.cpu, 'cpu_percent'));
            series.memory.push(read(system && system.memory, 'percent_used'));
            series.disk.push(read(system && system.disk, 'percent_used'));
        }

        return { worker_id: Number(workerId), since: start.toISOString(), until: end.toISOString(), ...series };
    }

    async listPool() {
        // Sweeping here too, so the pool view does not show a machine as busy
        // with a job whose lease ran out an hour ago. A read that reports a state
        // the system has already abandoned is worse than a slightly slower read.
        await this.expireStaleLeases();

        // And the same again for the machines themselves (#202). This is the
        // read that makes a ghost visible -- it is the one a person opens to ask
        // what is running -- so it is the read that must not answer `online`
        // about a computer that is switched off.
        await this.sweepStaleWorkers();

        const rows = await gpuRepository.listWorkerPoolRows();
        const workers = new Map();

        for (const row of rows) {
            if (!workers.has(row.id)) {
                workers.set(row.id, {
                    worker_id: row.id,
                    name: row.name,
                    state: row.state,
                    activity: row.state === 'online' ? 'idle' : row.state,
                    slot_count: row.slot_count,
                    worker_version: row.worker_version,
                    capabilities: row.capabilities,
                    enrolled_at: row.enrolled_at,
                    last_seen_at: row.last_seen_at,

                    // The machine's own latest reading, which exists whether or not it is
                    // working. `gpu_worker_samples` is written every minute from the
                    // poll, not only on a job's heartbeat, and the LATERAL above keys on
                    // `worker_id` alone -- so this row has always carried it and only the
                    // attempt branch below ever looked.
                    //
                    // That left an idle machine with no GPU load, no VRAM, no temperature
                    // and no power, which is what Isaac found: a worker that is plainly
                    // on, reporting every minute, and showing nothing. A reading does
                    // belong to a moment rather than to a job, so `as_of` travels with it
                    // and the screen says how old it is.
                    telemetry: row.sample_devices
                        ? { gpus: reduceDevices(row.sample_devices), as_of: row.sample_at, live: true }
                        : null,

                    attempts: [],
                });
            }

            if (row.attempt_id === null) {
                continue;
            }

            const worker = workers.get(row.id);

            worker.activity = 'busy';
            worker.attempts.push({
                attempt_id: row.attempt_id,
                state: row.attempt_state,
                slot_index: row.attempt_slot_index,
                lease_epoch: row.attempt_lease_epoch,
                lease_expires_at: row.attempt_lease_expires_at,
                last_heartbeat_at: row.last_heartbeat_at,
                progress: {
                    done: row.progress_done,
                    total: row.progress_total,
                    unit: row.progress_unit,
                    phase: row.progress_phase,
                    elapsed_s: row.progress_elapsed_s === null
                        ? null
                        : Number(row.progress_elapsed_s),
                },

                // The machine's **live** reading where the heartbeat has written
                // one, falling back to the lease-time snapshot where it has not
                // -- an older worker, or a job that has not beaten yet. `as_of`
                // says which, and the screen is expected to show it, because the
                // two mean quite different things.
                //
                // Still absent entirely for an idle machine: a reading belongs
                // to work being done, and the last one from an hour ago under a
                // column headed *GPU load* would be a wrong number rather than a
                // missing one.
                telemetry: row.sample_devices
                    ? { gpus: reduceDevices(row.sample_devices), as_of: row.sample_at, live: true }
                    : gpuTelemetryFrom(row.capabilities_snapshot, row.attempt_leased_at),

                job: {
                    job_id: row.job_id,
                    kind: row.job_kind,
                    state: row.job_state,
                    batch_id: row.job_batch_id,
                    // What the machine is working on, in the words the Jobs tab uses:
                    // its name, and the spec its dive, line, range or dataset come from.
                    name: row.job_name,
                    spec: row.job_spec,
                },
            });
        }

        return Array.from(workers.values());
    }

    /**
     * Rename a machine.
     *
     * An operator action, and the name is the only thing it changes. The machine
     * is addressed by `worker_id` rather than by its durable id, because
     * `worker_id` is already the stable handle every other call quotes and the
     * durable id is not exposed by any response.
     *
     * A rename cannot disturb work: an attempt is identified by
     * `(attempt_id, worker_id, lease_epoch)`, and none of those is the name.
     *
     * @async
     * @param {number|string} workerId - Worker identifier from the path.
     * @param {Object} body - `{name}`.
     * @returns {Promise<Object>} The machine as it now stands.
     * @throws {ApiError} 400 for a bad id or name, 404 when there is no such machine.
     */
    async renameWorker(workerId, body) {
        const id = Number(workerId);

        if (!Number.isInteger(id)) {
            invalid('The worker id in the path must be an integer.');
        }

        const name = requiredWorkerName(body.name, 'name');

        const worker = await gpuRepository.renameWorker(id, name);

        if (!worker) {
            throw new ApiError(
                404,
                ERROR_CODES.RESOURCE_NOT_FOUND,
                `Worker ${id} is not enrolled.`
            );
        }

        // The same shape the pool view's entries carry, minus the derived
        // activity -- a rename says nothing about what the machine is doing.
        return {
            worker_id: worker.id,
            name: worker.name,
            state: worker.state,
            slot_count: worker.slot_count,
            worker_version: worker.worker_version,
            capabilities: worker.capabilities,
            enrolled_at: worker.enrolled_at,
            last_seen_at: worker.last_seen_at,
        };
    }

    /**
     * A window and a bucket, read off a query string.
     *
     * `bucket` is **whitelisted rather than escaped**, because `date_trunc` takes a literal
     * and the value is interpolated into the statement. Three units, and nothing a caller
     * sends reaches the SQL.
     *
     * The window defaults to the last 24 hours, which is what a dashboard opens on.
     *
     * @param {Object} query - `{since, until, bucket}` as strings.
     * @returns {Object} `{since, until, bucket}`.
     * @throws {ApiError} 400 for a bad instant, an unknown bucket, or a backwards window.
     */
    seriesWindow(query) {
        const until = optionalInstant(query.until, 'until') || new Date();
        const since = optionalInstant(query.since, 'since')
            || new Date(until.getTime() - 24 * 60 * 60 * 1000);

        if (since >= until) {
            invalid('since must be before until.');
        }

        const bucket = query.bucket === undefined
            ? 'hour'
            : requiredEnum(query.bucket, 'bucket', ['minute', 'hour', 'day']);

        return { since, until, bucket };
    }

    /**
     * What the pool's GPUs were doing, over a window.
     *
     * @async
     * @param {Object} query - `{since, until, bucket}`.
     * @returns {Promise<Object>} `{since, until, bucket, points}`.
     * @throws {ApiError} 400 for a bad window.
     */
    async gpuUtilizationSeries(query) {
        const window = this.seriesWindow(query);

        return { ...window, points: await gpuRepository.gpuUtilizationSeries(window) };
    }

    /**
     * How much work finished and how much was waiting, over a window.
     *
     * @async
     * @param {Object} query - `{since, until, bucket}`.
     * @returns {Promise<Object>} `{since, until, bucket, points}`.
     * @throws {ApiError} 400 for a bad window.
     */
    async jobThroughputSeries(query) {
        const window = this.seriesWindow(query);

        /* The same `kind` the job list takes, so a screen can ask what the
           inference queue is doing separately from the training one. */
        const kind = query.kind === undefined
            ? undefined
            : requiredEnum(query.kind, 'kind', JOB_KINDS);

        return {
            ...window,
            kind: kind || null,
            points: await gpuRepository.jobThroughputSeries({ ...window, kind }),
        };
    }

    /**
     * How fast work went through, with what is waiting now.
     *
     * The backlog is a single current figure rather than a series: nothing records what it
     * was, only what it is. Returned beside the series because the screen draws both and
     * asking twice would let them disagree.
     *
     * @async
     * @param {Object} query - `{since, until, bucket, kind}`.
     * @returns {Promise<Object>} `{since, until, bucket, points, queued}`.
     * @throws {ApiError} 400 for a bad window or an unknown kind.
     */
    async throughputSeries(query) {
        const window = this.seriesWindow(query);
        const kind = query.kind === undefined
            ? undefined
            : requiredEnum(query.kind, 'kind', JOB_KINDS);

        const [points, queued] = await Promise.all([
            gpuRepository.throughputSeries({ ...window, kind }),
            gpuRepository.queuedUnits(kind),
        ]);

        return { ...window, kind: kind || null, points, queued };
    }

    /**
     * How the model registry grew.
     *
     * @async
     * @param {Object} query - `{since, until, bucket}`.
     * @returns {Promise<Object>} `{since, until, bucket, points}`.
     * @throws {ApiError} 400 for a bad window.
     */
    async registrySeries(query) {
        const window = this.seriesWindow(query);

        return { ...window, points: await gpuRepository.registrySeries(window) };
    }

    /**
     * List jobs.
     *
     * @async
     * @param {Object} query - `{state, kind, batch_id, created_after, created_before,
     *   finished_after, finished_before, search, sort, direction, limit, offset}` as
     *   strings from the query string.
     * @returns {Promise<Object>} `{jobs, total, limit, offset}`.
     * @throws {ApiError} 400 for an unknown state, kind, sort key or timestamp.
     */
    async listJobs(query) {
        const filters = {};

        if (query.state !== undefined) {
            filters.state = requiredEnum(query.state, 'state', JOB_STATES);
        }

        if (query.kind !== undefined) {
            filters.kind = requiredEnum(query.kind, 'kind', JOB_KINDS);
        }

        if (query.batch_id !== undefined) {
            filters.batchId = requiredString(query.batch_id, 'batch_id');
        }

        filters.createdAfter = optionalInstant(query.created_after, 'created_after');
        filters.createdBefore = optionalInstant(query.created_before, 'created_before');
        filters.finishedAfter = optionalInstant(query.finished_after, 'finished_after');
        filters.finishedBefore = optionalInstant(query.finished_before, 'finished_before');

        if (query.search !== undefined && String(query.search).trim() !== '') {
            filters.search = String(query.search).trim();
        }

        // Rejected rather than ignored. A sort the route silently dropped would
        // hand back rows in some other order and look like a broken sort.
        if (query.sort !== undefined) {
            filters.sort = requiredEnum(
                query.sort, 'sort', Object.keys(gpuRepository.JOB_SORT_COLUMNS)
            );
        }

        if (query.direction !== undefined) {
            filters.direction = requiredEnum(query.direction, 'direction', ['asc', 'desc']);
        }

        filters.limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
        filters.offset = Math.max(Number(query.offset) || 0, 0);

        // Sweeping before a read, same reason as the pool view.
        await this.expireStaleLeases();

        const { jobs, total } = await gpuRepository.listJobs(filters);

        return { jobs, total, limit: filters.limit, offset: filters.offset };
    }

    /**
     * One job, with every attempt at it and everything it produced.
     *
     * @async
     * @param {number|string} jobId - Job identifier from the path.
     * @returns {Promise<Object>} `{job, attempts, artifacts}`.
     * @throws {ApiError} 404 when there is no such job.
     */
    async getJob(jobId) {
        // Sweeping here too, for the reason the pool and the list already give:
        // a read that reports a state the system has already abandoned is worse
        // than a slightly slower read.
        //
        // This was the one read that did not, and it is the read a job's own
        // page makes. Measured: with the worker killed, `GET /gpu/jobs/:id`
        // went on answering `leased` / `running` for forty seconds past the
        // lease deadline, and only changed once some other request happened to
        // sweep. A page watching one job would show a dead machine as working
        // indefinitely.
        await this.expireStaleLeases();

        const detail = await gpuRepository.getJobDetail(this.jobIdFromPath(jobId));

        if (!detail) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `GPU job ${jobId} was not found.`);
        }

        return detail;
    }

    /**
     * Submit work: one job, or a batch covering a long video in pieces.
     *
     * A `piece_frames` turns one submission into N jobs sharing a `batch_id`,
     * each with its own frame range. N independent jobs rather than one job with
     * children, so each piece leases, retries and fails on its own -- which is
     * what lets ten machines share a ten-hour video without any of them knowing
     * about the others.
     *
     * @async
     * @param {Object} body - `{kind, spec, priority, max_attempts, piece_frames, piece_seconds}`.
     * @param {Object} [principal] - The authenticated caller, for `created_by`.
     * @returns {Promise<Object>} `{batch_id, jobs}`.
     * @throws {ApiError} 400 for a spec that cannot be scheduled.
     */
    async submitJobs(body, principal) {
        const kind = requiredEnum(body.kind, 'kind', JOB_KINDS);
        // Reassigned when a per-run session is created, so the stored spec names it.
        let spec = body.spec;

        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
            invalid('spec is required and must be an object.');
        }

        requiredString(spec.engine, 'spec.engine');

        /* A training job is a different shape and splits into nothing. Branched
           here, before the video validation, because `video` and `range` are
           required for everything below this line and a training job has
           neither -- it has a dataset. */
        if (kind === 'training') {
            return this.submitTrainingJob(body, spec, principal);
        }

        if (!spec.video || typeof spec.video !== 'object' || Array.isArray(spec.video)) {
            invalid('spec.video is required and must be an object.');
        }

        this.validateSubmittedVideo(spec.video);
        this.validateSubmittedModel(spec.model);
        await this.refuseBaseModelForInference(spec.model);
        this.validateSubmittedReduction(spec.reduction);

        // Turns the per-run form into the descriptive one, so every check below --
        // including the engine's understanding of the session type -- runs exactly as
        // it does for a spec somebody wrote by hand.
        const makeRunSession = await this.resolvePerRunSession(kind, spec);

        await this.validateSubmittedObservationTarget(kind, spec);

        // The range still reaches the queue and the worker as an explicit
        // `{start_frame, end_frame}`, so nothing downstream special-cases a whole
        // video. What changed is who works the numbers out: a person naming a
        // Jellyfin item does not know where it ends, and asking them was how two
        // wrong ranges got queued in one afternoon -- one from a frame rate read
        // off a screenshot, one from windows picked by hand (#199).
        const range = spec.range && typeof spec.range === 'object' ? spec.range : {};
        const startFrame = range.start_frame === undefined || range.start_frame === null
            ? 0
            : requiredInteger(range.start_frame, 'spec.range.start_frame');

        if (startFrame < 0) {
            invalid('spec.range.start_frame must be zero or greater.');
        }

        const endFrame = range.end_frame === undefined || range.end_frame === null
            ? await this.frameCountForVideo(spec.video)
            : requiredInteger(range.end_frame, 'spec.range.end_frame');

        // Strictly greater, because the range is half-open and so
        // `end_frame == start_frame` is the empty range. Rejected here rather
        // than queued: a job covering no frames would lease, run, report success
        // and produce nothing, which looks like a working pipeline losing data.
        if (endFrame <= startFrame) {
            invalid(
                'spec.range.end_frame must be greater than spec.range.start_frame. '
                + 'The range is half-open -- end_frame is one past the last frame -- so equal bounds cover no frames at all.'
            );
        }

        const priority = optionalInteger(body.priority, 'priority', 0);
        const maxAttempts = optionalInteger(body.max_attempts, 'max_attempts', 3);

        if (maxAttempts < 1) {
            invalid('max_attempts must be at least 1.');
        }

        let pieceFrames = optionalInteger(body.piece_frames, 'piece_frames', null);

        if (pieceFrames !== null && pieceFrames < 1) {
            invalid('piece_frames must be at least 1.');
        }

        /* **A piece as a length of time, converted at this video's own rate.** Isaac asked
           for five-minute pieces; a frame count cannot say that, because the footage is not
           all one rate -- CAMPA2026 runs at 24.946, and the screen had been offering 900
           frames, half a minute, as its default. The rate is the one the length above was
           worked out from, so a piece and the video it cuts agree. */
        if (body.piece_seconds !== undefined && body.piece_seconds !== null) {
            if (pieceFrames !== null) {
                invalid('Give piece_frames or piece_seconds, not both.');
            }

            const seconds = Number(body.piece_seconds);

            if (!Number.isFinite(seconds) || seconds <= 0) {
                invalid('piece_seconds must be a number of seconds greater than zero.');
            }

            if (!spec.video.jellyfin_item_id) {
                invalid(
                    'piece_seconds needs a frame rate, and MARP reads one only from a Jellyfin item. '
                    + 'Give piece_frames for a video given as a bare url.'
                );
            }

            pieceFrames = Math.max(1, Math.round(seconds * await this.frameRateForVideo(spec.video)));
        }

        // Optional, and null when absent. MARP does not compose a fallback: a
        // name it invented would be indistinguishable from one a person chose,
        // and the screens already know how to label a job that has none (#104,
        // gap 25).
        let name = null;

        if (body.name !== undefined && body.name !== null && String(body.name).trim() !== '') {
            name = requiredString(body.name, 'name');

            if (name.length > MAX_JOB_NAME_LENGTH) {
                invalid(`name must be ${MAX_JOB_NAME_LENGTH} characters or fewer.`);
            }
        }

        const ranges = this.splitRange(startFrame, endFrame, pieceFrames);
        const batchId = ranges.length > 1 ? crypto.randomUUID() : null;
        const createdBy = principal && principal.type === 'user' ? principal.id : null;

        /* **Created here, after everything that can refuse.** A session written before a
           bad range was caught would be an empty automated session on the annotation
           GUI's opening screen, left behind by a submission that never happened. Every
           400 above this line has already been raised.

           **One session for the whole batch.** `piece_frames` splits one video into
           several jobs; the person submitted one run, so they share it. */
        let runSession = null;

        if (makeRunSession) {
            runSession = await inferenceSessionService.createForRun({
                projectId: Number(spec.session.project_id),
                dive: String(spec.session.dive),
                line: String(spec.session.line),
                type: String(spec.session.type),
                createdBy,
            });

            spec = { ...spec, session: { session_id: runSession.session_id } };
        }

        // Every piece of a split carries the same name, because the name is what
        // the person submitted and they submitted one thing.
        const rows = ranges.map((range) => ({
            batch_id: batchId,
            name,
            kind,
            spec: { ...spec, range },
            state: 'queued',
            priority,
            attempts_made: 0,
            max_attempts: maxAttempts,
            published_attempt_id: null,
            created_by: createdBy,
            created_at: new Date(),
            updated_at: new Date(),
        }));

        const jobs = await gpuRepository.createJobs(rows);

        // Say what was worked out, when anything was. A person who queued a whole
        // video by naming it has no other way to see that MARP decided it is
        // 52,582 frames, and a derivation nobody can look at is the same trap as
        // a model registration with no bytes behind it (#198, #199).
        const derivedRange = {};

        if (range.start_frame === undefined || range.start_frame === null) {
            derivedRange.start_frame = startFrame;
        }

        if (range.end_frame === undefined || range.end_frame === null) {
            derivedRange.end_frame = endFrame;
        }

        const answer = { batch_id: batchId, jobs };

        if (Object.keys(derivedRange).length > 0) {
            answer.derived_range = { ...derivedRange, frames: endFrame - startFrame };
        }

        /* Reported for the same reason `derived_range` is: MARP worked something out on
           the submitter's behalf, and a derivation nobody can look at is how a wrong one
           survives. It also gives the screen the id to link to. */
        if (runSession) {
            answer.session = {
                session_id: runSession.session_id,
                type: runSession.type,
                dive: runSession.dive,
                line: runSession.line,
            };
        }

        return answer;
    }


    /**
     * Queue one training job over a packaged dataset.
     *
     * **One job, never a batch.** An inference job splits because a video is a
     * range and ten machines can each take a piece. A training run is not
     * divisible that way: splitting it would produce several models rather than
     * one, and combining them is a different piece of science nobody has asked
     * for. So there is no `piece_frames` here and no `batch_id`.
     *
     * The dataset is resolved the way video is resolved for an inference job
     * (A8): MARP looks it up and puts a locator plus a hash in the spec, and the
     * worker fetches what it is told to fetch without knowing what is serving
     * it. That is what lets the file server in #120 take over later without the
     * worker changing.
     *
     * @async
     * @param {Object} body - The submission body.
     * @param {Object} spec - `body.spec`, already known to be an object.
     * @param {Object|null} principal - Who submitted it.
     * @returns {Promise<Object>} `{batch_id: null, jobs}`.
     */
    async submitTrainingJob(body, spec, principal) {
        this.validateSubmittedModel(spec.model);

        const dataset = spec.dataset && typeof spec.dataset === 'object' && !Array.isArray(spec.dataset)
            ? spec.dataset
            : invalid('spec.dataset is required for a training job and must be an object.');

        const datasetId = requiredInteger(dataset.dataset_id, 'spec.dataset.dataset_id');

        /* The starting model has to be one MARP knows, because the run that comes
           out of it is recorded against it and `training_runs.model_id` is NOT
           NULL. Refused here, where it is one clear message, rather than at the
           first epoch -- there it would fail an event batch, and a failed event
           batch takes the whole running job down with it. */
        requiredInteger(
            spec.model && spec.model.ml_model_id,
            'spec.model.ml_model_id'
        );

        /* The archive is the whole point: a dataset row that describes images on
           somebody's laptop is not something a worker can train on, and saying so
           here is far better than a job that leases, fails to fetch, and retries
           twice before anybody looks. */
        const archive = await gpuRepository.getDatasetArchiveById(datasetId);

        if (!archive) {
            invalid(`No dataset ${datasetId}.`);
        }
        if (!archive.archive_path || !archive.archive_sha256) {
            invalid(
                `Dataset ${datasetId} ("${archive.name}") has not been packaged, so no worker can fetch it. `
                + 'Run scripts/package-dataset.js against its folder first.'
            );
        }

        if (spec.video || spec.range) {
            invalid('A training job carries a dataset, not a video and a range.');
        }

        const priority = optionalInteger(body.priority, 'priority', 0);
        const maxAttempts = optionalInteger(body.max_attempts, 'max_attempts', 3);

        if (maxAttempts < 1) {
            invalid('max_attempts must be at least 1.');
        }

        let name = null;

        if (body.name !== undefined && body.name !== null && String(body.name).trim() !== '') {
            name = requiredString(body.name, 'name');

            if (name.length > MAX_JOB_NAME_LENGTH) {
                invalid(`name must be ${MAX_JOB_NAME_LENGTH} characters or fewer.`);
            }
        }

        /* **An explicit name always wins, and blank counts as absent.** The form treats a
           cleared field as not answering rather than as answering with nothing, so the
           condition above is what decides -- a name is generated only where a person left
           it alone, and nothing here can overwrite what somebody typed.

           Training only. The same block in submitJob above is untouched: an inference job
           names a video, which the screens already fall back to, so there is nothing a
           generated name would add there. */

        /* Composed here rather than taken from the submitter. The locator is
           coordinator-relative, exactly as a model artifact's is, so a worker
           resolves it against whichever MARP it is enrolled with and a spec
           cannot name somewhere else. */
        const jobSpec = {
            ...spec,
            dataset: {
                dataset_id: datasetId,
                name: archive.name,
                url: `/api/v2/gpu/datasets/${datasetId}/archive`,
                sha256: String(archive.archive_sha256).toLowerCase(),
            },
        };

        /* Composed from `jobSpec` rather than from `spec`, because the dataset name is
           filled in up there from the archive row -- the submitter sends a dataset id and
           nothing else, so naming off the raw spec would produce a name with a hole in it. */
        if (name === null) name = composeTrainingJobName(jobSpec);

        const createdBy = principal && principal.type === 'user' ? principal.id : null;
        const jobs = await gpuRepository.createJobs([{
            batch_id: null,
            name,
            kind: 'training',
            spec: jobSpec,
            state: 'queued',
            priority,
            attempts_made: 0,
            max_attempts: maxAttempts,
            published_attempt_id: null,
            created_by: createdBy,
            created_at: new Date(),
            updated_at: new Date(),
        }]);

        return { batch_id: null, jobs };
    }

    /**
     * Cancel a job.
     *
     * @async
     * @param {number|string} jobId - Job identifier from the path.
     * @returns {Promise<Object>} `{job, changed}`.
     * @throws {ApiError} 404 when there is no such job.
     */
    async cancelJob(jobId) {
        const result = await gpuRepository.cancelJob(this.jobIdFromPath(jobId));

        if (!result) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `GPU job ${jobId} was not found.`);
        }

        return result;
    }


    /**
     * What clearing a state would take with it, counted and deleting nothing.
     *
     * **A GET, not a flag on the DELETE, and that is the whole point of it.** An unknown
     * query parameter is ignored rather than refused, so `DELETE ?state=failed&dryRun=true`
     * sent to a MARP that predates the flag is simply a delete -- 1,189 jobs gone, and the
     * caller holding an answer it thinks is a preview. A separate verb cannot be
     * misunderstood that way: a server without this route answers 404 and destroys nothing.
     *
     * The allow-list is checked first and identically, because answering for a state the
     * delete refuses would teach a caller the state is deletable.
     *
     * @async
     * @param {Object} [query] - `{state}`; defaults to `failed`.
     * @returns {Promise<Object>} `{state, jobs, attempts, events, blocked, observations, builds}`.
     * @throws {ApiError} 400 when the state is not one that can be cleared.
     */
    async deletableJobs(query = {}) {
        const state = query.state === undefined ? 'failed' : String(query.state);

        if (!DELETABLE_STATES.includes(state)) {
            invalid(`state must be ${DELETABLE_STATES.join(' or ')}, and was ${JSON.stringify(query.state)}.`);
        }

        return { state, ...await gpuRepository.previewDeleteJobsInState(state) };
    }

    /**
     * Delete every job in one state.
     *
     * **The allow-list has one entry and that is a decision, not a stub.** `failed` is
     * what was asked for: a list cluttered with work that did not finish. `cancelled`
     * is a bigger pile and nobody has asked, and the two are not interchangeable --
     * `observations.gpu_job_id` is SET NULL, so deleting a job that produced
     * observations leaves them in place with nothing to say where they came from. That
     * is provenance going quietly, and it should be somebody's decision rather than a
     * parameter a caller discovers it can pass.
     *
     * Jobs an artifact still references are not deleted and not treated as a failure:
     * the repository excludes them and names them, and the caller reports a partial
     * result as a partial result.
     *
     * @async
     * What this would take is answered by `deletableJobs`, which is a GET and therefore
     * cannot be mistaken for this.
     *
     * @param {Object} [query] - `{state}`; defaults to `failed`.
     * @returns {Promise<{state: string, deleted: number, blocked: number[]}>}
     * @throws {ApiError} 400 when the state is not one this will delete.
     */
    async deleteJobsInState(query = {}) {
        const state = query.state === undefined ? 'failed' : String(query.state);

        if (!DELETABLE_STATES.includes(state)) {
            invalid(`state must be ${DELETABLE_STATES.join(' or ')}, and was ${JSON.stringify(query.state)}.`);
        }

        const { deleted, blocked } = await gpuRepository.deleteJobsInState(state);

        return { state, deleted: deleted.length, blocked };
    }


    /**
     * Delete a selection of jobs, skipping the ones that are not safe.
     *
     * **No acknowledgement, deliberately.** A job holding observations comes back in
     * `blocked` and has to be deleted on its own, where its own count is shown. The
     * moment a selection could override that, one checkbox stands between somebody and
     * every observation's provenance.
     *
     * @async
     * @param {Object} [query] - `{ids}`, comma-separated or an array.
     * @returns {Promise<{deleted: number, blocked: Array<{id: number, reason: string}>}>}
     * @throws {ApiError} 400 when the selection is empty, malformed or too large.
     */
    async deleteJobsByIds(query = {}) {
        const MAX_SELECTION = 200;
        const raw = Array.isArray(query.ids) ? query.ids : String(query.ids ?? '').split(',');
        const ids = raw.map((value) => String(value).trim()).filter(Boolean).map(Number);

        if (!ids.length) invalid('ids must name at least one job.');

        if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
            invalid('ids must all be positive integers.');
        }

        if (ids.length > MAX_SELECTION) {
            invalid(`ids names ${ids.length} jobs; ${MAX_SELECTION} is the most one request will delete.`);
        }

        const { deleted, blocked } = await gpuRepository.deleteJobsByIds([...new Set(ids)]);

        return { deleted: deleted.length, blocked };
    }


    /**
     * Delete one job, whatever state it is in.
     *
     * **The guard is about observations, not about state.** `observations.gpu_job_id`
     * is `ON DELETE SET NULL`, so deleting a job that produced observations does not
     * refuse and does not cascade -- it removes the link from each observation back to
     * the run that made it, silently. Measured on this corpus: the succeeded jobs hold
     * 114,866 observations between them and every other state holds none. So a delete
     * that would unlink anything requires `acknowledgeObservations`, and the refusal
     * carries the real number for that job rather than a general warning.
     *
     * An artifact is a different matter and is a refusal outright: the foreign key is
     * RESTRICT, and deleting the artifact to make the job deletable would be destroying
     * the output to tidy the record of the work.
     *
     * @async
     * @param {string|number} jobId - From the path.
     * @param {Object} [options] - `{acknowledgeObservations}`.
     * @returns {Promise<{deleted: number, observationsUnlinked: number, attemptsRemoved: number}>}
     * @throws {ApiError} 404 when there is no such job, 409 when an artifact holds it or
     * when it would unlink observations and nobody has said so.
     */
    async deleteJob(jobId, options = {}) {
        const id = this.jobIdFromPath(jobId);
        const impact = await gpuRepository.jobDeletionImpact(id);

        if (!impact) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `GPU job ${jobId} was not found.`);
        }

        if (impact.artifacts > 0) {
            throw new ApiError(409, ERROR_CODES.CONFLICT,
                `GPU job ${id} cannot be deleted: ${impact.artifacts} artifact(s) reference it.`,
                [{ job_id: id, artifacts: impact.artifacts }]);
        }

        const acknowledged = options.acknowledgeObservations === true
            || String(options.acknowledgeObservations).toLowerCase() === 'true';

        if (impact.observations > 0 && !acknowledged) {
            throw new ApiError(409, ERROR_CODES.CONFLICT,
                `GPU job ${id} produced ${impact.observations} observations. Deleting it leaves them in `
                + 'place with no record of what produced them. Resend with acknowledgeObservations=true '
                + 'to delete it anyway.',
                /* **The number machine-readably, as well as in the sentence.** A client
                   that has to show "this unlinks 412 observations" before it can ask for
                   the flag would otherwise have to read the count back out of English,
                   and a reworded sentence would silently break it. */
                [{ job_id: id, observations: impact.observations, attempts: impact.attempts }]);
        }

        await gpuRepository.deleteJobById(id);

        return {
            deleted: id,
            observationsUnlinked: impact.observations,
            attemptsRemoved: impact.attempts,
        };
    }


    /**
     * Where a dataset's archive is on disk, for the route to stream.
     *
     * **Why a worker may read this at all.** The permission is `jobs:execute`, the
     * same one the worker already holds to poll and lease, because fetching the
     * dataset a job names is part of executing that job. `datasets:read` would be
     * the wrong instrument: it is the human-facing permission for browsing the
     * dataset catalogue, and granting it to every worker would widen what a
     * compromised worker token reaches, for no gain.
     *
     * The row is the authority for the hash, not the filename. The file is named
     * for its hash because content addressing makes re-packaging idempotent, but
     * what a worker verifies against is the value the job spec carried, which came
     * from this column.
     *
     * @async
     * @param {number|string} datasetId - `datasets.id` from the path.
     * @returns {Promise<Object>} `{absolutePath, sha256, bytes, name}`.
     * @throws {ApiError} 404 when the dataset, the archive record, or the file is absent.
     */
    async datasetArchive(datasetId) {
        const id = Number(datasetId);
        if (!Number.isInteger(id) || id <= 0) invalid('dataset id must be a positive integer.');

        const dataset = await gpuRepository.getDatasetArchiveById(id);
        if (!dataset) {
            throw new ApiError(404, ERROR_CODES.NOT_FOUND, `No dataset ${id}.`);
        }
        if (!dataset.archive_path) {
            throw new ApiError(404, ERROR_CODES.NOT_FOUND,
                `Dataset ${id} has not been packaged; run scripts/package-dataset.js.`);
        }

        /* Resolved against the configured dataset directory and then checked to still be
           inside it. `archive_path` is written by our own packaging script, but it is a
           database value, and a database value that becomes a filesystem path is exactly
           the shape of a traversal bug.

           The root is `DATASET_DIRECTORY`'s parent rather than the checkout's `storage/`,
           because the archives and the rows that name them are one unit and may not live
           beside this copy of the code -- a 404 here is a worker failing minutes into a
           job, far from the cause. */
        const storageRoot = path.resolve(DATASET_DIRECTORY, '..');
        const absolutePath = path.resolve(storageRoot, dataset.archive_path);
        if (!absolutePath.startsWith(storageRoot + path.sep)) {
            throw new ApiError(404, ERROR_CODES.NOT_FOUND, `Dataset ${id} archive path is not under storage.`);
        }
        if (!fs.existsSync(absolutePath)) {
            throw new ApiError(404, ERROR_CODES.NOT_FOUND,
                `Dataset ${id} is recorded as packaged but its archive is missing from storage.`);
        }

        return {
            absolutePath,
            sha256: dataset.archive_sha256,
            bytes: Number(dataset.archive_bytes || fs.statSync(absolutePath).size),
            name: dataset.name,
        };
    }


    /**
     * Ingest one job's observations on request.
     *
     * The recovery path for R14: automatic ingest runs when a result publishes,
     * and when it fails -- an unknown species name, a session type that does not
     * match the model -- the bytes are still held and the fix is to correct the
     * data and call this. Idempotent, so calling it on a job that already
     * ingested changes nothing and says so.
     *
     * @async
     * @param {number|string} jobId - Job identifier from the path.
     * @returns {Promise<Object>} What was written, and what it resolved to.
     * @throws {ApiError} 404 when there is no such job, 400 when it cannot be
     * ingested, 409 when its result cannot be reconciled.
     */
    async ingestJobObservations(jobId) {
        const id = this.jobIdFromPath(jobId);
        const detail = await gpuRepository.getJobDetail(id);

        if (!detail) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `GPU job ${jobId} was not found.`);
        }

        return observationIngestService.ingestJob({
            ...detail.job,
            artifacts: detail.artifacts,
        });
    }

    // -----------------------------------------------------------------
    // Shared validation
    // -----------------------------------------------------------------

    /**
     * Cut `[start, end)` into consecutive pieces of at most `pieceFrames`.
     *
     * **The range is half-open: `start_frame` is included and `end_frame` is one
     * past the last frame.** A piece length of 300 over `[0, 1000)` gives
     * `[0, 300)`, `[300, 600)`, `[600, 900)` and `[900, 1000)` -- the last piece
     * short rather than over-long.
     *
     * Half-open rather than inclusive because of what it costs at every site that
     * touches a bound. The frame count is `end - start` with no `+1`; tiling is
     * `[k*n, (k+1)*n)`, so the next piece's start *is* the previous piece's end
     * and there is no boundary arithmetic to get wrong; and an empty range is
     * expressible, which is what lets a submission of one be rejected rather than
     * queued. It also matches where the arithmetic actually happens: the worker is
     * Python, where `range()` and slicing are half-open natively.
     *
     * This is the contract with `marp-inference-worker`, not a presentation
     * choice -- a dashboard is free to say "frames 0-999".
     *
     * @param {number} start - First frame, included.
     * @param {number} end - One past the last frame, excluded.
     * @param {number|null} pieceFrames - Frames per piece, or null for one piece.
     * @returns {Array<Object>} `{start_frame, end_frame}` entries in order.
     */
    splitRange(start, end, pieceFrames) {
        if (pieceFrames === null) {
            return [{ start_frame: start, end_frame: end }];
        }

        const ranges = [];

        for (let from = start; from < end; from += pieceFrames) {
            ranges.push({
                start_frame: from,
                end_frame: Math.min(from + pieceFrames, end),
            });
        }

        return ranges;
    }

    /**
     * Validate the part of a submitted spec that says where its observations go.
     *
     * Checked here rather than only at ingest so that a malformed session or a
     * missing model is a 400 on the submission, not a surprise hours later when a
     * GPU has already done the work.
     *
     * **Optional, and deliberately so.** A run whose only purpose is a raw
     * detections artifact is legitimate, and a `training` or `diagnostic` job has
     * no observations at all. But a job that *does* say where its observations go
     * must also say which registered model made them: `observations.ml_model_id`
     * is on every ingested row, and the model's trained-species list is what
     * settles a common name that more than one species carries.
     *
     * @param {string} kind - The job kind being submitted.
     * @param {Object} spec - The submitted spec.
     * @returns {void}
     * @throws {ApiError} 400 when the session or the model is malformed, or when
     * a session is named without a model.
     */
    /**
     * Resolve `spec.session.per_run` into the descriptive form, if it is set.
     *
     * **One session per inference run**, by Isaac's decision on 2026-10-27, taken with
     * the cost stated: a dive scanned in six submissions becomes six sessions on the
     * annotation GUI's opening screen.
     *
     * **It does not touch a spec that did not ask.** The descriptive form
     * `{project_id, dive, line, type}` still means what it has always meant -- the ingest
     * finds an existing session for that dive and line before creating one, because a job
     * is one piece of a video and the same dive is submitted many times over. Two tests
     * hold that in place and this must not disturb them, so per-run is opt-in under its
     * own key.
     *
     * **`type` is derived from the model rather than asked for**, which is the other half
     * of the decision: a session's type chooses the species list its observations are read
     * against, and the model's species already say which that is. A submitter may still
     * name one, and a named type wins -- deriving over the top of it would be MARP
     * overruling somebody who said what they meant.
     *
     * Rewrites `spec.session` to the descriptive form so every check after this point,
     * including `assertEngineUnderstandsSessionType`, runs unchanged. Nothing is written
     * here; the session itself is created once nothing else can refuse.
     *
     * @async
     * @param {string} kind - The job kind.
     * @param {Object} spec - The submitted spec, modified in place when per-run is asked.
     * @returns {Promise<boolean>} True when a session must be created for this run.
     * @throws {ApiError} 400 when the per-run form is incomplete or has no single type.
     */
    async resolvePerRunSession(kind, spec) {
        const session = spec.session;

        if (!session || typeof session !== 'object' || Array.isArray(session) || !session.per_run) {
            return false;
        }

        if (!INGESTIBLE_JOB_KINDS.includes(kind)) {
            invalid(
                `spec.session.per_run asks for a session to write observations into, but a ${kind} `
                + `job produces none. Only ${INGESTIBLE_JOB_KINDS.join(' and ')} jobs write observations.`
            );
        }

        if (session.session_id !== undefined && session.session_id !== null) {
            invalid(
                'spec.session carries both session_id and per_run, which ask for opposite things: '
                + 'one names a session that exists, the other makes a new one. Send whichever you meant.'
            );
        }

        // `type` is the one of the four this form may leave out, because MARP can work it
        // out. The other three identify the dive and nothing here could know them.
        for (const field of ['project_id', 'dive', 'line']) {
            if (session[field] === undefined || session[field] === null || String(session[field]).trim() === '') {
                invalid(
                    `spec.session.${field} is required with per_run: it says which dive the run is of, `
                    + 'and MARP has no way to work that out. Only type may be left out, and it is '
                    + 'derived from the model.'
                );
            }
        }

        let type = typeof session.type === 'string' ? session.type.trim() : '';

        if (type === '') {
            const modelId = spec.model && spec.model.ml_model_id;

            if (!modelId) {
                invalid(
                    'spec.session.per_run leaves type to be derived from the model, so spec.model.'
                    + 'ml_model_id is required -- a model named only by name and hash is not in the '
                    + 'registry as far as this can tell. Name the model by id, or set spec.session.type.'
                );
            }

            const derived = await inferenceSessionService.sessionTypeForModel(modelId);

            if (derived.refusal) {
                invalid(derived.refusal);
            }

            type = derived.type;
        }

        // The descriptive form, which everything downstream already understands.
        spec.session = {
            project_id: session.project_id,
            dive: session.dive,
            line: session.line,
            type,
        };

        return true;
    }

    async validateSubmittedObservationTarget(kind, spec) {
        const session = observationIngestService.validateSpecSession(spec.session);

        if (!session) {
            return;
        }

        if (!INGESTIBLE_JOB_KINDS.includes(kind)) {
            invalid(
                `spec.session says where observations go, but a ${kind} job produces none. `
                + `Only ${INGESTIBLE_JOB_KINDS.join(' and ')} jobs write observations.`
            );
        }

        observationIngestService.validateSpecModel(spec.model);

        // A submitter who set `data_type` themselves means it, and it is theirs
        // to get right -- the same reasoning that keeps a bare `video.url` from
        // being second-guessed.
        if (this.submittedDataType(spec) !== null) {
            return;
        }

        // Checked here so a session the engine has no counting rule for is
        // refused before a GPU spends hours on it. The lease is where it is
        // resolved and where the authoritative refusal happens, because a
        // session's type can change between the two.
        observationIngestService.assertEngineUnderstandsSessionType(
            await observationIngestService.sessionTypeForSpec(session)
        );
    }

    /**
     * The `data_type` a submitter set for themselves, if any.
     *
     * @param {Object} spec - The spec, submitted or stored.
     * @returns {string|null} What they set, or null when they set nothing.
     */
    submittedDataType(spec) {
        const params = spec && typeof spec === 'object' ? spec.params : null;

        if (!params || typeof params !== 'object') {
            return null;
        }

        const value = params.data_type;

        return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    }

    /**
     * Validate the `model` half of a submitted spec.
     *
     * **A worker is never told where a file is on somebody's disk.** It is given
     * a locator it can fetch, and what sits behind that is the coordinator's
     * business -- a local file under `MODEL_STORAGE_ROOT` today, a file server
     * later, with nothing to change on the worker either time.
     *
     * This exists because every inference job MARP had ever completed carried
     * `C:/Users/.../weights/best.pt` in its spec. That runs on exactly one
     * computer, and nothing stopped such a job being handed to a second machine,
     * which then failed it four times with a `FileNotFoundError` and no
     * indication that the spec was the problem (#198). The path was not a
     * shortcut anybody chose: `GET /api/v2/model/:id/artifact` already existed and
     * already worked, and the registered model it serves simply had no bytes
     * behind it -- so the absolute path was the only thing that could work, and
     * with one machine nothing could tell the difference.
     *
     * Accepted: a coordinator-relative locator (`/api/v2/model/91/artifact`), or
     * an absolute `http`/`https` URL. Everything else is refused, including
     * `file://`, which is the same fault wearing a scheme.
     *
     * **`model` is required, for every engine without exception.** That was a
     * live question for a while: the `mock` engine performs no inference, so it
     * looked as though it should be allowed to run without weights, and the
     * worker was about to make `model` optional to let it. It turned out mock is
     * scaffolding from before a real engine existed -- its own `describe()` says
     * "contract and runner testing; performs no inference" -- and the answer is
     * that mock gets a stand-in model rather than that the contract gets a hole
     * in it. One rule with no exceptions beats a per-engine flag the coordinator
     * would have to be told about and could be told wrongly.
     *
     * A spec reaching a worker without a model is refused there anyway, after
     * queueing, leasing, and burning every attempt, with a pydantic traceback in
     * `failure_reason` as the only explanation. Refusing it here costs one
     * response and says what is missing.
     *
     * @param {Object} [model] - `spec.model` as supplied, if any.
     * @returns {void}
     * @throws {ApiError} 400 when the locator is not one a worker could fetch.
     */
    /**
     * Refuse a pretrained base model for inference.
     *
     * **Its classes are not MARP's.** A base model carries the upstream vocabulary --
     * ImageNet's thousand labels for a classifier -- and the ingest resolves whatever a
     * run reports against `species.comname`. Run one over video and the names it emits
     * are resolved against the species catalogue and written into observations, which
     * puts invented records into the scientific record.
     *
     * **Refused here rather than at ingest, because here it costs one response.** At
     * ingest it costs the GPU hours first, and the one check that would have caught it --
     * `checkSessionTypeAgainstModel` -- returns early for a model with no species, by a
     * deliberate decision that was correct while every registered model was a trained
     * detector. There is a backstop there too, but this is the gate that should fire.
     *
     * Only when the spec names a registered model: `ml_model_id` is optional on an
     * inference spec, and a spec that names no model by id cannot be checked against the
     * registry at all. Training is untouched -- starting from a base model is the whole
     * reason one is registered.
     *
     * @async
     * @param {Object} [model] - `spec.model` as supplied.
     * @returns {Promise<void>} Resolves when the model is one inference may use.
     * @throws {ApiError} 400 when it names a base model.
     */
    async refuseBaseModelForInference(model) {
        const modelId = model && model.ml_model_id;

        if (!modelId) {
            return;
        }

        const row = await ingestRepository.getModel(modelId);

        if (row && row.is_base) {
            invalid(
                `Model ${modelId} (${row.name}) is a pretrained base model and cannot be used for `
                + 'inference: its classes are the upstream vocabulary rather than MARP species, so its '
                + 'output would be resolved against the species catalogue and written into observations. '
                + 'Train from it first, and run inference with the model that comes out.'
            );
        }
    }

    validateSubmittedModel(model) {
        if (model === undefined || model === null) {
            invalid(
                'spec.model is required: every engine runs a model, and a worker refuses a spec without one. '
                + 'Name a registered model and its sha256.'
            );
        }

        if (typeof model !== 'object' || Array.isArray(model)) {
            invalid('spec.model must be an object.');
        }

        requiredString(model.name, 'spec.model.name');
        this.validateSha256(model.sha256, 'spec.model.sha256');

        if (model.url === undefined || model.url === null) {
            return;
        }

        const url = requiredString(model.url, 'spec.model.url');

        // A drive letter, a UNC path, or a backslash-rooted path. None of these
        // mean anything on another machine.
        const looksLikeAWindowsPath = /^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\');

        if (looksLikeAWindowsPath || url.toLowerCase().startsWith('file://')) {
            invalid(
                `spec.model.url must be something a worker on any machine can fetch, not a path on this one (${url}). `
                + 'Register the model and name it as /api/v2/model/<id>/artifact, or give an https URL. '
                + 'A worker is handed a locator and never learns where the file lives.'
            );
        }

        // A coordinator-relative locator. `//host/share` is not one of these --
        // it is a UNC path in disguise and a protocol-relative URL besides.
        if (url.startsWith('/')) {
            if (url.startsWith('//')) {
                invalid(`spec.model.url must not start with // (${url}). Use /api/v2/model/<id>/artifact.`);
            }

            return;
        }

        let parsed;

        try {
            parsed = new URL(url);
        } catch {
            invalid(
                `spec.model.url must be an absolute http(s) URL or a coordinator-relative path starting with / (${url}).`
            );
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            invalid(`spec.model.url must use http or https, not ${parsed.protocol} (${url}).`);
        }
    }

    /**
     * How many frames a video has, from the only thing that knows.
     *
     * `runtimeTicks / 10_000_000 * fps`, where fps is Jellyfin's
     * `RealFrameRate` for the video (#231). Jellyfin reports a duration in
     * 100-nanosecond ticks and a rate the stream actually delivers, and the two
     * combine into a frame count.
     *
     * This used to multiply by 25. The measurement that justified it -- 25.01 to
     * 25.05 across the ten videos MARP held observations for -- could only ever
     * see 25 fps footage, because the ingest refused anything else before it
     * reached the table. CAMPA2026 has video at 24.946.
     *
     * **Refused rather than guessed when the duration is unknown.** An item with
     * no `RunTimeTicks` coalesces to null, and deriving zero from it would fail
     * further down as `end_frame <= start_frame` -- a confusing message about an
     * empty range standing in for an honest one about a video whose length
     * nobody knows.
     *
     * A bare `video.url` has no duration to read, so a range stays required
     * there. That is a real limit rather than an oversight: MARP does not open
     * the file, and a URL it has never seen tells it nothing.
     *
     * @async
     * @param {Object} video - `spec.video` as submitted.
     * @returns {Promise<number>} Frames in the video, as an exclusive bound.
     * @throws {ApiError} 400 when the length cannot be established.
     */
    async frameCountForVideo(video) {
        if (!video.jellyfin_item_id) {
            invalid(
                'spec.range.end_frame is required for a video given as a bare url: MARP reads a length from a '
                + 'Jellyfin item and has no way to measure an arbitrary source. Give an end_frame, or submit the '
                + 'job with a jellyfin_item_id and let the range be worked out.'
            );
        }

        let item;

        try {
            item = await jellyfinRepository.getItem(video.jellyfin_item_id);
        } catch (error) {
            invalid(
                `spec.range.end_frame was not given and the video could not be read to work it out: ${error.message}`
            );
        }

        if (!item || !item.runtimeTicks) {
            invalid(
                `Jellyfin item ${video.jellyfin_item_id} reports no duration, so the frame count cannot be worked `
                + 'out. Give spec.range.end_frame explicitly.'
            );
        }

        const fps = await this.frameRateForVideo(video);
        const frames = Math.floor((Number(item.runtimeTicks) / TICKS_PER_SECOND) * fps);

        if (!Number.isSafeInteger(frames) || frames < 1) {
            invalid(
                `Jellyfin item ${video.jellyfin_item_id} reports a duration that works out to ${frames} frames, `
                + 'which cannot be right. Give spec.range.end_frame explicitly.'
            );
        }

        return frames;
    }

    /**
     * A Jellyfin video's frame rate, for sizing it and for cutting it into pieces.
     *
     * At the video's nominal rate (#231). A frame number is playback time times that
     * rate, so the last one is the duration times it -- whatever the average says about
     * gaps in the timestamps. 25 when no rate can be read, as before: a rate off by a
     * fraction only moves where a piece ends.
     *
     * @async
     * @param {Object} video - `spec.video`, carrying a `jellyfin_item_id`.
     * @returns {Promise<number>} Frames per second.
     */
    async frameRateForVideo(video) {
        try {
            const rates = await jellyfinRepository.getVideoFrameRate(video.jellyfin_item_id);

            if (rates && rates.realFrameRate) {
                return rates.realFrameRate;
            }
        } catch (error) {
            logger.info(
                `sizing ${video.jellyfin_item_id} at the assumed ${ASSUMED_FPS} fps: its frame rate could not be read: `
                + error.message
            );
        }

        return ASSUMED_FPS;
    }

    /**
     * Validate the `reduction` half of a submitted spec.
     *
     * The keyframe reduction rule applied to finished tracks. Required for the
     * same reason as the model: the worker's `JobSpec` has it as a required
     * field, so a spec without one is refused after being queued, leased and
     * retried rather than at the moment it could have been corrected.
     *
     * `version` is accepted as a number or a string. MARP's own published spec
     * documents it as an integer and the worker's registry keys on strings; the
     * worker normalises it at the boundary, and refusing one of the two spellings
     * here would make MARP disagree with its own documentation.
     *
     * @param {Object} [reduction] - `spec.reduction` as supplied.
     * @returns {void}
     * @throws {ApiError} 400 when it is missing or malformed.
     */
    validateSubmittedReduction(reduction) {
        if (reduction === undefined || reduction === null) {
            invalid(
                'spec.reduction is required: it names the keyframe rule applied to finished tracks, '
                + 'and a worker refuses a spec without one.'
            );
        }

        if (typeof reduction !== 'object' || Array.isArray(reduction)) {
            invalid('spec.reduction must be an object.');
        }

        requiredString(reduction.name, 'spec.reduction.name');

        if (reduction.version === undefined || reduction.version === null) {
            invalid('spec.reduction.version is required.');
        }

        if (typeof reduction.version !== 'string' && typeof reduction.version !== 'number') {
            invalid('spec.reduction.version must be a string or a number.');
        }
    }

    /**
     * Validate the `video` half of a submitted spec.
     *
     * **Exactly one of `jellyfin_item_id` and `url`.** A Jellyfin item is
     * resolved to a URL when the job is leased; a bare URL is any other reachable
     * source and is handed over as it stands. Both together is refused rather
     * than one silently winning -- a submitter who sent both means something by
     * each, and guessing which would be a coin toss over what actually gets
     * processed.
     *
     * `source_name` is what appears as `video_source` on every observation the
     * run produces. It cannot be guessed from a URL, so it is required with one
     * and optional with an item id, where the Jellyfin item supplies it.
     *
     * @param {Object} video - `spec.video` as supplied.
     * @returns {void}
     * @throws {ApiError} 400 when the video cannot be scheduled.
     */
    validateSubmittedVideo(video) {
        const hasItemId = video.jellyfin_item_id !== undefined && video.jellyfin_item_id !== null;
        const hasUrl = video.url !== undefined && video.url !== null;

        if (hasItemId && hasUrl) {
            invalid(
                'spec.video must carry exactly one of jellyfin_item_id or url, not both. '
                + 'An item id is resolved to a playable URL when the job is leased; a url is used as it stands.'
            );
        }

        if (!hasItemId && !hasUrl) {
            invalid('spec.video must carry either jellyfin_item_id or url.');
        }

        if (hasItemId) {
            requiredString(video.jellyfin_item_id, 'spec.video.jellyfin_item_id');
            return;
        }

        requiredString(video.url, 'spec.video.url');
        requiredString(
            video.source_name,
            'spec.video.source_name (required with a bare url, because it is what appears as video_source on every observation and cannot be guessed from a URL)'
        );
    }

    /**
     * Validate a sha256 as lower-case hex.
     *
     * Lower case only, and not normalised for the caller: two spellings of one
     * hash would each get their own staging row and defeat addressing by content,
     * so the one accepted spelling is the one the database's own check constraint
     * allows.
     *
     * @param {*} value - Value as supplied.
     * @param {string} field - Field name, for the message.
     * @returns {string} The hash.
     * @throws {ApiError} When it is not 64 lower-case hex characters.
     */
    validateSha256(value, field) {
        if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
            invalid(`${field} must be a sha256 as 64 lower-case hexadecimal characters.`);
        }

        return value;
    }

    /**
     * Validate a heartbeat's progress block.
     *
     * @param {*} progress - `{done, total, unit, phase, elapsed_s}` as supplied, or absent.
     * @returns {Object|undefined} The block, or undefined when absent.
     * @throws {ApiError} When any field is the wrong type.
     */
    validateProgress(progress) {
        if (progress === undefined || progress === null) {
            return undefined;
        }

        if (typeof progress !== 'object' || Array.isArray(progress)) {
            invalid('progress must be an object of {done, total, unit, phase, elapsed_s}.');
        }

        const validated = {};

        if (progress.done !== undefined && progress.done !== null) {
            validated.done = requiredInteger(progress.done, 'progress.done');
        }

        if (progress.total !== undefined && progress.total !== null) {
            validated.total = requiredInteger(progress.total, 'progress.total');
        }

        if (progress.unit !== undefined && progress.unit !== null) {
            validated.unit = requiredString(progress.unit, 'progress.unit');
        }

        if (progress.phase !== undefined && progress.phase !== null) {
            validated.phase = requiredString(progress.phase, 'progress.phase');
            if (validated.phase.length > MAX_PROGRESS_PHASE_LENGTH) {
                invalid(`progress.phase must be ${MAX_PROGRESS_PHASE_LENGTH} characters or fewer.`);
            }
        }

        if (progress.elapsed_s !== undefined && progress.elapsed_s !== null) {
            const elapsed = Number(progress.elapsed_s);
            if (!Number.isFinite(elapsed) || elapsed < 0) {
                invalid('progress.elapsed_s must be a non-negative finite number.');
            }
            validated.elapsed_s = elapsed;
        }

        return validated;
    }

    /**
     * Read an attempt id out of a path parameter.
     *
     * @param {number|string} value - As supplied.
     * @returns {number} The id.
     * @throws {ApiError} When it is not a positive integer.
     */
    attemptIdFromPath(value) {
        const id = Number(value);

        if (!Number.isInteger(id) || id < 1) {
            invalid('The attempt id in the path must be a positive integer.');
        }

        return id;
    }

    /**
     * Read a job id out of a path parameter.
     *
     * @param {number|string} value - As supplied.
     * @returns {number} The id.
     * @throws {ApiError} When it is not a positive integer.
     */
    jobIdFromPath(value) {
        const id = Number(value);

        if (!Number.isInteger(id) || id < 1) {
            invalid('The job id in the path must be a positive integer.');
        }

        return id;
    }

    /**
     * Which frames of a video have been processed, and which have not (#257).
     *
     * Answers "is this dive actually done?" from the record. Coverage comes from
     * what attempts reported covering, never from the ranges they were asked to
     * cover, and the extent comes from Jellyfin rather than from the largest
     * request anybody made -- a proxy that cannot notice the video is longer
     * than anyone thought has the same blind spot as the problem.
     *
     * **It reports what it does not know.** A video Jellyfin cannot size gets
     * covered intervals and `extent: null`, not a guess, because a gap list
     * measured against an unknown end is worse than no gap list.
     *
     * Read-only: nothing is requeued here. Deciding what is owed turns on what
     * `cancelled` means, which is a question for a human and is why this
     * milestone stops at reporting.
     *
     * @async
     * @param {Object} query - `jellyfin_item_id` or `source_name`, and an
     *   optional `session_id`.
     * @returns {Promise<Object>} The covered intervals, the gaps, and the extent.
     */
    async coverage(query = {}) {
        const jellyfinItemId = query.jellyfin_item_id ? String(query.jellyfin_item_id) : null;
        const sourceName = query.source_name ? String(query.source_name) : null;

        if (!jellyfinItemId && !sourceName) {
            invalid('Name the video: jellyfin_item_id or source_name.');
        }

        if (jellyfinItemId && sourceName) {
            invalid('Name the video once: jellyfin_item_id or source_name, not both.');
        }

        const sessionId = query.session_id === undefined || query.session_id === null || query.session_id === ''
            ? null
            : optionalInteger(query.session_id, 'session_id', null);

        const covered = await gpuRepository.coveredIntervals({ jellyfinItemId, sourceName, sessionId });

        // Only an item id can be sized: a bare url is somebody else's file and
        // Jellyfin has never heard of it.
        let extent = null;
        if (jellyfinItemId) {
            try {
                extent = await jellyfinRepository.getVideoExtent(jellyfinItemId, MEDIA_CLIENT_IDENTITY);
            } catch (error) {
                // Jellyfin being unreachable must not make the covered intervals
                // unavailable too -- they are the half that needs no network.
                extent = null;
            }
        }

        const totalFrames = extent && Number.isFinite(extent.frames) ? extent.frames : null;

        return {
            video: jellyfinItemId ? { jellyfin_item_id: jellyfinItemId } : { source_name: sourceName },
            session_id: sessionId,
            extent: extent === null ? null : {
                frames: extent.frames,
                duration_seconds: extent.durationSeconds,
                average_frame_rate: extent.averageFrameRate,
            },
            covered,
            gaps: totalFrames === null ? null : gapsWithin(covered, totalFrames),
            frames_covered: covered.reduce((sum, span) => sum + (span.end_frame - span.start_frame), 0),
            requested: covered.length === 0 && totalFrames === null
                ? 'nothing has been processed, and the video could not be sized'
                : undefined,
        };
    }

    /**
     * Queue the frames that interrupted work left owed (#257).
     *
     * **Only `interrupted`.** A `cancelled` job means a human changed their mind
     * and nothing is missing. A `failed` one has already been retried as far as
     * retrying is worth, and requeueing it on a schedule spends GPU time on
     * something that is probably broken rather than unlucky -- it stays visible
     * as `failed` and a human decides, which is what `jobIds` is for.
     *
     * The spec is copied from the interrupted job rather than invented: what is
     * owed is the rest of *that* work, with the same model, params and
     * reduction. Only the range differs.
     *
     * Requeueing twice queues nothing the second time, because the gaps are
     * recomputed from coverage each time and queued work is not coverage -- a
     * range already waiting in the queue is not owed again.
     *
     * @async
     * @param {Object} [body] - Narrowing. `jellyfin_item_id` or `source_name`
     *   for one video; omitted, every video with interrupted work.
     * @param {Object} [principal] - Who asked, recorded on the jobs created.
     * @returns {Promise<Object>} What was queued, per video.
     */
    async requeueInterrupted(body = {}, principal = null) {
        const jellyfinItemId = body.jellyfin_item_id ? String(body.jellyfin_item_id) : null;
        const sourceName = body.source_name ? String(body.source_name) : null;

        const owed = await gpuRepository.interruptedWork({ jellyfinItemId, sourceName });
        const videos = [];

        for (const work of owed) {
            const identity = work.item_id
                ? { jellyfin_item_id: work.item_id }
                : { source_name: work.source_name };

            const seen = await this.coverage({
                ...(work.item_id ? { jellyfin_item_id: work.item_id } : { source_name: work.source_name }),
                session_id: work.session_id,
            });

            // No extent means no gap list, and a requeue guessing where a video
            // ends would queue work over frames that do not exist.
            if (seen.gaps === null) {
                videos.push({ video: identity, session_id: work.session_id, queued: [], skipped: 'the video could not be sized' });
                continue;
            }

            // Take off what is already waiting. Coverage counts work that
            // finished, so a range sitting in the queue is not covered -- but
            // it is not owed either, because somebody has already asked for it.
            // Without this, calling twice piles a second copy of every gap onto
            // the pool, which a test caught rather than a reading of the code.
            const pending = await gpuRepository.pendingRanges({
                jellyfinItemId: work.item_id || null,
                sourceName: work.item_id ? null : work.source_name,
                sessionId: work.session_id,
            });

            const queued = [];

            for (const gap of subtractRanges(seen.gaps, pending)) {
                const submitted = await this.submitJobs({
                    kind: 'inference',
                    spec: {
                        ...work.spec,
                        range: { start_frame: gap.start_frame, end_frame: gap.end_frame },
                    },
                }, principal);

                queued.push(...submitted.jobs.map((job) => job.id));
            }

            videos.push({ video: identity, session_id: work.session_id, queued });
        }

        return {
            videos,
            jobs_queued: videos.reduce((sum, video) => sum + video.queued.length, 0),
        };
    }
}

/**
 * What is left of `spans` once `taken` is removed from them.
 *
 * Used to keep a requeue from asking for frames somebody has already asked for:
 * the gaps say what is unfinished, and this removes the part of that which is
 * already queued or leased.
 *
 * Both sides are half-open. A span may be cut into two when something is taken
 * out of its middle, which is why this builds a list rather than trimming ends.
 *
 * @param {Array<{start_frame: number, end_frame: number}>} spans - What is owed.
 * @param {Array<{start_frame: number, end_frame: number}>} taken - What is already asked for.
 * @returns {Array<{start_frame: number, end_frame: number}>} The remainder.
 */
function subtractRanges(spans, taken) {
    const result = [];

    for (const span of spans) {
        let pieces = [{ start_frame: span.start_frame, end_frame: span.end_frame }];

        for (const cut of taken) {
            const next = [];

            for (const piece of pieces) {
                // No overlap: the piece survives whole.
                if (cut.end_frame <= piece.start_frame || cut.start_frame >= piece.end_frame) {
                    next.push(piece);
                    continue;
                }

                if (cut.start_frame > piece.start_frame) {
                    next.push({ start_frame: piece.start_frame, end_frame: cut.start_frame });
                }

                if (cut.end_frame < piece.end_frame) {
                    next.push({ start_frame: cut.end_frame, end_frame: piece.end_frame });
                }
            }

            pieces = next;
        }

        result.push(...pieces.filter((piece) => piece.end_frame > piece.start_frame));
    }

    return result;
}

/**
 * The half-open intervals of `[0, totalFrames)` that `covered` does not include.
 *
 * `covered` is already merged and ascending, so this is one pass: the gap before
 * each interval, and whatever is left after the last one.
 *
 * @param {Array<{start_frame: number, end_frame: number}>} covered - Merged spans.
 * @param {number} totalFrames - The video's length in frames.
 * @returns {Array<{start_frame: number, end_frame: number}>} The gaps.
 */
function gapsWithin(covered, totalFrames) {
    const gaps = [];
    let cursor = 0;

    for (const span of covered) {
        if (span.start_frame > cursor) {
            gaps.push({ start_frame: cursor, end_frame: Math.min(span.start_frame, totalFrames) });
        }
        cursor = Math.max(cursor, span.end_frame);
    }

    // Everything past the furthest frame anybody reached. This is the one that
    // matters: a dive abandoned part-way shows up here and nowhere else.
    if (cursor < totalFrames) {
        gaps.push({ start_frame: cursor, end_frame: totalFrames });
    }

    return gaps.filter((gap) => gap.end_frame > gap.start_frame);
}

module.exports = new GpuService();
