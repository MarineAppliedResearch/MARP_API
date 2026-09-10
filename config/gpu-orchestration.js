/**
 * The numbers and vocabularies the GPU orchestration layer is built on.
 *
 * Gathered in one file because they are the parts most likely to be tuned, and
 * because a timeout written into three places drifts. The routes, the service and
 * the repository all read them from here.
 *
 * The migrations deliberately do **not** read them. A migration is a record of
 * what was done to a database on a particular day and has to keep saying the same
 * thing forever, so its check constraints spell their vocabularies out. If a
 * vocabulary changes here, the constraint has to change in a new migration too --
 * and the mismatch will show up as a database error rather than as silence.
 *
 * @fileoverview Timeouts, limits and state vocabularies for GPU orchestration.
 * @author Isaac Travers
 * @module config/gpu-orchestration
 */

'use strict';

const path = require('path');

/**
 * How often a worker is told to heartbeat, in seconds. Returned to the worker at
 * enrolment so the interval is the coordinator's to change, not each machine's.
 *
 * @constant
 * @type {number}
 */
const HEARTBEAT_SECONDS = 10;

/**
 * How long a lease lasts without a heartbeat, in seconds.
 *
 * Six missed heartbeats rather than one: a worker on a home connection will lose
 * a beat now and then, and taking its job away for that is worse than waiting.
 *
 * @constant
 * @type {number}
 */
const LEASE_SECONDS = 60;

/**
 * The longest one attempt may run before the coordinator takes the lease back,
 * in seconds. A worker that heartbeats faithfully forever while making no
 * progress is otherwise indistinguishable from one that is working.
 *
 * @constant
 * @type {number}
 */
const ATTEMPT_CAP_SECONDS = 24 * 60 * 60;

/**
 * Ceiling on a poll's `wait_seconds`, in seconds. A worker asking to wait longer
 * is held for this instead, so one request cannot occupy a connection
 * indefinitely.
 *
 * @constant
 * @type {number}
 */
const POLL_MAX_WAIT_SECONDS = 60;

/**
 * How often a waiting poll looks again, in milliseconds.
 *
 * Repeated looking rather than `LISTEN`/`NOTIFY`: a job appears every few
 * minutes at most, half a second of latency on picking it up is irrelevant next
 * to a job that runs for an hour, and this needs no second channel between the
 * API and Postgres to go wrong.
 *
 * @constant
 * @type {number}
 */
const POLL_RETRY_INTERVAL_MS = 500;

/**
 * Body limit for the GPU route family.
 *
 * The API-wide default is body-parser's own 100 KB, which is generous for a
 * survey record and too small here: a batch of events carrying log lines, or a
 * job submission whose spec names a model and a reduction, both go past it. This
 * is raised for this family only rather than globally -- every other route is
 * still held to 100 KB.
 *
 * Large hand-offs do not come through here at all. They stream to the upload
 * route, which is mounted before any body parser.
 *
 * @constant
 * @type {string}
 */
const JSON_BODY_LIMIT = '2mb';

/**
 * Longest name a worker may be given, matching `gpu_workers.name`. Checked in
 * the service so an over-long name is a 400 rather than a database error
 * surfacing as a 500.
 *
 * @constant
 * @type {number}
 */
const MAX_WORKER_NAME_LENGTH = 255;

/**
 * Longest durable id a worker may enrol with, matching `gpu_workers.local_id`.
 * A uuid is 36 characters; the room above that is for a worker that identifies
 * itself some other way.
 *
 * @constant
 * @type {number}
 */
const MAX_WORKER_LOCAL_ID_LENGTH = 128;

/**
 * Most events one batch may carry. A worker with more than this to say sends two
 * batches; `(attempt_id, seq)` makes that free.
 *
 * @constant
 * @type {number}
 */
const MAX_EVENTS_PER_BATCH = 500;

/**
 * Largest artifact one upload may carry, in bytes. Weights are hundreds of
 * megabytes and a long video's detections can be larger; this is a bound against
 * a mistake filling the disk rather than a statement about what is normal.
 *
 * @constant
 * @type {number}
 */
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Directory the staged artifact bytes live in.
 *
 * On disk rather than in the database, the same arrangement as species pictures.
 * `storage/` is git-ignored, so nothing here becomes a repository file.
 *
 * @constant
 * @type {string}
 */
const ARTIFACT_DIRECTORY = path.join(__dirname, '..', 'storage', 'gpu-artifacts');

/**
 * What `artifacts.path` says for a staged artifact: this prefix and the hash,
 * relative to `storage/`. Relative, so nothing recorded depends on where the API
 * is deployed.
 *
 * @constant
 * @type {string}
 */
const ARTIFACT_PATH_PREFIX = 'gpu-artifacts';

/**
 * How MARP identifies itself to Jellyfin when it resolves a video for a lease.
 *
 * A constant rather than something read off the poll request: the coordinator is
 * the Jellyfin client here, not the worker. The worker never speaks to Jellyfin
 * and holds no media credential -- it is handed a URL it can open -- so
 * attributing the Jellyfin session to a machine that made no Jellyfin request
 * would make Jellyfin's own session view wrong.
 *
 * @constant
 * @type {Object}
 */
const MEDIA_CLIENT_IDENTITY = { name: 'MARP GPU coordinator' };

/**
 * Worker lifecycle states.
 *
 * @constant
 * @type {Array<string>}
 */
