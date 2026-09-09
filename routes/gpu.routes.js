/**
 * GPU orchestration routes, registered code-first through the OpenAPI route
 * registry.
 *
 * Twelve endpoints under `/api/v2/gpu`, declared here in V1 terms because
 * `registerVersionedRoute` rewrites both the path and the tag and refuses a
 * literal `/api/v2/` path. Five are worker-facing, five are human-facing, and
 * two are the artifact hand-off.
 *
 * **Every direction of travel is worker-to-MARP.** There is no route in this
 * file by which MARP contacts a worker, and no schema field anywhere that could
 * hold a worker's address. That is why cancel and pause are delivered as an
 * `action` in the heartbeat response rather than as a call MARP makes: control
 * has to travel back along a request the worker itself made, so a machine behind
 * a home router is reachable without anything being forwarded to it.
 *
 * Two things about bodies, both handled by {@link mountGpuBodyParsing} rather
 * than here. The family's JSON limit is raised above the API-wide 100 KB,
 * because an event batch carrying log lines goes past it. And the artifact upload
 * is mounted outside the body parsers entirely: it is a raw stream of possibly
 * gigabytes, and it must never depend on a parser's limit or be buffered in
 * memory.
 *
 * @fileoverview GPU orchestration routes and their OpenAPI documentation.
 * @author Isaac Travers
 * @module routes/gpu.routes
 */

'use strict';

const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const gpuController = require('../controller/gpu.controller');
const { asyncHandler, ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { registerVersionedRoute } = require('./lib/register-versioned-route');
const {
    ARTIFACT_DIRECTORY,
    JSON_BODY_LIMIT,
    MAX_ARTIFACT_BYTES,
    JOB_KINDS,
    JOB_STATES,
} = require('../config/gpu-orchestration');

/**
 * OpenAPI tag for every route in this file. Declared in V1 terms, like every
 * other route registered through `registerVersionedRoute`, which rewrites it to
 * `V2 · GpuCompute` -- the group `docs/openapi.js` describes.
 *
 * @constant
 * @type {string}
 */
const GPU_TAG = 'V1 · GpuCompute';

/**
 * Where the whole family is mounted, in V2 terms. Used to raise the JSON body
 * limit for these routes and nothing else.
 *
 * @constant
 * @type {string}
 */
const GPU_API_MOUNT = '/api/v2/gpu';

/**
 * Where the raw artifact upload is mounted, in V2 terms. Its own prefix rather
 * than a path under `/artifacts`, so that "everything below here is a raw
 * stream" can be said in one mount -- `/artifacts/check` beside it is ordinary
 * JSON and must keep being parsed.
 *
 * @constant
 * @type {string}
 */
const GPU_ARTIFACT_UPLOAD_MOUNT = '/api/v2/gpu/artifacts/upload';

/**
 * Claim a request's body before any parser can take it.
 *
 * `req._body` is the flag body-parser checks to decide whether a body has
 * already been handled, and setting it makes every parser downstream skip this
 * request whatever `Content-Type` it carries. Without it, an upload that
 * happened to be labelled `application/json` would be buffered whole into
 * memory and rejected against a body limit -- for a multi-gigabyte set of
 * weights, twice wrong.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next callback.
 * @returns {void}
 */
function claimRawUploadBody(req, res, next) {
    req._body = true;
    next();
}

/**
 * Mount the body handling this family needs.
 *
 * **Must be called before the API-wide `bodyParser.json()`**, because Express
 * runs middleware in registration order and the first parser to touch a request
 * is the one whose limit applies. Both mounts are path-scoped, so no other route
 * in the API changes.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function mountGpuBodyParsing(app) {
    // Before the parsers, so nothing ever tries to read the upload as a body.
    app.use(GPU_ARTIFACT_UPLOAD_MOUNT, claimRawUploadBody);

    // The raised limit, for this family only.
    app.use(GPU_API_MOUNT, bodyParser.json({ limit: JSON_BODY_LIMIT }));
}

/**
 * Receive a raw artifact upload, hashing it as it lands.
 *
 * The hash is computed over what actually arrived rather than trusted from the
 * request, so a truncated or corrupted transfer is caught here instead of
 * becoming a recorded result that cannot be opened. Nothing is kept unless the
 * hash matches the one in the path.
 *
 * @async
 * @param {Object} req - Express request, still an unread stream.
 * @param {string} expectedSha256 - The hash the caller says these bytes have.
 * @returns {Promise<{bytes: number}>} How many bytes were stored.
 * @throws {ApiError} 400 when the bytes do not hash to `expectedSha256`, or 413
 * when they exceed the artifact size limit.
 */
async function receiveArtifact(req, expectedSha256) {
    fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });

    const finalPath = path.join(ARTIFACT_DIRECTORY, expectedSha256);

    // A distinct temporary name per upload, so two workers handing over the same
    // artifact at once cannot write over each other's half-written file.
    const temporaryPath = `${finalPath}.${crypto.randomBytes(8).toString('hex')}.part`;

    const hash = crypto.createHash('sha256');
    let bytes = 0;

    const measure = new Transform({
        transform(chunk, encoding, callback) {
            bytes += chunk.length;

            if (bytes > MAX_ARTIFACT_BYTES) {
                callback(new ApiError(
                    413,
                    ERROR_CODES.VALIDATION_ERROR,
                    `An artifact must be ${MAX_ARTIFACT_BYTES} bytes or smaller.`
                ));
                return;
            }

            hash.update(chunk);
            callback(null, chunk);
        },
    });

    try {
        await pipeline(req, measure, fs.createWriteStream(temporaryPath));
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
    }

    const actual = hash.digest('hex');

    if (actual !== expectedSha256) {
        fs.rmSync(temporaryPath, { force: true });

        throw new ApiError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            `The bytes received hash to ${actual}, not ${expectedSha256}. Nothing was kept.`
        );
    }

    // A file already there has the same hash, so it has the same contents: the
    // upload was a retry or a second worker handing over the same artifact.
    // Discarding the new copy rather than renaming over it also sidesteps
    // Windows refusing a rename onto an existing file.
    if (fs.existsSync(finalPath)) {
        fs.rmSync(temporaryPath, { force: true });
    } else {
        fs.renameSync(temporaryPath, finalPath);
    }

    return { bytes };
}

