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

const gpuRepository = require('../repository/gpu.repository');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const {
    HEARTBEAT_SECONDS,
    LEASE_SECONDS,
    POLL_MAX_WAIT_SECONDS,
    POLL_RETRY_INTERVAL_MS,
    MAX_EVENTS_PER_BATCH,
    ARTIFACT_PATH_PREFIX,
    JOB_KINDS,
    JOB_STATES,
    REPORTABLE_ATTEMPT_STATES,
    WORKER_EVENT_KINDS,
    RESULT_OUTCOMES,
} = require('../config/gpu-orchestration');

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
class GpuService {

    // -----------------------------------------------------------------
    // Worker-facing
    // -----------------------------------------------------------------

    /**
     * Enrol a machine into the pool.
     *
     * @async
     * @param {Object} body - `{name, capabilities, slot_count, worker_version}`.
     * @returns {Promise<Object>} `{worker_id, heartbeat_seconds, ...}`.
     * @throws {ApiError} 400 when the name is missing.
     */
    async enrolWorker(body) {
        const name = requiredString(body.name, 'name');

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
            name,
            capabilities: body.capabilities,
            slotCount,
            workerVersion: body.worker_version,
        });

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

        await gpuRepository.expireStaleLeases();

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
                return {
                    job_id: lease.job.id,
                    attempt_id: lease.attempt.id,
                    lease_epoch: lease.attempt.lease_epoch,
                    lease_expires_at: lease.attempt.lease_expires_at,
                    heartbeat_seconds: HEARTBEAT_SECONDS,
                    slot_index: lease.attempt.slot_index,
                    kind: lease.job.kind,
                    batch_id: lease.job.batch_id,
                    spec: lease.job.spec,
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

        const outcome = await gpuRepository.recordHeartbeat({
            attemptId: this.attemptIdFromPath(attemptId),
            workerId,
            leaseEpoch,
            state: body.state,
            progress,
        });

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

            return { seq, kind, at: event.at, payload: event.payload };
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

            if (!staged) {
                throw new ApiError(
                    409,
                    ERROR_CODES.CONFLICT,
                    `Artifact ${artifact.sha256} has not been handed over. Check and upload it before reporting a result that names it.`
                );
            }
        }

        return gpuRepository.publishResult({
            attemptId: this.attemptIdFromPath(attemptId),
            workerId,
            leaseEpoch,
            outcome,
            failureReason: body.failure_reason,
            artifacts: named,
        });
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

        if (staged) {
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
    async listPool() {
        // Sweeping here too, so the pool view does not show a machine as busy
        // with a job whose lease ran out an hour ago. A read that reports a state
        // the system has already abandoned is worse than a slightly slower read.
        await gpuRepository.expireStaleLeases();

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
                },
                job: {
                    job_id: row.job_id,
                    kind: row.job_kind,
                    state: row.job_state,
                    batch_id: row.job_batch_id,
                },
            });
        }

        return Array.from(workers.values());
    }

    /**
     * List jobs.
     *
     * @async
     * @param {Object} query - `{state, kind, batch_id, limit, offset}` as strings from the query string.
     * @returns {Promise<Object>} `{jobs, total, limit, offset}`.
     * @throws {ApiError} 400 for an unknown state or kind.
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

        filters.limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
        filters.offset = Math.max(Number(query.offset) || 0, 0);

        // Sweeping before a read, same reason as the pool view.
        await gpuRepository.expireStaleLeases();

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
     * @param {Object} body - `{kind, spec, priority, max_attempts, piece_frames}`.
     * @param {Object} [principal] - The authenticated caller, for `created_by`.
     * @returns {Promise<Object>} `{batch_id, jobs}`.
     * @throws {ApiError} 400 for a spec that cannot be scheduled.
     */
    async submitJobs(body, principal) {
        const kind = requiredEnum(body.kind, 'kind', JOB_KINDS);
        const spec = body.spec;

        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
            invalid('spec is required and must be an object.');
        }

        requiredString(spec.engine, 'spec.engine');

        if (!spec.video || typeof spec.video !== 'object') {
            invalid('spec.video is required and must be an object.');
        }

        requiredString(spec.video.jellyfin_item_id, 'spec.video.jellyfin_item_id');

        // The range is always present, even for a whole video, so nothing
        // downstream has to special-case the undivided case -- and the
        // coordinator cannot split a submission it was not given bounds for.
        // A whole video is [0, frame_count).
        if (!spec.range || typeof spec.range !== 'object') {
            invalid('spec.range is required and must be {start_frame, end_frame}, even for a whole video.');
        }

        const startFrame = requiredInteger(spec.range.start_frame, 'spec.range.start_frame');
        const endFrame = requiredInteger(spec.range.end_frame, 'spec.range.end_frame');

        if (startFrame < 0) {
            invalid('spec.range.start_frame must be zero or greater.');
        }

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

        const pieceFrames = optionalInteger(body.piece_frames, 'piece_frames', null);

        if (pieceFrames !== null && pieceFrames < 1) {
            invalid('piece_frames must be at least 1.');
        }

        const ranges = this.splitRange(startFrame, endFrame, pieceFrames);
        const batchId = ranges.length > 1 ? crypto.randomUUID() : null;
        const createdBy = principal && principal.type === 'user' ? principal.id : null;

        const rows = ranges.map((range) => ({
            batch_id: batchId,
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

        return { batch_id: batchId, jobs };
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
     * @param {*} progress - `{done, total, unit}` as supplied, or absent.
     * @returns {Object|undefined} The block, or undefined when absent.
     * @throws {ApiError} When any field is the wrong type.
     */
    validateProgress(progress) {
        if (progress === undefined || progress === null) {
            return undefined;
        }

        if (typeof progress !== 'object' || Array.isArray(progress)) {
            invalid('progress must be an object of {done, total, unit}.');
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
}

module.exports = new GpuService();