const WORKER_STATES = ['online', 'offline', 'paused'];

/**
 * What a job can be.
 *
 * @constant
 * @type {Array<string>}
 */
const JOB_KINDS = ['inference', 'tracking', 'training', 'diagnostic'];

/**
 * Job states.
 *
 * @constant
 * @type {Array<string>}
 */
const JOB_STATES = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired'];

/**
 * Job kinds whose results become observations in the annotation record.
 *
 * A `training` job produces weights and a `diagnostic` job produces a number;
 * neither has a session to write into, so neither is ingested.
 *
 * @constant
 * @type {Array<string>}
 */
const INGESTIBLE_JOB_KINDS = ['inference', 'tracking'];

/**
 * Survey conventions the worker's `pick_observation_time` actually branches on.
 *
 * It is `params.data_type` that decides **which frame of a track an observation
 * is recorded at**, and the two rules are survey conventions rather than
 * geometry: a fish is counted when its centre crosses near the bottom of frame,
 * an invertebrate when it enters the bottom-centre trapezoid. So this is not a
 * tuning parameter, it is which discipline's counting rule applies.
 *
 * **A value outside this list fails silently and badly.**
 * `pick_observation_time` matches `("Fish", "GULF_Fish")` or
 * `("Invert", "GULF_Inverts")` and returns nothing otherwise, at which point
 * `build_observation` falls back to the track's first frame -- a third
 * convention nobody chose, with no error anywhere. Hence the list is checked
 * here, before a job is queued, rather than trusted.
 *
 * These are `sessions.type` values, deliberately: the mapping is the identity,
 * which is presumably why nobody noticed the parameter was being defaulted.
 *
 * @constant
 * @type {Array<string>}
 */
const ENGINE_DATA_TYPES = ['Fish', 'GULF_Fish', 'Invert', 'GULF_Inverts'];



/**
 * Job states that cannot change again. A cancel or a claim against one of these
 * is refused rather than applied.
 *
 * @constant
 * @type {Array<string>}
 */
const TERMINAL_JOB_STATES = ['succeeded', 'failed', 'cancelled', 'expired'];

/**
 * Attempt states.
 *
 * @constant
 * @type {Array<string>}
 */
const ATTEMPT_STATES = [
    'assigned', 'preparing', 'running', 'uploading',
    'succeeded', 'failed', 'cancelled', 'preempted', 'abandoned',
];

/**
 * Attempt states a lease is still live in. Everything else is terminal and only
 * the coordinator writes it.
 *
 * @constant
 * @type {Array<string>}
 */
const LIVE_ATTEMPT_STATES = ['assigned', 'preparing', 'running', 'uploading'];

/**
 * The states a worker may report for itself in a heartbeat. Terminal states are
 * absent on purpose: a worker cannot declare itself succeeded, because the
 * coordinator's row is the truth. It reports a terminal outcome through the
 * result route, and the coordinator decides what that means.
 *
 * @constant
 * @type {Array<string>}
 */
const REPORTABLE_ATTEMPT_STATES = ['preparing', 'running', 'uploading'];

/**
 * Event kinds. `note` is the coordinator's own; a worker sends `metric` or `log`.
 *
 * @constant
 * @type {Array<string>}
 */
const EVENT_KINDS = ['metric', 'log', 'note'];

/**
 * The kinds a worker may send. `note` is absent on purpose: it is the
 * coordinator's own kind, used for recording why a lease was taken away, and a
 * worker able to write one could muddy that record.
 *
 * @constant
 * @type {Array<string>}
 */
const WORKER_EVENT_KINDS = ['metric', 'log'];

/**
 * What a worker may report as the outcome of an attempt.
 *
 * @constant
 * @type {Array<string>}
 */
const RESULT_OUTCOMES = ['succeeded', 'failed', 'cancelled'];

/**
 * What a heartbeat can answer.
 *
 * This is the only channel by which MARP tells a worker to do anything, which is
 * what keeps push unrepresentable: there is no route from MARP to a worker, so
 * control has to travel back along a request the worker itself made.
 *
 * @constant
 * @type {Array<string>}
 */
const CONTROL_ACTIONS = ['continue', 'cancel', 'pause', 'abandon'];

module.exports = {
    HEARTBEAT_SECONDS,
    LEASE_SECONDS,
    ATTEMPT_CAP_SECONDS,
    POLL_MAX_WAIT_SECONDS,
    POLL_RETRY_INTERVAL_MS,
    JSON_BODY_LIMIT,
    MAX_WORKER_NAME_LENGTH,
    MAX_WORKER_LOCAL_ID_LENGTH,
    MAX_EVENTS_PER_BATCH,
    MAX_ARTIFACT_BYTES,
    ARTIFACT_DIRECTORY,
    ARTIFACT_PATH_PREFIX,
    MEDIA_CLIENT_IDENTITY,
    WORKER_STATES,
    JOB_KINDS,
    INGESTIBLE_JOB_KINDS,
    ENGINE_DATA_TYPES,
    JOB_STATES,
    TERMINAL_JOB_STATES,
    ATTEMPT_STATES,
    LIVE_ATTEMPT_STATES,
    REPORTABLE_ATTEMPT_STATES,
    EVENT_KINDS,
    WORKER_EVENT_KINDS,
    RESULT_OUTCOMES,
    CONTROL_ACTIONS,
};