/**
 * Register every `/api/gpu` route and its OpenAPI operation on `app`.
 *
 * @param {Object} app - Express application instance.
 * @returns {void}
 */
function registerGpuRoutes(app) {
    // ---------------------------------------------------------------
    // Worker-facing: enrol, poll, heartbeat, events, result
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'workers:enrol',
        path: '/api/gpu/workers/enrol',
        summary: 'Enrol a GPU machine into the compute pool',
        description:
            'Registers a GPU machine and returns the identity it quotes on every later call, plus the heartbeat interval MARP expects. Enrolling twice under one name updates that machine rather than adding a second, so a worker that restarts is the same row and the pool view does not fill with ghosts -- which also means `enrolled_at` means "first seen". Re-enrolling puts the machine back to `online`, since a machine that is talking is by definition not offline, and a deliberate `paused` is not preserved: re-enrolling is how an operator restarts a worker they had parked. Held by a bootstrap credential with only `workers:enrol`, deliberately separate from `jobs:execute`, so a credential that can join the pool cannot also take work.',
        tags: [GPU_TAG],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuWorkerEnrolRequest' } } },
        },
        responses: {
            200: {
                description: 'The machine is enrolled.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuWorkerEnrolResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.enrolWorker(req.body || {});
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:execute',
        path: '/api/gpu/poll',
        summary: 'Poll for work, and lease it in the same transaction',
        description:
            'Asks for a job and takes the lease on it in one step. There is no separate claim call, and no window in which a job has been chosen but not yet leased: the row is locked with `FOR UPDATE SKIP LOCKED` inside this request\'s transaction, so two machines polling at the same instant either take different jobs or one is told there is none -- they cannot lease the same one. Answers `204` when there is nothing to do, so a worker distinguishes "no work" from "work" by status rather than by inspecting a body. `wait_seconds` holds the request open until work appears, capped by the coordinator. Every poll first takes back any lease that has run out, judged on the coordinator\'s clock, which is what turns a machine that vanished into work somebody else can pick up. A machine is never given more concurrent work than the `slot_count` it enrolled with, and a paused machine is given none -- both answer `204` at once rather than waiting out `wait_seconds`, since nothing appearing in the queue would change either answer.',
        tags: [GPU_TAG],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuPollRequest' } } },
        },
        responses: {
            200: {
                description: 'A job, and the lease on it.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuLease' } } },
            },
            204: { description: 'There is no work for this machine. No body.' },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const lease = await gpuController.pollForWork(req.body || {});

            // 204 rather than 200 with a null body: a long-poll that timed out
            // is a normal answer, and a worker should not have to parse one.
            if (!lease) {
                res.status(204).end();
                return;
            }

            res.json(lease);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:execute',
        path: '/api/gpu/attempts/:id/heartbeat',
        summary: 'Report progress and receive the one control instruction MARP has',
        description:
            'Extends the lease, overwrites the attempt\'s progress in place, and answers with what to do next. **This is the only channel by which MARP tells a worker anything**, so `cancel`, `pause` and `abandon` are delivered here and nowhere else. `abandon` means the lease quoted is not the live one -- another machine holds the job, or it was taken back and reassigned -- and nothing was written; stop and discard the work. A worker may report `preparing`, `running` or `uploading`; it may not report a terminal state, because the coordinator\'s row is the truth about a job and what a finished attempt means is decided by the result route. Every deadline here is judged on the coordinator\'s clock, including the per-attempt cap that ends an attempt which heartbeats faithfully forever while making no progress.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'Attempt the worker believes it holds.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuHeartbeatRequest' } } },
        },
        responses: {
            200: {
                description: 'The heartbeat was recorded, or refused with `abandon`. Both are 200: a refusal is an instruction, not a transport failure.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuHeartbeatResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.heartbeat(req.params.id, req.body || {});
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/gpu/attempts/:id/events',
        summary: 'Append a batch of metrics and log lines',
        description:
            'Records durable numbers and log lines against an attempt. Keyed `(attempt_id, seq)`, so a worker that resends a batch it never saw the answer to inserts nothing the second time and is told how many were duplicates -- which is the expected answer to a replay rather than an error. Per-frame detections never come through here; they are handed over as a hashed artifact, because a stream of events is the wrong shape for hundreds of megabytes. `note` is not an accepted kind: it is the coordinator\'s own, used for recording why a lease was taken away, and a worker able to write one could muddy that record.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'Attempt the events belong to.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuEventsRequest' } } },
        },
        responses: {
            200: {
                description: 'How many events were new, how many were already held, and the sequence number to use next.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuEventsResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.recordEvents(req.params.id, req.body || {});
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/gpu/attempts/:id/result',
        summary: 'Report an attempt\'s terminal outcome',
        description:
            'Records what happened and lets the coordinator decide what it means for the job: a success publishes, a failure with attempts left requeues the job rather than failing it, and a failure with none left ends it. Idempotent -- replaying the report is answered from the stored rows rather than reapplied, so a worker retrying through a network timeout cannot produce two results. The publish is guarded: `published_attempt_id` is set once and never overwritten, so an attempt reporting success after another already published records its own success and leaves the job\'s result alone. That is what stops a slow machine, whose job was reassigned and finished elsewhere, from replacing a result somebody has already looked at. Every artifact named must already have been handed over, or the report is refused with 409 rather than recorded as pointing at bytes MARP does not hold.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'Attempt reporting its outcome.' },
        ],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuResultRequest' } } },
        },
        responses: {
            200: {
                description: 'The ack. Safe to receive more than once, and says whether this attempt is the one that published.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuResultResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            409: { $ref: '#/components/responses/ConflictError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.recordResult(req.params.id, req.body || {});
            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // Artifact hand-off: check, then stream
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/gpu/artifacts/check',
        summary: 'Ask whether MARP already holds an artifact, by hash',
        description:
            'The first half of the hand-off. Answers `already_have: true` when MARP holds those bytes, which lets a worker retrying after an interrupted transfer skip re-sending hundreds of megabytes, and answers with somewhere to put them when it does not. Addressing by content is what makes the hand-off idempotent: the same bytes are the same artifact however many times they are offered. The upload target is a plain path rather than a signed one -- the upload route is gated on the same permission this call needed and verifies the bytes against the hash before keeping them, so a signature would be a second and weaker credential for the same thing.',
        tags: [GPU_TAG],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuArtifactCheckRequest' } } },
        },
        responses: {
            200: {
                description: 'Either that the bytes are already held, or where to stream them.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuArtifactCheckResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.checkArtifact(req.body || {});
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/gpu/artifacts/upload/:sha256',
        summary: 'Stream an artifact\'s bytes to MARP',
        description:
            'The second half of the hand-off: the bytes themselves, as a raw request body rather than a form or a JSON field. **Mounted outside the body parsers**, so a multi-gigabyte transfer is never buffered in memory and never subject to a body limit; send them with any content type and MARP will record whatever was declared. The hash is computed over what actually arrives and compared with the one in the path, so a truncated or corrupted transfer is refused here rather than becoming a recorded result that cannot be opened -- and nothing is kept when it does not match. Re-uploading something already held is not an error: the bytes are the same bytes, so the second copy is discarded and the answer is the same. The file lands under the API\'s storage directory, not in the database.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'path', name: 'sha256', required: true, schema: { type: 'string' }, description: 'The sha256 the bytes are expected to hash to: 64 lower-case hexadecimal characters.' },
            { in: 'query', name: 'attempt_id', required: false, schema: { type: 'integer' }, description: 'The attempt handing this over, recorded as provenance. Optional, because the bytes stay addressable by hash whether or not the attempt is known.' },
            { in: 'header', name: 'Content-Type', required: false, schema: { type: 'string' }, description: 'Recorded as declared, and returned with the artifact later. `application/octet-stream` when there is nothing better to say.' },
        ],
        requestBody: {
            required: true,
            description: 'The raw bytes.',
            content: {
                'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
        },
        responses: {
            200: {
                description: 'The bytes arrived and their hash matched.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuArtifactUploadResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            413: {
                description: 'The bytes exceeded the artifact size limit. Nothing was kept.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const sha256 = String(req.params.sha256 || '');

            // Checked before a single byte is read: streaming gigabytes to disk
            // and only then noticing the target hash is malformed would be a
            // waste of the transfer and of the disk.
            if (!/^[0-9a-f]{64}$/.test(sha256)) {
                throw new ApiError(
                    400,
                    ERROR_CODES.VALIDATION_ERROR,
                    'The sha256 in the path must be 64 lower-case hexadecimal characters.'
                );
            }

            const attemptId = req.query.attempt_id === undefined ? undefined : Number(req.query.attempt_id);

            if (attemptId !== undefined && !Number.isInteger(attemptId)) {
                throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'attempt_id must be an integer.');
            }

            const { bytes } = await receiveArtifact(req, sha256);

            const data = await gpuController.stageArtifact({
                sha256,
                bytes,
                contentType: req.get('content-type') || null,
                attemptId,
            });

            res.json(data);
        }),
    });

    // ---------------------------------------------------------------
    // Human-facing: the pool, the jobs, submit, cancel
    // ---------------------------------------------------------------

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'jobs:read',
        path: '/api/gpu/workers',
        summary: 'Fetch the compute pool',
        description:
            'Returns every enrolled machine, what it says its hardware is, and what it is running right now. `activity` is derived rather than stored, so it cannot fall out of step with the attempts table: a machine is busy exactly while it holds a live attempt. Any lease that has run out is taken back before the pool is read, so this never reports a machine as busy with a job whose lease expired an hour ago -- a read that reports a state the system has already abandoned is worse than a slightly slower read. Nothing here carries an address, because nothing in the schema can.',
        tags: [GPU_TAG],
        responses: {
            200: {
                description: 'The pool, one entry per machine.',
                content: {
                    'application/json': {
                        schema: { type: 'array', items: { $ref: '#/components/schemas/GpuPoolWorker' } },
                    },
                },
            },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.listPool();
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'jobs:read',
        path: '/api/gpu/jobs',
        summary: 'List GPU jobs',
        description:
            'Returns a page of jobs, newest first, with how many matched in total. Ordered by `created_at` then `id`: the id tie-breaker is not decoration, since a batch\'s pieces are inserted in one statement and share a timestamp to the microsecond, and without it two pages of the same list could show one piece twice and miss another. Filter by `batch_id` to see the pieces of one split video together. Expired leases are taken back before the list is read, for the same reason as the pool view.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'query', name: 'state', required: false, schema: { type: 'string', enum: JOB_STATES }, description: 'Only jobs in this state.' },
            { in: 'query', name: 'kind', required: false, schema: { type: 'string', enum: JOB_KINDS }, description: 'Only jobs of this kind.' },
            { in: 'query', name: 'batch_id', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Only the pieces of this batch.' },
            { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 50, maximum: 500 }, description: 'Page size. Defaults to 50, capped at 500.' },
            { in: 'query', name: 'offset', required: false, schema: { type: 'integer', default: 0 }, description: 'Rows to skip.' },
        ],
        responses: {
            200: {
                description: 'The page of jobs.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuJobList' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.listJobs(req.query || {});
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'get',
        permission: 'jobs:read',
        path: '/api/gpu/jobs/:id',
        summary: 'Fetch one job with its attempts and artifacts',
        description:
            'Returns the job, every attempt at it in lease-epoch order so the history reads forwards, and every artifact it produced. A job attempted three times has three attempt rows, each recording which machine held it, how far it got and why it ended -- a job and one machine\'s attempt at it are deliberately separate records, so a retry does not overwrite the account of what went wrong the first time.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the job to fetch.' },
        ],
        responses: {
            200: {
                description: 'The job, its attempts, and its artifacts.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuJobDetail' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.getJob(req.params.id);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/gpu/jobs',
        summary: 'Queue GPU work, splitting a long video if asked',
        description:
            'Creates one job, or -- given `piece_frames` -- a batch of jobs sharing a `batch_id`, each covering its own piece of the frame range. N independent jobs rather than one job with children, so each piece leases, retries and fails on its own, which is what lets ten machines share a ten-hour video without any of them knowing about the others. The range is half-open -- `start_frame` is included, `end_frame` is one past the last frame -- so the pieces tile it exactly: the `end_frame` of one piece is the `start_frame` of the next, the frames covered are `end_frame - start_frame` with no off-by-one, and no frame is processed twice or missed. The last piece is short rather than over-long. An empty range is refused rather than queued. A range is required even for a whole video, so nothing downstream has to special-case the undivided case. The whole batch is inserted in one transaction: half a batch is worse than none, because somebody would have to work out which pieces were missing before resubmitting.',
        tags: [GPU_TAG],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuJobSubmitRequest' } } },
        },
        responses: {
            200: {
                description: 'The jobs created, and the batch they share if there is one.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuJobSubmitResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.submitJobs(req.body || {}, req.principal);
            res.json(data);
        }),
    });

    registerVersionedRoute(app, {
        method: 'post',
        permission: 'jobs:write',
        path: '/api/gpu/jobs/:id/cancel',
        summary: 'Cancel a GPU job',
        description:
            'Marks the job cancelled at once. A machine running it finds out at its next heartbeat -- the only channel MARP has for telling it anything -- and then reports a terminal result of its own, so "cancelled" here means the coordinator has stopped wanting the work rather than that the machine has already stopped doing it. The lease is still extended while it winds down, so a worker reporting back is not declared expired mid-shutdown. Cancelling a job that has already finished is not an error and changes nothing; the answer says so with `changed: false`.',
        tags: [GPU_TAG],
        parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'integer' }, description: 'ID of the job to cancel.' },
        ],
        responses: {
            200: {
                description: 'The job as it now stands, and whether this call changed it.',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GpuJobCancelResponse' } } },
            },
            400: { $ref: '#/components/responses/BadRequestError' },
            404: { $ref: '#/components/responses/NotFoundError' },
            500: { $ref: '#/components/responses/InternalServerError' },
        },
        handler: asyncHandler(async (req, res) => {
            const data = await gpuController.cancelJob(req.params.id);
            res.json(data);
        }),
    });
}

module.exports = registerGpuRoutes;
module.exports.mountGpuBodyParsing = mountGpuBodyParsing;
module.exports.GPU_API_MOUNT = GPU_API_MOUNT;
module.exports.GPU_ARTIFACT_UPLOAD_MOUNT = GPU_ARTIFACT_UPLOAD_MOUNT;
