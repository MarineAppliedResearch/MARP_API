/**
 * Repository module for GPU orchestration database operations.
 *
 * Owns all five orchestration tables together -- `gpu_workers`, `gpu_jobs`,
 * `gpu_job_attempts`, `gpu_job_events` and `gpu_artifacts_staging` -- the same
 * one-domain-owns-its-related-tables shape as `repository/v2_tokens.repository.js`
 * owning applications and their tokens. They are one domain because the
 * interesting operations touch three of them at once inside a single
 * transaction, and a transaction cannot be split across two repositories.
 *
 * **Three rules are the whole design, and they live here.**
 *
 * 1. *Claiming happens inside the poll transaction.* There is no separate claim
 *    call. {@link GpuRepository#selectClaimableJobRow} takes a row lock with
 *    `FOR UPDATE SKIP LOCKED`, so a second poller arriving at the same instant
 *    does not wait for the first and does not see the row it holds -- it either
 *    takes a different job or is told there is no work. Two pollers cannot lease
 *    one job.
 * 2. *The coordinator's row is the truth; a worker's report is evidence.* Every
 *    state-changing call carries `(attempt_id, worker_id, lease_epoch)`, and a
 *    mismatch is answered `abandon` with nothing written. That is what stops a
 *    worker which was presumed dead, and whose job was reassigned, from coming
 *    back and overwriting it.
 * 3. *Expiry is judged on the coordinator's clock only.* Nothing here reads a
 *    timestamp a worker sent to decide whether a lease is still valid.
 *
 * The state machine sits in this file rather than in the service layer, against
 * the usual division, because each decision has to be made against locked rows
 * and applied in the same transaction that read them. Moving the decision one
 * layer up would mean reading the rows, deciding, and writing in three separate
 * steps -- which is exactly the race the locking exists to remove. The service
 * validates requests and shapes responses; the atomic decisions are here.
 *
 * @fileoverview GPU orchestration persistence: workers, jobs, leases, events and staged artifacts.
 * @author Isaac Travers
 * @module repository/gpu
 */

'use strict';

const { QueryTypes } = require('sequelize');

/**
 * Shared database registry containing the configured Sequelize connection,
 * initialized models, and model associations.
 *
 * @constant
 * @type {Object}
 */
const db = require('../model');

/**
 * Application logger used to record repository errors.
 *
 * @constant
 * @type {Object}
 */
const logger = require('../logger/api.logger');

const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');

const {
    LEASE_SECONDS,
    ATTEMPT_CAP_SECONDS,
    WORKER_OFFLINE_SECONDS,
    ARTIFACT_PATH_PREFIX,
    LIVE_ATTEMPT_STATES,
    TERMINAL_JOB_STATES,
    RESULT_OUTCOMES,
    SAMPLE_RETENTION_DAYS,
} = require('../config/gpu-orchestration');

/**
 * The live attempt states as a SQL list, built once. Used by the several raw
 * queries that need "is this attempt still running".
 *
 * @constant
 * @type {string}
 */
const LIVE_ATTEMPT_STATES_SQL = LIVE_ATTEMPT_STATES.map((state) => `'${state}'`).join(', ');

/**
 * The terminal job states as a SQL list.
 *
 * @constant
 * @type {string}
 */
const TERMINAL_JOB_STATES_SQL = TERMINAL_JOB_STATES.map((state) => `'${state}'`).join(', ');

/**
 * Keeps `gpu_jobs.finished_at` in step with a state this statement is setting
 * from a bound `:jobState`.
 *
 * Every statement that moves a job's state carries this, because `finished_at`
 * is only trustworthy if it is impossible to set a state without it -- and a
 * requeue has to *clear* it as surely as a success sets it, or a job that
 * expired and went back in the queue would go on claiming it finished an hour
 * ago. `tests/gpu-finished-at.test.js` reads this file and fails if a statement
 * that sets a job's state forgets.
 *
 * @constant
 * @type {string}
 */
const FINISHED_AT_SQL = `finished_at = CASE WHEN :jobState IN (${TERMINAL_JOB_STATES_SQL}) THEN NOW() ELSE NULL END`;

/**
 * What the job list may be sorted by, and the expression for each.
 *
 * A whitelist because a column name cannot be a bound parameter -- it is
 * interpolated into the statement, so the set of things that can land there is
 * fixed here rather than taken from the caller.
 *
 * Only columns of `gpu_jobs`. Progress and worker live on the joined attempt and
 * sorting by them is a different and more expensive query; they can be added
 * once something has measured that the join is affordable at the scale #104
 * assumes.
 *
 * @constant
 * @type {Object<string, string>}
 */
const JOB_SORT_COLUMNS = {
    name: 'j.name',
    kind: 'j.kind',
    state: 'j.state',
    priority: 'j.priority',
    created_at: 'j.created_at',
    finished_at: 'j.finished_at',
};

/**
 * Outcomes that leave observations worth taking into the record.
 *
 * A stop is in here with a success, because the frames a volunteer got through
 * before pressing stop are the same frames they would have got through without
 * it. A failure and a cancel are not: one produced nothing trustworthy, the
 * other was called off.
 *
 * @constant
 * @type {Array<string>}
 */
const INGESTABLE_OUTCOMES = ['succeeded', 'yielded'];

/**
 * Which value column on `gpu_attempt_settings` each catalogue type is stored in.
 * Interpolated into SQL, so it is a constant here and never input.
 *
 * @constant
 * @type {Object<string, string>}
 */
const SETTING_VALUE_COLUMN = {
    real: 'value_real',
    int: 'value_int',
    bool: 'value_bool',
    text: 'value_text',
};

/**
 * How much of a job's attempt budget is actually spent, as SQL.
 *
 * `attempts_made` counts every lease ever granted, because it doubles as the
 * lease epoch and must never stand still. A deliberate stop is not a failed
 * attempt, so it is subtracted here -- otherwise the jobs handed between the
 * most volunteers would be the first to become unclaimable, which is backwards
 * for a pool.
 *
 * @constant
 * @type {string}
 */
const ATTEMPTS_SPENT_SQL = '(attempts_made - yields_made)';

/**
 * The same sum in JavaScript, for the paths that decide from a row already read.
 *
 * `yields_made` is defaulted rather than nullable, but a row read before this
 * migration ran -- in a test fixture, say -- would carry undefined, and treating
 * that as NaN would make every comparison false and quietly expire jobs.
 *
 * @param {Object} job - A `gpu_jobs` row.
 * @returns {number} Attempts that count against `max_attempts`.
 */
function attemptsSpent(job) {
    return Number(job.attempts_made) - Number(job.yields_made || 0);
}

/**
 * Why a call carrying `(attempt_id, worker_id, lease_epoch)` should be refused,
 * or null when it should be honoured.
 *
 * The three refusals are one mechanism seen from three angles: the attempt has
 * already ended, another machine holds it, or this machine holds an older lease
 * on it. All three mean the caller's picture of the world is stale, and all three
 * are answered `abandon`.
 *
 * @param {Object|null} attempt - Attempt row, or null when there is no such attempt.
 * @param {number} workerId - Worker the caller claims to be.
 * @param {number} leaseEpoch - Lease epoch the caller claims to hold.
 * @returns {string|null} A short reason, or null when the lease is good.
 */
function leaseRefusalReason(attempt, workerId, leaseEpoch) {
    if (!attempt) {
        return 'no such attempt';
    }

    if (Number(attempt.worker_id) !== Number(workerId)) {
        return 'this attempt belongs to another worker';
    }

    if (Number(attempt.lease_epoch) !== Number(leaseEpoch)) {
        return `lease epoch ${leaseEpoch} is stale; this attempt is at epoch ${attempt.lease_epoch}`;
    }

    if (!LIVE_ATTEMPT_STATES.includes(attempt.state)) {
        return `this attempt already ended as ${attempt.state}`;
    }

    return null;
}

/**
 * Repository for GPU orchestration database operations.
 *
 * @class GpuRepository
 */
class GpuRepository {

    db = {};

    constructor() {
        this.db = db;
    }

    // -----------------------------------------------------------------
    // Workers
    // -----------------------------------------------------------------

    /**
     * Enrol a machine, or bring an already-enrolled one back with fresh
     * hardware.
     *
     * **Keyed on `local_id`, the durable id the machine generated for itself.**
     * So a worker that restarts is the same row rather than a second one --
     * otherwise a machine rebooted twice a day would fill the pool view with
     * ghosts, and a human could not tell which row was the live one.
     * `enrolled_at` therefore means "first seen", which is the more useful fact.
     *
     * It used to key on the name, which had it backwards: the name was `UNIQUE`
     * and the durable id had nowhere to be stored, so renaming a machine forked
     * its row at the next enrolment and left the old one holding the lease. Two
     * machines that happen to share a hostname now get a row each for the same
     * reason -- their ids differ.
     *
     * **A re-enrolment does not overwrite the name**, which is what makes a
     * rename stick. The worker sends the name it computes at startup on every
     * enrolment, so honouring it would silently undo an operator's rename at the
     * machine's next restart. Hardware, version and slot count *are* refreshed:
     * those are facts about the machine, and reading a stale one is how the pool
     * view came to say "no GPU" long after CUDA was working.
     *
     * @async
     * @param {Object} params
     * @param {string} params.localId - The machine's durable generated id.
     * @param {string} params.name - What the machine calls itself, used only when
     * this is the first enrolment.
     * @param {Object} [params.capabilities] - GPUs, VRAM, driver, disk, engines.
     * @param {number} [params.slotCount] - How many attempts it will run at once.
     * @param {string} [params.workerVersion] - Version of the worker software.
     * @returns {Promise<Object>} The worker row, plain.
     * @throws {Error} Re-throws any database failure.
     */
    async enrolWorker({ localId, name, capabilities, slotCount, workerVersion }) {
        try {
            const now = new Date();

            const [worker] = await this.db.gpu_workers.findOrCreate({
                where: { local_id: localId },
                defaults: {
                    local_id: localId,
                    name,
                    state: 'online',
                    enrolled_at: now,
                    last_seen_at: now,
                    // A new machine that did not say how many slots it has runs
                    // one thing at a time.
                    slot_count: slotCount === undefined ? 1 : slotCount,
                    worker_version: workerVersion || null,
                    capabilities: capabilities || null,
                },
            });

            // Re-enrolment. The state goes back to online because a machine that
            // is talking is by definition not offline; a deliberate `paused` is
            // not preserved, since re-enrolling is how an operator restarts a
            // worker they had parked. `name` is deliberately absent: see above.
            await worker.update({
                state: 'online',
                last_seen_at: now,
                slot_count: slotCount === undefined ? worker.slot_count : slotCount,
                worker_version: workerVersion === undefined ? worker.worker_version : workerVersion,
                capabilities: capabilities === undefined ? worker.capabilities : capabilities,
            });

            return worker.get({ plain: true });
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Change what a machine is called.
     *
     * The name is metadata, so this touches nothing else: not the identity the
     * machine enrols with, not its state, and not any lease it holds. An attempt
     * quotes `(attempt_id, worker_id, lease_epoch)` and none of those move, which
     * is why a job survives its machine being renamed mid-run.
     *
     * @async
     * @param {number} workerId - Worker identifier.
     * @param {string} name - The new name.
     * @returns {Promise<Object|null>} The updated row, or null when there is no such worker.
     * @throws {Error} Re-throws any database failure.
     */
    async renameWorker(workerId, name) {
        try {
            const worker = await this.db.gpu_workers.findByPk(workerId);

            if (!worker) {
                return null;
            }

            await worker.update({ name });

            return worker.get({ plain: true });
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch one worker by id.
     *
     * @async
     * @param {number} workerId - Worker identifier.
     * @returns {Promise<Object|null>} The worker row, or null when there is no such worker.
     * @throws {Error} Re-throws any database failure.
     */
    /**
     * The packaged archive recorded for a dataset, or null.
     *
     * Only the columns a fetch needs. A dataset nobody has packaged has no
     * `archive_path`, which is the honest way to ask whether it can be trained
     * on remotely at all.
     *
     * @async
     * @param {number|string} datasetId - `datasets.id`.
     * @returns {Promise<Object|null>} `{id, name, archive_path, archive_sha256, archive_bytes}` or null.
     */
    async getDatasetArchiveById(datasetId) {
        try {
            const dataset = await this.db.datasets.findByPk(datasetId, {
                attributes: ['id', 'name', 'archive_path', 'archive_sha256', 'archive_bytes'],
            });

            return dataset ? dataset.get({ plain: true }) : null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    async getWorkerById(workerId) {
        try {
            const worker = await this.db.gpu_workers.findByPk(workerId);

            return worker ? worker.get({ plain: true }) : null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Record that a worker was heard from just now.
     *
     * `last_seen_at` is the only thing that distinguishes a machine that is idle
     * from one that has died, and until this existed it was written on enrolment,
     * on a heartbeat, and on a poll that actually took a job -- but not on a poll
     * that was answered "no work". So an idle machine, dialling out every few
     * seconds exactly as it should, went stale within a minute and looked
     * indistinguishable from one that had been switched off. Observed at fourteen
     * minutes stale on a process that was up and polling throughout.
     *
     * An offline worker is brought back to online by the same call, because a
     * machine that is asking for work is by definition not offline.
     *
     * @async
     * @param {number} workerId - Worker identifier.
     * @returns {Promise<void>}
     * @throws {Error} Re-throws any database failure.
     */
    async markWorkerSeen(workerId) {
        try {
            await this.db.sequelize.query(
                `UPDATE gpu_workers
                    SET last_seen_at = NOW(),
                        state = CASE WHEN state = 'offline' THEN 'online' ELSE state END
                  WHERE id = :workerId`,
                { replacements: { workerId } }
            );
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Mark every machine that has stopped talking `offline`.
     *
     * The mirror of `markWorkerSeen`, which brings an `offline` worker back the
     * moment it asks for work. Nothing was ever doing this half, so a worker
     * that was switched off stayed `online` for ever -- one read `online` more
     * than an hour after its process was killed, another with a `last_seen_at`
     * six days old (#202).
     *
     * **`online` only.** A `paused` machine that is then shut down is both, and
     * the pool should not forget that an operator parked it: `paused` is an
     * intention about the machine, `offline` is an observation of it, and the
     * intention outlives the observation. This is the same asymmetry
     * `markWorkerSeen` already keeps in the other direction.
     *
     * `COALESCE(last_seen_at, enrolled_at)` because a null must not make a row
     * immortal. A worker somehow never heard from is judged from when it
     * enrolled, which is the only other moment MARP knows it existed.
     *
     * Judged on the coordinator's clock, like every other timeout here. A
     * worker's own idea of the time never enters into it.
     *
     * **`SKIP LOCKED`, and it is load-bearing rather than a flourish.** A poll
     * takes `SELECT ... FROM gpu_workers WHERE id = :workerId FOR UPDATE` inside
     * the transaction that leases a job, and this sweep runs on every poll -- so
     * a plain `UPDATE` across the table would sit waiting on a row some other
     * machine's lease is holding, turning a sweep into a queue behind the
     * busiest thing in the system. Skipping costs nothing here: a row locked by
     * a live lease belongs to a machine that is demonstrably talking, so it is
     * not stale, and anything genuinely dead is still there on the next poll.
     * `expireStaleLeases` skips for the same reason.
     *
     * @async
     * @returns {Promise<Array<Object>>} One entry per machine marked offline:
     * `{id, name, last_seen_at}`.
     * @throws {Error} Re-throws any database failure.
     */
    /**
     * The pool's GPU readings over a window, bucketed.
     *
     * Averaged **across machines within a bucket**, which is the question the
     * Workers chart asks: "how hard was the pool working at four o'clock". A max
     * travels with it, because an average over a pool where one machine is
     * saturated and nine are idle hides the one fact worth seeing.
     *
     * Only machines that were working appear: a sample exists because a
     * heartbeat wrote it, and a heartbeat only happens during an attempt. So
     * this is utilization *of the machines doing work*, not of the pool's whole
     * capacity, and a screen should say so.
     *
     * @async
     * @param {Object} window
     * @param {Date} window.since - Start of the window.
     * @param {Date} window.until - End of the window.
     * @param {string} window.bucket - A PostgreSQL interval unit: minute, hour or day.
     * @returns {Promise<Array<Object>>} One row per bucket, oldest first.
     * @throws {Error} Re-throws any database failure.
     */
    async gpuUtilizationSeries({ since, until, bucket }) {
        try {
            /* `bucket` is interpolated because `date_trunc` takes a literal, so
               the service whitelists it. It never reaches here as caller text. */
            return await this.db.sequelize.query(
                `SELECT date_trunc('${bucket}', s.at) AS at,
                        count(DISTINCT s.worker_id)::int AS machines,
                        round(avg(d.util), 1)::float AS avg_utilization_percent,
                        max(d.util)::int AS max_utilization_percent,
                        round(avg(d.mem), 1)::float AS avg_memory_percent_used,
                        round(avg(d.watts), 1)::float AS avg_power_usage_watts
                   FROM gpu_worker_samples s
                   CROSS JOIN LATERAL (
                        SELECT (device->>'gpu_utilization_percent')::numeric AS util,
                               (device->>'memory_percent_used')::numeric     AS mem,
                               (device->>'power_usage_watts')::numeric       AS watts
                          FROM jsonb_array_elements(s.devices) AS device
                   ) d
                  WHERE s.at >= :since AND s.at < :until
                  GROUP BY 1
                  ORDER BY 1 ASC`,
                { replacements: { since, until }, type: QueryTypes.SELECT }
            );
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * How much work finished, and how much was waiting, over a window.
     *
     * Both from `gpu_jobs` and neither needing anything sampled: `finished` is a
     * count of jobs whose `finished_at` falls in the bucket, and `queued` is
     * reconstructed -- a job was waiting at time T if it was created before T
     * and had not finished by T. That is why #104's gap 24 had to add
     * `finished_at` before this was answerable at all.
     *
     * @async
     * @param {Object} window
     * @param {Date} window.since - Start of the window.
     * @param {Date} window.until - End of the window.
     * @param {string} window.bucket - A PostgreSQL interval unit: minute, hour or day.
     * @returns {Promise<Array<Object>>} One row per bucket, oldest first.
     * @throws {Error} Re-throws any database failure.
     */
    async jobThroughputSeries({ since, until, bucket }) {
        try {
            return await this.db.sequelize.query(
                `WITH buckets AS (
                        SELECT generate_series(
                                   date_trunc('${bucket}', :since::timestamptz),
                                   date_trunc('${bucket}', :until::timestamptz),
                                   ('1 ${bucket}')::interval) AS at
                 )
                 SELECT b.at,
                        (SELECT count(*)::int FROM gpu_jobs j
                          WHERE j.finished_at >= b.at
                            AND j.finished_at < b.at + ('1 ${bucket}')::interval) AS finished,
                        (SELECT count(*)::int FROM gpu_jobs j
                          WHERE j.finished_at >= b.at
                            AND j.finished_at < b.at + ('1 ${bucket}')::interval
                            AND j.state = 'succeeded') AS succeeded,
                        (SELECT count(*)::int FROM gpu_jobs j
                          WHERE j.created_at <= b.at
                            AND (j.finished_at IS NULL OR j.finished_at > b.at)) AS waiting
                   FROM buckets b
                  ORDER BY b.at ASC`,
                { replacements: { since, until }, type: QueryTypes.SELECT }
            );
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Throw away GPU readings older than the retention window.
     *
     * One row per machine per minute is cheap and unbounded, which is the shape
     * of problem nobody notices until a year has passed. `SAMPLE_RETENTION_DAYS`
     * is what the charts can look back over; past that the rows answer nothing
     * anybody asks.
     *
     * Swept from the pool read rather than from the heartbeat: a delete on every
     * heartbeat is a write per machine per ten seconds to achieve nothing most
     * of the time, and the range is an index scan that costs nothing when there
     * is nothing old.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} Re-throws any database failure.
     */
    async dropExpiredWorkerSamples() {
        try {
            await this.db.sequelize.query(
                `DELETE FROM gpu_worker_samples
                  WHERE at < NOW() - (:days * INTERVAL '1 day')`,
                { replacements: { days: SAMPLE_RETENTION_DAYS } }
            );
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    async markStaleWorkersOffline() {
        try {
            return await this.db.sequelize.query(
                `UPDATE gpu_workers
                    SET state = 'offline'
                  WHERE id IN (
                        SELECT id
                          FROM gpu_workers
                         WHERE state = 'online'
                           AND COALESCE(last_seen_at, enrolled_at)
                               < NOW() - (:offlineSeconds * INTERVAL '1 second')
                         ORDER BY id ASC
                           FOR UPDATE SKIP LOCKED)
              RETURNING id, name, last_seen_at`,
                {
                    replacements: { offlineSeconds: WORKER_OFFLINE_SECONDS },
                    type: QueryTypes.SELECT,
                }
            );
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch the pool: every worker, with whatever it is running right now.
     *
     * One row per worker per live attempt, and one row for an idle worker with
     * the attempt columns null. Left as rows rather than grouped here, because
     * grouping is shaping and belongs in the service.
     *
     * @async
     * @returns {Promise<Array<Object>>} Worker rows joined to their live attempts.
     * @throws {Error} Re-throws any database failure.
     */
    async listWorkerPoolRows() {
        try {
            return await this.db.sequelize.query(
                `SELECT w.id,
                        w.name,
                        w.state,
                        w.slot_count,
                        w.worker_version,
                        w.capabilities,
                        w.enrolled_at,
                        w.last_seen_at,
                        a.id               AS attempt_id,
                        a.state            AS attempt_state,
                        a.slot_index       AS attempt_slot_index,
                        a.lease_epoch      AS attempt_lease_epoch,
                        a.lease_expires_at AS attempt_lease_expires_at,
                        a.last_heartbeat_at,
                        a.leased_at        AS attempt_leased_at,
                        a.capabilities_snapshot,
                        s.at               AS sample_at,
                        s.devices          AS sample_devices,
                        a.progress_done,
                        a.progress_total,
                        a.progress_unit,
                        a.progress_phase,
                        a.progress_elapsed_s,
                        j.id               AS job_id,
                        j.kind             AS job_kind,
                        j.state            AS job_state,
                        j.batch_id         AS job_batch_id
                   FROM gpu_workers w
                   LEFT JOIN gpu_job_attempts a
                          ON a.worker_id = w.id
                         AND a.state IN (${LIVE_ATTEMPT_STATES_SQL})
                   LEFT JOIN gpu_jobs j
                          ON j.id = a.job_id
                   /* The machine's most recent reading, which the heartbeat
                      writes while work is running. Preferred over the attempt's
                      capabilities_snapshot because that one is taken at the
                      poll, before the job starts, and reads near-idle. */
                   LEFT JOIN LATERAL (
                        SELECT at, devices
                          FROM gpu_worker_samples
                         WHERE worker_id = w.id
                         ORDER BY at DESC
                         LIMIT 1
                   ) s ON TRUE
                  ORDER BY w.name ASC, w.id ASC, a.slot_index ASC, a.id ASC`,
                { type: QueryTypes.SELECT }
            );
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    // -----------------------------------------------------------------
    // Jobs
    // -----------------------------------------------------------------

    /**
     * Insert one or more jobs.
     *
     * All of them in one transaction, because the pieces of a split video are
     * only meaningful together: half a batch is worse than none, since a human
     * would have to work out which pieces are missing before resubmitting.
     *
     * @async
     * @param {Array<Object>} rows - Rows for `gpu_jobs`.
     * @returns {Promise<Array<Object>>} The created rows, plain.
     * @throws {Error} Re-throws after rolling back if any insert fails.
     */
    async createJobs(rows) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const created = await this.db.gpu_jobs.bulkCreate(rows, { transaction, returning: true });

            await transaction.commit();

            return created.map((job) => job.get({ plain: true }));
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * List jobs, newest first unless asked otherwise.
     *
     * Each job carries the progress of its **latest attempt**, whatever state that
     * attempt is in (#104, gap 23). A failed job showing how far its last try got
     * is useful; a failed job showing nothing is a second way of saying "failed".
     * The alternative was a detail call per visible row -- fifty-one requests to
     * draw one page -- and it was rejected for that reason.
     *
     * Nulls are left as nulls. A leased job that has not heartbeated yet has no
     * progress, which is not the same as no progress *made*, and the screens draw
     * a dash rather than an empty bar for exactly that distinction.
     *
     * @async
     * @param {Object} [filters]
     * @param {string} [filters.state] - Only jobs in this state.
     * @param {string} [filters.kind] - Only jobs of this kind.
     * @param {string} [filters.batchId] - Only jobs in this batch.
     * @param {Date} [filters.createdAfter] - Queued at or after this instant.
     * @param {Date} [filters.createdBefore] - Queued before this instant.
     * @param {Date} [filters.finishedAfter] - Finished at or after this instant.
     * @param {Date} [filters.finishedBefore] - Finished before this instant.
     * @param {string} [filters.search] - Matched against name, the video's source name and batch id.
     * @param {string} [filters.sort] - A key of {@link JOB_SORT_COLUMNS}.
     * @param {string} [filters.direction] - `asc` or `desc`.
     * @param {number} [filters.limit] - Page size.
     * @param {number} [filters.offset] - Rows to skip.
     * @returns {Promise<{jobs: Array<Object>, total: number}>} The page, and how many matched in total.
     * @throws {Error} Re-throws any database failure.
     */
    async listJobs(filters = {}) {
        try {
            const conditions = [];
            const replacements = {};

            if (filters.state) {
                conditions.push('j.state = :state');
                replacements.state = filters.state;
            }

            if (filters.kind) {
                conditions.push('j.kind = :kind');
                replacements.kind = filters.kind;
            }

            if (filters.batchId) {
                conditions.push('j.batch_id = :batchId');
                replacements.batchId = filters.batchId;
            }

            // Half-open on purpose: `before` excludes its own instant, so two
            // adjacent windows cannot both claim the same job.
            if (filters.createdAfter) {
                conditions.push('j.created_at >= :createdAfter');
                replacements.createdAfter = filters.createdAfter;
            }

            if (filters.createdBefore) {
                conditions.push('j.created_at < :createdBefore');
                replacements.createdBefore = filters.createdBefore;
            }

            if (filters.finishedAfter) {
                conditions.push('j.finished_at >= :finishedAfter');
                replacements.finishedAfter = filters.finishedAfter;
            }

            if (filters.finishedBefore) {
                conditions.push('j.finished_at < :finishedBefore');
                replacements.finishedBefore = filters.finishedBefore;
            }

            // The three things visible on the row. A search that matches
            // something invisible looks broken to whoever typed it.
            if (filters.search) {
                conditions.push(`(j.name ILIKE :search
                                  OR j.spec->'video'->>'source_name' ILIKE :search
                                  OR j.batch_id::text ILIKE :search)`);
                replacements.search = `%${filters.search}%`;
            }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

            // Whitelisted, because this is interpolated rather than bound -- a
            // column name cannot be a parameter.
            const column = JOB_SORT_COLUMNS[filters.sort] || JOB_SORT_COLUMNS.created_at;
            const direction = filters.direction === 'asc' ? 'ASC' : 'DESC';

            // The id tie-breaker is not decoration. A batch's pieces are all
            // inserted in the same statement and share a `created_at` to the
            // microsecond, so without it two pages of the same list could show
            // the same piece twice and miss another. It matters more now: `name`
            // and `finished_at` are both nullable, and NULLs tie with each other.
            //
            // It follows the direction rather than being fixed at DESC, so that
            // ascending and descending are exact reverses of one another. Either
            // way is a stable total order and pages correctly; a fixed DESC is
            // simply surprising, because reversing the sort would then leave
            // tied rows in the order they were already in.
            const order = `ORDER BY ${column} ${direction} NULLS LAST, j.id ${direction}`;

            const jobs = await this.db.sequelize.query(
                `SELECT j.*,
                        a.progress_done,
                        a.progress_total,
                        a.progress_unit,
                        a.progress_phase,
                        a.progress_elapsed_s
                   FROM gpu_jobs j
                   LEFT JOIN LATERAL (
                        SELECT progress_done, progress_total, progress_unit,
                               progress_phase, progress_elapsed_s
                          FROM gpu_job_attempts
                         WHERE job_id = j.id
                         ORDER BY id DESC
                         LIMIT 1
                   ) a ON TRUE
                   ${where}
                   ${order}
                  LIMIT :limit OFFSET :offset`,
                {
                    replacements: { ...replacements, limit: filters.limit, offset: filters.offset },
                    type: QueryTypes.SELECT,
                }
            );

            // Counted without the lateral join: it produces exactly one row per
            // job, so joining it here would cost the same work for the same answer.
            const [{ total }] = await this.db.sequelize.query(
                `SELECT count(*)::int AS total FROM gpu_jobs j ${where}`,
                { replacements, type: QueryTypes.SELECT }
            );

            return {
                jobs: jobs.map((job) => ({
                    ...job,
                    progress_elapsed_s: job.progress_elapsed_s === null
                        ? null
                        : Number(job.progress_elapsed_s),
                })),
                total,
            };
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * What a session is, in the terms a person would recognise it by.
     *
     * For the watch window: a worker putting inference on somebody's screen can
     * say which survey, dive and line it is working through, rather than an id.
     * Read at lease time rather than frozen onto the job, because a session can
     * be renamed or retyped after a job is queued.
     *
     * Takes either form of `spec.session`. Given `{session_id}` it reads the
     * row; given `{project_id, dive, line, type}` it answers from what it was
     * handed and looks up only the project's name, because that form names a
     * session that does not exist yet -- the ingest creates it afterwards.
     *
     * @async
     * @param {Object} session - `spec.session`, either form.
     * @returns {Promise<Object|null>} `{session_id, project, dive, line, type}`, or null.
     * @throws {Error} Re-throws any database failure.
     */
    async describeSession(session) {
        if (session.session_id) {
            const [row] = await this.db.sequelize.query(
                `SELECT s.session_id, s.dive, s.line, s.type, p.name AS project
                   FROM sessions s
                   LEFT JOIN projects p ON p.project_id = s.project_id
                  WHERE s.session_id = :sessionId`,
                { replacements: { sessionId: session.session_id }, type: QueryTypes.SELECT }
            );

            return row || null;
        }

        if (!session.project_id) {
            return null;
        }

        const [project] = await this.db.sequelize.query(
            'SELECT name FROM projects WHERE project_id = :projectId',
            { replacements: { projectId: session.project_id }, type: QueryTypes.SELECT }
        );

        return {
            session_id: null,
            project: project ? project.name : null,
            dive: session.dive === undefined ? null : session.dive,
            line: session.line === undefined ? null : session.line,
            type: session.type === undefined ? null : session.type,
        };
    }

    /**
     * Fetch one job with every attempt at it and every artifact it produced.
     *
     * @async
     * @param {number} jobId - Job identifier.
     * @returns {Promise<Object|null>} `{job, attempts, artifacts}`, or null when
     * there is no such job.
     * @throws {Error} Re-throws any database failure.
     */
    async getJobDetail(jobId) {
        try {
            const job = await this.db.gpu_jobs.findByPk(jobId);

            if (!job) {
                return null;
            }

            const attempts = await this.db.gpu_job_attempts.findAll({
                where: { job_id: jobId },
                include: [{ model: this.db.gpu_workers, as: 'worker', attributes: ['id', 'name', 'state'] }],
                order: [['lease_epoch', 'ASC'], ['id', 'ASC']],
            });

            const artifacts = await this.db.artifacts.findAll({
                where: { job_id: jobId },
                order: [['id', 'ASC']],
            });

            return {
                job: job.get({ plain: true }),
                attempts: attempts.map((attempt) => attempt.get({ plain: true })),
                artifacts: artifacts.map((artifact) => artifact.get({ plain: true })),
            };
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Fetch the existing orchestration fields needed for Jellyfin reporting.
     *
     * Playback state stays in Jellyfin. These rows reproduce a worker slot's
     * stable device identity and the attempt's last accepted frame position.
     *
     * @async
     * @param {number} attemptId - Attempt identifier.
     * @returns {Promise<Object|null>} Playback context, or null when absent.
     * @throws {Error} Re-throws any database failure.
     */
    async getAttemptPlaybackContext(attemptId) {
        try {
            const [context] = await this.db.sequelize.query(
                `SELECT attempt.id AS attempt_id,
                        attempt.slot_index,
                        attempt.progress_done,
                        attempt.progress_total,
                        attempt.progress_unit,
                        job.spec,
                        worker.id AS worker_id,
                        worker.name AS worker_name,
                        worker.worker_version
                   FROM gpu_job_attempts attempt
                   JOIN gpu_jobs job ON job.id = attempt.job_id
                   JOIN gpu_workers worker ON worker.id = attempt.worker_id
                  WHERE attempt.id = :attemptId`,
                { replacements: { attemptId }, type: QueryTypes.SELECT }
            );

            return context || null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Cancel a job.
     *
     * The job row changes at once; a worker running it finds out at its next
     * heartbeat, which is the only channel MARP has for telling it anything. So
     * "cancelled" here means the coordinator has stopped wanting the work, not
     * that the machine has stopped doing it -- the attempt reaches its own
     * terminal state when it reports back.
     *
     * @async
     * @param {number} jobId - Job identifier.
     * @returns {Promise<Object|null>} `{job, changed}`, or null when there is no
     * such job. `changed` is false for a job that had already finished.
     * @throws {Error} Re-throws after rolling back if the update fails.
     */
    async cancelJob(jobId) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const [job] = await this.db.sequelize.query(
                'SELECT * FROM gpu_jobs WHERE id = :jobId FOR UPDATE',
                { replacements: { jobId }, type: QueryTypes.SELECT, transaction }
            );

            if (!job) {
                await transaction.rollback();
                return null;
            }

            if (TERMINAL_JOB_STATES.includes(job.state)) {
                await transaction.commit();
                return { job, changed: false };
            }

            const [updated] = await this.db.sequelize.query(
                `UPDATE gpu_jobs
                    SET state = 'cancelled', updated_at = NOW(), finished_at = NOW()
                  WHERE id = :jobId
                  RETURNING *`,
                { replacements: { jobId }, type: QueryTypes.SELECT, transaction }
            );

            await transaction.commit();

            return { job: updated, changed: true };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    // -----------------------------------------------------------------
    // Leasing
    // -----------------------------------------------------------------

    /**
     * Take a row lock on the next claimable job, inside a caller's transaction.
     *
     * **This is the concurrency primitive of the whole design, and it is exposed
     * on its own so it can be tested with two overlapping transactions.** A test
     * that calls the whole claim twice in sequence proves nothing about
     * simultaneous pollers; a test that holds one transaction open while a second
     * one runs this can see the property directly.
     *
     * `FOR UPDATE SKIP LOCKED` is doing two things. `FOR UPDATE` means no other
     * transaction can change the row while this one decides what to do with it.
     * `SKIP LOCKED` means a second poller does not block behind the first and
     * does not see the row it holds -- it takes the next one, or none. Without
     * `SKIP LOCKED` two pollers would serialise and the second would still
     * (correctly) skip the row after re-evaluating the `WHERE`, but every poller
     * would wait behind every other, which for a long-poll is exactly wrong.
     *
     * Written as SQL rather than through Sequelize's `lock`/`skipLocked` options
     * because this one clause is the correctness argument, and it should be
     * readable as the clause it is.
     *
     * @async
     * @param {Object} transaction - Transaction to lock the row in.
     * @returns {Promise<Object|null>} The locked job row, or null when there is
     * nothing claimable.
     * @throws {Error} Re-throws any database failure.
     */
    async selectClaimableJobRow(transaction) {
        const [job] = await this.db.sequelize.query(
            `SELECT *
               FROM gpu_jobs
              WHERE state = 'queued'
                AND ${ATTEMPTS_SPENT_SQL} < max_attempts
              ORDER BY priority DESC, created_at ASC, id ASC
              LIMIT 1
                FOR UPDATE SKIP LOCKED`,
            { type: QueryTypes.SELECT, transaction }
        );

        return job || null;
    }

    /**
     * Claim the next queued job for a worker, and open an attempt at it.
     *
     * One transaction: lock a queued job, mark it leased, and insert the attempt
     * that holds the lease. There is no separate claim call for a worker to
     * forget to make, and no window in which a job is "chosen" but not yet
     * leased.
     *
     * The new attempt's `lease_epoch` is the job's `attempts_made` after this
     * lease is counted, which makes the epoch the attempt's ordinal: the first
     * attempt is epoch 1, the second is epoch 2. A unique index on
     * `(job_id, lease_epoch)` means even a bug here cannot produce two live
     * attempts at one job.
     *
     * @async
     * @param {Object} params
     * @param {number} params.workerId - Worker taking the lease.
     * @param {number} [params.slotIndex] - Which of its slots will run this.
     * @param {Object} [params.capabilities] - What it says it has, snapshotted onto the attempt.
     * @returns {Promise<{lease: {job: Object, attempt: Object}|null, slotsFull: boolean}>}
     * The job and its new attempt, or a null lease. `slotsFull` distinguishes
     * "this machine is already as busy as it said it can be" from "there is no
     * work", so a poll does not sit waiting for work it could not take.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async claimNextJob({ workerId, slotIndex, capabilities }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            // The worker's own row, locked. Two polls from the same machine
            // arriving at once would otherwise both see a free slot and both
            // take a job, overcommitting a machine past what it said it can run.
            // Locking per worker rather than globally, so this serialises one
            // machine's polls and not the pool's.
            const [worker] = await this.db.sequelize.query(
                'SELECT * FROM gpu_workers WHERE id = :workerId FOR UPDATE',
                { replacements: { workerId }, type: QueryTypes.SELECT, transaction }
            );

            if (!worker) {
                await transaction.commit();
                return { lease: null, slotsFull: false };
            }

            const [busy] = await this.db.sequelize.query(
                `SELECT COUNT(*)::int AS n
                   FROM gpu_job_attempts
                  WHERE worker_id = :workerId
                    AND state IN (${LIVE_ATTEMPT_STATES_SQL})`,
                { replacements: { workerId }, type: QueryTypes.SELECT, transaction }
            );

            if (busy.n >= Number(worker.slot_count)) {
                await transaction.commit();
                return { lease: null, slotsFull: true };
            }

            const job = await this.selectClaimableJobRow(transaction);

            if (!job) {
                await transaction.commit();
                return { lease: null, slotsFull: false };
            }

            const leaseEpoch = Number(job.attempts_made) + 1;

            const [updatedJob] = await this.db.sequelize.query(
                `UPDATE gpu_jobs
                    SET state = 'leased',
                        attempts_made = attempts_made + 1,
                        updated_at = NOW(),
                        finished_at = NULL
                  WHERE id = :jobId
                  RETURNING *`,
                { replacements: { jobId: job.id }, type: QueryTypes.SELECT, transaction }
            );

            const [attempt] = await this.db.sequelize.query(
                `INSERT INTO gpu_job_attempts
                        (job_id, worker_id, slot_index, lease_epoch, state,
                         leased_at, lease_expires_at, capabilities_snapshot)
                 VALUES (:jobId, :workerId, :slotIndex, :leaseEpoch, 'assigned',
                         NOW(), NOW() + (:leaseSeconds * INTERVAL '1 second'), :capabilities)
                 RETURNING *`,
                {
                    replacements: {
                        jobId: job.id,
                        workerId,
                        slotIndex: slotIndex === undefined ? 0 : slotIndex,
                        leaseEpoch,
                        leaseSeconds: LEASE_SECONDS,
                        capabilities: capabilities ? JSON.stringify(capabilities) : null,
                    },
                    type: QueryTypes.SELECT,
                    transaction,
                }
            );

            // The worker is demonstrably alive: it just asked for work.
            await this.db.sequelize.query(
                `UPDATE gpu_workers
                    SET last_seen_at = NOW(),
                        state = CASE WHEN state = 'offline' THEN 'online' ELSE state END
                  WHERE id = :workerId`,
                { replacements: { workerId }, transaction }
            );

            await transaction.commit();

            return { lease: { job: updatedJob, attempt }, slotsFull: false };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Take back every lease that has run out, and put its job back in the queue.
     *
     * Judged entirely on the coordinator's clock: `lease_expires_at` was written
     * by the coordinator and is compared against `NOW()` in the database. A
     * worker's own idea of the time never enters into it, which is what makes
     * this reliable across machines on other networks with other clocks.
     *
     * `SKIP LOCKED` again, so two API processes sweeping at once share the work
     * instead of blocking each other.
     *
     * A job goes back to `queued` while it has attempts left, and to `expired`
     * when it does not. `expired` is deliberately not `failed`: nothing went
     * wrong with the work, MARP simply stopped hearing from every machine that
     * tried it.
     *
     * @async
     * @returns {Promise<Array<Object>>} One entry per lease taken back:
     * `{attempt_id, job_id, job_state}`.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async expireStaleLeases() {
        const transaction = await this.db.sequelize.transaction();

        try {
            const stale = await this.db.sequelize.query(
                `SELECT id, job_id, lease_expires_at
                   FROM gpu_job_attempts
                  WHERE state IN (${LIVE_ATTEMPT_STATES_SQL})
                    AND lease_expires_at < NOW()
                  ORDER BY id ASC
                    FOR UPDATE SKIP LOCKED`,
                { type: QueryTypes.SELECT, transaction }
            );

            const taken = [];

            for (const attempt of stale) {
                await this.db.sequelize.query(
                    `UPDATE gpu_job_attempts
                        SET state = 'abandoned',
                            failure_reason = COALESCE(failure_reason, 'Lease expired: no heartbeat before lease_expires_at.'),
                            finished_at = NOW()
                      WHERE id = :attemptId`,
                    { replacements: { attemptId: attempt.id }, transaction }
                );

                await this.appendCoordinatorNote(
                    attempt.id,
                    { note: 'lease expired', lease_expires_at: attempt.lease_expires_at },
                    transaction
                );

                const [job] = await this.db.sequelize.query(
                    'SELECT * FROM gpu_jobs WHERE id = :jobId FOR UPDATE',
                    { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
                );

                // A job that finished some other way while this attempt was
                // dying keeps whatever it finished as. Only a job still believing
                // it is leased comes back.
                let jobState = job.state;

                if (job.state === 'leased') {
                    jobState = attemptsSpent(job) < Number(job.max_attempts) ? 'queued' : 'expired';

                    await this.db.sequelize.query(
                        `UPDATE gpu_jobs SET state = :jobState, updated_at = NOW(), ${FINISHED_AT_SQL} WHERE id = :jobId`,
                        { replacements: { jobState, jobId: job.id }, transaction }
                    );
                }

                taken.push({ attempt_id: attempt.id, job_id: job.id, job_state: jobState });
            }

            await transaction.commit();

            return taken;
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    // -----------------------------------------------------------------
    // Attempts: heartbeat, events, result
    // -----------------------------------------------------------------

    /**
     * Record a heartbeat and answer with what the worker should do next.
     *
     * The only channel by which MARP tells a worker anything, which is why
     * cancel, pause and abandon are all delivered here as an `action` rather than
     * by a route MARP could call on a worker.
     *
     * Everything is decided against rows locked in this transaction, and every
     * deadline against the database's clock. A refused lease writes nothing at
     * all -- a resurrected worker must not be able to move the progress of a job
     * that was reassigned to somebody else.
     *
     * @async
     * @param {Object} params
     * @param {number} params.attemptId - Attempt the worker believes it holds.
     * @param {number} params.workerId - Worker it believes it is.
     * @param {number} params.leaseEpoch - Lease epoch it believes it holds.
     * @param {string} [params.state] - Where it says it is: preparing, running, uploading.
     * @param {Object} [params.progress] - Latest counters, phase and elapsed seconds.
     * @returns {Promise<Object>} `{action, reason, lease_expires_at, heartbeat_seconds, attempt}`.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async recordHeartbeat({ attemptId, workerId, leaseEpoch, state, progress, telemetry }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const [attempt] = await this.db.sequelize.query(
                'SELECT * FROM gpu_job_attempts WHERE id = :attemptId FOR UPDATE',
                { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
            );

            const refusal = leaseRefusalReason(attempt, workerId, leaseEpoch);

            if (refusal) {
                await transaction.commit();
                return { action: 'abandon', reason: refusal, lease_expires_at: null };
            }

            const [job] = await this.db.sequelize.query(
                'SELECT * FROM gpu_jobs WHERE id = :jobId FOR UPDATE',
                { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
            );

            const [worker] = await this.db.sequelize.query(
                'SELECT * FROM gpu_workers WHERE id = :workerId',
                { replacements: { workerId }, type: QueryTypes.SELECT, transaction }
            );

            await this.db.sequelize.query(
                'UPDATE gpu_workers SET last_seen_at = NOW() WHERE id = :workerId',
                { replacements: { workerId }, transaction }
            );

            // The GPU reading, when the worker sent one. **Upserted onto the
            // minute**, so a heartbeat every ten seconds leaves one row rather
            // than six: `date_trunc` plus the unique index on (worker_id, at)
            // makes the rate limit the schema's rather than a caller's to
            // remember, and the last reading in a minute is the one that stays.
            //
            // Written here rather than left to the poll's snapshot because the
            // poll happens before the machine starts work -- that is the whole
            // reason this table exists.
            if (telemetry && Array.isArray(telemetry.devices) && telemetry.devices.length) {
                await this.db.sequelize.query(
                    `INSERT INTO gpu_worker_samples (worker_id, attempt_id, at, devices)
                     VALUES (:workerId, :attemptId, date_trunc('minute', NOW()), :devices)
                     ON CONFLICT (worker_id, at)
                     DO UPDATE SET devices = EXCLUDED.devices, attempt_id = EXCLUDED.attempt_id`,
                    {
                        replacements: {
                            workerId,
                            attemptId: attempt.id,
                            devices: JSON.stringify(telemetry.devices),
                        },
                        transaction,
                    }
                );
            }

            // The per-attempt cap. A worker that heartbeats faithfully forever
            // while making no progress is otherwise indistinguishable from one
            // that is working, so the cap is the only thing that ends it.
            const ranForSeconds = (Date.now() - new Date(attempt.leased_at).getTime()) / 1000;

            if (ranForSeconds > ATTEMPT_CAP_SECONDS) {
                const result = await this.endAttemptAndReleaseJob({
                    attempt,
                    job,
                    attemptState: 'abandoned',
                    failureReason: `Attempt exceeded the ${ATTEMPT_CAP_SECONDS}s cap for a single attempt.`,
                    note: { note: 'attempt cap exceeded', ran_for_seconds: Math.round(ranForSeconds) },
                    transaction,
                });

                await transaction.commit();

                return {
                    action: 'abandon',
                    reason: 'attempt exceeded the per-attempt cap',
                    lease_expires_at: null,
                    job_state: result.jobState,
                };
            }

            // Progress and the reported state are written whatever the answer
            // turns out to be: they are evidence about a lease that is still
            // valid, and a cancelling worker's last progress is worth keeping.
            const nextState = state && LIVE_ATTEMPT_STATES.includes(state) ? state : attempt.state;

            const [updatedAttempt] = await this.db.sequelize.query(
                `UPDATE gpu_job_attempts
                    SET state = :nextState,
                        last_heartbeat_at = NOW(),
                        lease_expires_at = NOW() + (:leaseSeconds * INTERVAL '1 second'),
                        progress_done = COALESCE(:progressDone, progress_done),
                        progress_total = COALESCE(:progressTotal, progress_total),
                        progress_unit = COALESCE(:progressUnit, progress_unit),
                        progress_phase = COALESCE(:progressPhase, progress_phase),
                        progress_elapsed_s = COALESCE(:progressElapsedSeconds, progress_elapsed_s)
                  WHERE id = :attemptId
                  RETURNING *`,
                {
                    replacements: {
                        attemptId,
                        nextState,
                        leaseSeconds: LEASE_SECONDS,
                        progressDone: progress && progress.done !== undefined ? progress.done : null,
                        progressTotal: progress && progress.total !== undefined ? progress.total : null,
                        progressUnit: progress && progress.unit !== undefined ? progress.unit : null,
                        progressPhase: progress && progress.phase !== undefined ? progress.phase : null,
                        progressElapsedSeconds: progress && progress.elapsed_s !== undefined
                            ? progress.elapsed_s
                            : null,
                    },
                    type: QueryTypes.SELECT,
                    transaction,
                }
            );

            await transaction.commit();

            // Cancel first: a cancelled job is cancelled whatever the machine's
            // own state is. The lease is still extended, so the worker has time
            // to wind down and report a terminal result rather than being
            // declared expired while it does.
            if (job.state === 'cancelled') {
                return {
                    action: 'cancel',
                    reason: 'the job was cancelled',
                    lease_expires_at: updatedAttempt.lease_expires_at,
                    attempt: updatedAttempt,
                };
            }

            if (worker && worker.state === 'paused') {
                return {
                    action: 'pause',
                    reason: 'this worker is paused',
                    lease_expires_at: updatedAttempt.lease_expires_at,
                    attempt: updatedAttempt,
                };
            }

            // The job moved on without this attempt -- it was expired and
            // reassigned, or another attempt published a result.
            if (job.state !== 'leased') {
                return {
                    action: 'abandon',
                    reason: `the job is ${job.state}`,
                    lease_expires_at: null,
                    attempt: updatedAttempt,
                };
            }

            return {
                action: 'continue',
                reason: null,
                lease_expires_at: updatedAttempt.lease_expires_at,
                attempt: updatedAttempt,
            };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Record the inference settings an attempt ran with (#232).
     *
     * **The first report is the record.** An attempt resolves its settings once,
     * before its first frame, so a second report for the same attempt is kept as
     * an event but written nowhere else -- the same rule as
     * `published_attempt_id`, which is set once and never overwritten.
     *
     * **A setting the catalogue does not know is registered, not refused.** A
     * newer worker reporting a setting this database has not seen would otherwise
     * lose exactly the record this exists to make. It arrives with the type the
     * worker declared and no description.
     *
     * @async
     * @param {number} attemptId - Attempt the settings belong to.
     * @param {{engine: string, settings: Array<Object>, ignored: Array<Object>}} report - Parsed by the service.
     * @param {Object} transaction - The events transaction, so the report and its event land together.
     * @returns {Promise<void>} Resolves once the rows are written, or skipped as a repeat.
     * @throws {ApiError} 400 when a value's type disagrees with its catalogue entry.
     */
    async recordAttemptSettings(attemptId, report, transaction) {
        const [already] = await this.db.sequelize.query(
            `SELECT 1 AS present FROM gpu_attempt_settings WHERE attempt_id = :attemptId
             UNION ALL
             SELECT 1 FROM gpu_attempt_ignored_params WHERE attempt_id = :attemptId
             LIMIT 1`,
            { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
        );

        if (already) {
            logger.info(`attempt ${attemptId} reported its settings again; the first report stands`);
            return;
        }

        for (const setting of report.settings) {
            const entry = await this.catalogueEntry(report.engine, setting, transaction);

            // The catalogue's type decides the column. A worker reporting a
            // different one means the two disagree about what the setting is,
            // and storing it anyway would put a value in the wrong column.
            if (entry.value_type !== setting.type) {
                throw new ApiError(
                    400,
                    ERROR_CODES.VALIDATION_ERROR,
                    `setting ${report.engine}.${setting.name} is recorded as ${entry.value_type} `
                    + `in the catalogue but was reported as ${setting.type}.`
                );
            }

            const column = SETTING_VALUE_COLUMN[entry.value_type];

            await this.db.sequelize.query(
                `INSERT INTO gpu_attempt_settings (attempt_id, setting_id, ${column}, source)
                 VALUES (:attemptId, :settingId, :value, :source)
                 ON CONFLICT (attempt_id, setting_id) DO NOTHING`,
                {
                    replacements: {
                        attemptId,
                        settingId: entry.id,
                        value: setting.value,
                        source: setting.source,
                    },
                    transaction,
                }
            );
        }

        for (const item of report.ignored) {
            await this.db.sequelize.query(
                `INSERT INTO gpu_attempt_ignored_params (attempt_id, key, requested_value)
                 VALUES (:attemptId, :key, :requestedValue)
                 ON CONFLICT (attempt_id, key) DO NOTHING`,
                {
                    replacements: { attemptId, key: item.key, requestedValue: item.requestedValue },
                    transaction,
                }
            );
        }
    }

    /**
     * Find a setting in the catalogue, registering it if it is not there.
     *
     * Insert-or-read rather than read-then-insert, so two attempts reporting the
     * same new setting at once both end up pointing at one row.
     *
     * @async
     * @param {string} engine - Engine the setting belongs to.
     * @param {{name: string, type: string}} setting - The reported setting.
     * @param {Object} transaction - Transaction to work inside.
     * @returns {Promise<{id: number, value_type: string}>} The catalogue row.
     */
    async catalogueEntry(engine, setting, transaction) {
        const [registered] = await this.db.sequelize.query(
            `INSERT INTO inference_settings (engine, name, value_type)
             VALUES (:engine, :name, :valueType)
             ON CONFLICT (engine, name) DO NOTHING
             RETURNING id, value_type`,
            {
                replacements: { engine, name: setting.name, valueType: setting.type },
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        if (registered) {
            logger.info(`registered inference setting ${engine}.${setting.name} (${setting.type}) from a worker report`);
            return registered;
        }

        const [existing] = await this.db.sequelize.query(
            'SELECT id, value_type FROM inference_settings WHERE engine = :engine AND name = :name',
            { replacements: { engine, name: setting.name }, type: QueryTypes.SELECT, transaction }
        );

        return existing;
    }



    /**
     * Marks a training run finished, if this job opened one.
     *
     * `total_epochs` is set from what was actually recorded rather than from what
     * the job asked for. A run that was stopped, or that stopped early on
     * `patience`, did fewer -- and the column is read as "how long was this
     * trained for", which the request cannot answer.
     *
     * Does nothing for a job that is not training, or that never reported an
     * epoch: a run with nothing in it is not something to open and immediately
     * close.
     *
     * @async
     * @param {Object} job - The job row, with `id` and `kind`.
     * @param {Object} transaction - The open transaction.
     * @returns {Promise<void>} Resolves when the run is closed, or skipped.
     */
    async closeTrainingRun(job, transaction) {
        if (!job || job.kind !== 'training') return;

        await this.db.sequelize.query(
            `UPDATE training_runs
                SET end_time = NOW(),
                    total_epochs = (SELECT COUNT(*) FROM epochs WHERE training_run_id = training_runs.id),
                    updated_at = NOW()
              WHERE job_id = :jobId
                AND end_time IS NULL`,
            { replacements: { jobId: job.id }, transaction }
        );
    }

    /**
     * Writes one epoch of a training run, opening the run if this is its first.
     *
     * **Why this exists at all.** The ML schema -- `training_runs`, `epochs`,
     * `metrics_summary` -- was written for the legacy desktop script and nothing
     * in the job path has ever filled it in. An event stream is enough to watch a
     * job, and not enough to answer "what did this model learn, and when", which
     * is what the dashboard and anybody comparing two models is actually asking.
     *
     * Silently does nothing for an inference job. Every job sends metrics; only a
     * training job has epochs, and deciding that here rather than at the call
     * site keeps one rule in one place.
     *
     * @async
     * @param {number} attemptId - The attempt the event arrived on.
     * @param {Object} event - The accepted metric event.
     * @param {Object} transaction - The open transaction to write inside.
     * @returns {Promise<void>} Resolves when the epoch is written, or skipped.
     */
    async recordTrainingEpoch(attemptId, event, transaction) {
        const payload = event.payload || {};
        const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : null;

        // An epoch needs a number to be an epoch. A metric event without one is
        // a progress sample, which the event stream already holds.
        const epochNumber = Number(payload.step);
        if (!metrics || !Number.isInteger(epochNumber)) return;

        const [job] = await this.db.sequelize.query(
            `SELECT j.id, j.kind, j.spec
               FROM gpu_job_attempts a
               JOIN gpu_jobs j ON j.id = a.job_id
              WHERE a.id = :attemptId`,
            { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
        );

        if (!job || job.kind !== 'training') return;

        const spec = job.spec || {};
        const params = spec.params || {};

        /* `training_runs.model_id` is NOT NULL, so without one there is no run to
           open. Submission refuses a training job that has no registered model,
           which makes this unreachable for anything queued since -- but a job
           queued before that check, or by something else, must not have its
           event batch fail over the record. The events are still written; only
           the projection is skipped. */
        const modelId = spec.model && spec.model.ml_model_id;
        if (!modelId) return;

        // One run per job. `FOR UPDATE` because two heartbeats carrying metrics
        // can arrive close together and both would otherwise open a run.
        const [existing] = await this.db.sequelize.query(
            'SELECT id FROM training_runs WHERE job_id = :jobId ORDER BY id LIMIT 1 FOR UPDATE',
            { replacements: { jobId: job.id }, type: QueryTypes.SELECT, transaction }
        );

        let trainingRunId = existing && existing.id;

        if (!trainingRunId) {
            const [opened] = await this.db.sequelize.query(
                `INSERT INTO training_runs (job_id, model_id, dataset_id, start_time,
                                            total_epochs, batch_size, learning_rate, optimizer,
                                            notes, created_at, updated_at)
                 VALUES (:jobId, :modelId, :datasetId, NOW(),
                         :totalEpochs, :batchSize, :learningRate, :optimizer,
                         :notes, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: {
                        jobId: job.id,
                        /* The model the run STARTED from. The model it produces does
                           not exist yet and will be registered from the published
                           weights, so putting it here would be a guess at a row id
                           that may never be created. */
                        modelId,
                        datasetId: (spec.dataset && spec.dataset.dataset_id) || null,
                        totalEpochs: Number.isFinite(Number(params.epochs)) ? Number(params.epochs) : null,
                        batchSize: Number.isFinite(Number(params.batch)) ? Number(params.batch) : null,
                        learningRate: Number.isFinite(Number(params.lr0)) ? Number(params.lr0) : null,
                        optimizer: params.optimizer ? String(params.optimizer) : null,
                        notes: `Opened by GPU job ${job.id}.`,
                    },
                    type: QueryTypes.SELECT,
                    transaction,
                }
            );
            trainingRunId = opened.id;
        }

        /* Ultralytics names its metrics by task and version, which is why the
           event payload is free-form. These five are the ones `epochs` has
           columns for; everything else stays in the event, which is the record
           that does not lose what it was not expecting. */
        const value = (name) => {
            const raw = metrics[name];
            const asNumber = Number(raw);
            return Number.isFinite(asNumber) ? asNumber : null;
        };

        await this.db.sequelize.query(
            `INSERT INTO epochs (training_run_id, epoch_number, precision, recall,
                                 box_loss, cls_loss, dfl_loss, timestamp, created_at, updated_at)
             SELECT :runId, :epochNumber, :precision, :recall,
                    :boxLoss, :clsLoss, :dflLoss, NOW(), NOW(), NOW()
              WHERE NOT EXISTS (
                  SELECT 1 FROM epochs WHERE training_run_id = :runId AND epoch_number = :epochNumber
              )`,
            {
                replacements: {
                    runId: trainingRunId,
                    epochNumber,
                    precision: value('metrics/precision(B)'),
                    recall: value('metrics/recall(B)'),
                    boxLoss: value('train/box_loss'),
                    clsLoss: value('train/cls_loss'),
                    dflLoss: value('train/dfl_loss'),
                },
                transaction,
            }
        );
    }

    /**
     * Append a batch of worker events, ignoring any the coordinator already has.
     *
     * `ON CONFLICT DO NOTHING` against the `(attempt_id, seq)` primary key is the
     * whole of the replay safety: a worker that resends a batch it never saw the
     * answer to inserts nothing the second time and is told so.
     *
     * @async
     * @param {Object} params
     * @param {number} params.attemptId - Attempt the events belong to.
     * @param {number} params.workerId - Worker sending them.
     * @param {number} params.leaseEpoch - Lease epoch it holds.
     * @param {Array<Object>} params.events - `{seq, kind, at, payload, settings}` entries; `settings` is the parsed report on a settings event.
     * @returns {Promise<Object>} `{action, reason, accepted, duplicates, next_seq}`.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async appendEvents({ attemptId, workerId, leaseEpoch, events }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const [attempt] = await this.db.sequelize.query(
                'SELECT * FROM gpu_job_attempts WHERE id = :attemptId FOR UPDATE',
                { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
            );

            const refusal = leaseRefusalReason(attempt, workerId, leaseEpoch);

            if (refusal) {
                await transaction.commit();
                return { action: 'abandon', reason: refusal, accepted: 0, duplicates: 0, next_seq: null };
            }

            let accepted = 0;

            for (const event of events) {
                const inserted = await this.db.sequelize.query(
                    `INSERT INTO gpu_job_events (attempt_id, seq, at, kind, payload)
                     VALUES (:attemptId, :seq, COALESCE(:at, NOW()), :kind, :payload)
                     ON CONFLICT (attempt_id, seq) DO NOTHING
                     RETURNING seq`,
                    {
                        replacements: {
                            attemptId,
                            seq: event.seq,
                            at: event.at || null,
                            kind: event.kind,
                            payload: event.payload === undefined ? null : JSON.stringify(event.payload),
                        },
                        type: QueryTypes.SELECT,
                        transaction,
                    }
                );

                if (inserted.length > 0) {
                    accepted += 1;

                    // Only a newly accepted report is written: a replayed batch
                    // arrives with the same seq and must not be recorded twice.
                    if (event.settings) {
                        await this.recordAttemptSettings(attemptId, event.settings, transaction);
                    }

                    // A training job's metrics are also the scientific record of
                    // the run, not only an event stream. Projected here, inside
                    // the same transaction and only for a newly accepted event,
                    // so a replayed batch cannot write an epoch twice.
                    if (event.kind === 'metric') {
                        await this.recordTrainingEpoch(attemptId, event, transaction);
                    }
                }
            }

            const [highest] = await this.db.sequelize.query(
                `SELECT COALESCE(MAX(seq), -1) AS max_seq
                   FROM gpu_job_events
                  WHERE attempt_id = :attemptId
                    AND seq >= 0`,
                { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
            );

            await transaction.commit();

            return {
                action: 'continue',
                reason: null,
                accepted,
                duplicates: events.length - accepted,
                next_seq: Number(highest.max_seq) + 1,
            };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Record an attempt's terminal report, and decide what it means for the job.
     *
     * The guarded step. `published_attempt_id` is set once and never overwritten,
     * so a second attempt reporting success after the first already published
     * changes its own row and leaves the job's result alone. That is what stops a
     * slow worker, whose job was reassigned and finished elsewhere, from
     * replacing the result somebody has already looked at.
     *
     * Replaying the same report is answered from the rows rather than reapplied:
     * an attempt that has already ended returns the outcome it ended with, and no
     * second set of artifacts appears.
     *
     * @async
     * @param {Object} params
     * @param {number} params.attemptId - Attempt reporting.
     * @param {number} params.workerId - Worker it belongs to.
     * @param {number} params.leaseEpoch - Lease epoch it holds.
     * @param {string} params.outcome - succeeded, failed or cancelled.
     * @param {string} [params.failureReason] - Why, for a failure.
     * @param {Array<Object>} [params.artifacts] - `{sha256, role}` entries, already staged.
     * @returns {Promise<Object>} The ack: `{action, accepted, idempotent, outcome, job_state, published, published_attempt_id, artifacts_recorded}`.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async publishResult({ attemptId, workerId, leaseEpoch, outcome, failureReason, artifacts, completedThroughFrame }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const [attempt] = await this.db.sequelize.query(
                'SELECT * FROM gpu_job_attempts WHERE id = :attemptId FOR UPDATE',
                { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
            );

            // A replay, rather than a stale lease: the same worker at the same
            // epoch, reporting an attempt that already ended *the way a worker
            // reports*. Answered from the rows, so the second call is a no-op
            // that still tells the worker it can stop retrying.
            //
            // The state has to be one a worker itself could have reported.
            // `abandoned` and `preempted` are the coordinator taking a lease
            // away, and a worker that comes back afterwards must be told to
            // abandon rather than handed a comfortable acknowledgement.
            const isReplay = attempt
                && Number(attempt.worker_id) === Number(workerId)
                && Number(attempt.lease_epoch) === Number(leaseEpoch)
                && RESULT_OUTCOMES.includes(attempt.state);

            if (isReplay) {
                const ack = await this.describeAttemptOutcome(attempt, transaction);
                await transaction.commit();

                return { action: 'continue', accepted: true, idempotent: true, ...ack };
            }

            const refusal = leaseRefusalReason(attempt, workerId, leaseEpoch);

            if (refusal) {
                await transaction.commit();
                return { action: 'abandon', accepted: false, idempotent: false, reason: refusal };
            }

            const [job] = await this.db.sequelize.query(
                'SELECT * FROM gpu_jobs WHERE id = :jobId FOR UPDATE',
                { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
            );

            let jobState = job.state;
            let published = false;
            let publishedAttemptId = job.published_attempt_id;
            let artifactsRecorded = 0;

            if (outcome === 'succeeded') {
                // The guard, and it has two halves. `published_attempt_id` being
                // null means nobody has published yet, so this attempt becomes
                // the answer; anything else means somebody already did, and this
                // attempt's own row still records that it succeeded while the
                // job keeps the first result.
                //
                // The second half is the job's own state. A job that was
                // cancelled, failed or expired stays that way: a worker
                // finishing just after a human said stop does not get to
                // resurrect it, because a job's state is the coordinator's
                // decision and not a race between the two. The bytes stay in
                // staging, so nothing is destroyed by that.
                const jobStillOpen = !TERMINAL_JOB_STATES.includes(job.state);

                if (publishedAttemptId === null && jobStillOpen) {
                    published = true;
                    publishedAttemptId = attempt.id;
                    jobState = 'succeeded';

                    await this.db.sequelize.query(
                        `UPDATE gpu_jobs
                            SET state = 'succeeded',
                                published_attempt_id = :attemptId,
                                updated_at = NOW(),
                                finished_at = NOW()
                          WHERE id = :jobId`,
                        { replacements: { attemptId: attempt.id, jobId: job.id }, transaction }
                    );

                    artifactsRecorded = await this.recordJobArtifacts({
                        job,
                        attempt,
                        artifacts: artifacts || [],
                        transaction,
                    });

                    // A training run ends when the job that opened it publishes.
                    // Left open, the dashboard cannot tell a run still going from
                    // one that finished three days ago.
                    await this.closeTrainingRun(job, transaction);
                } else {
                    await this.appendCoordinatorNote(
                        attempt.id,
                        {
                            note: 'result not published',
                            reason: publishedAttemptId === null
                                ? `the job was already ${job.state} when this attempt reported success`
                                : 'another attempt had already published this job',
                            job_state: job.state,
                            published_attempt_id: publishedAttemptId,
                        },
                        transaction
                    );
                }

                // `completed_through_frame` is recorded here too, not only on a
                // yield. A succeeded attempt that stopped short -- because the
                // video ran out, or for any other reason -- used to leave no
                // record of how far it actually got, so coverage computed from
                // `spec.range` called the video done. On this database that was
                // 3,042 succeeded attempts carrying nothing, against 7 yielded
                // ones that had it (#257).
                await this.db.sequelize.query(
                    `UPDATE gpu_job_attempts
                        SET state = 'succeeded',
                            completed_through_frame = COALESCE(:completedThroughFrame, completed_through_frame),
                            finished_at = NOW()
                      WHERE id = :attemptId`,
                    {
                        replacements: {
                            attemptId: attempt.id,
                            completedThroughFrame: completedThroughFrame === undefined ? null : completedThroughFrame,
                        },
                        transaction,
                    }
                );

                // Compare what the worker did against what it was asked to do,
                // here, where the evidence arrives. A succeeded attempt that
                // covered less than its range is not a failure -- a video
                // running out is the ordinary reason -- but it is the thing
                // nobody could see afterwards, and reconstructing it from a
                // query months later is how a half-done dive looks finished.
                const askedThrough = Number(job?.spec?.range?.end_frame);
                const shortBy = Number.isFinite(askedThrough) && completedThroughFrame !== null
                    && completedThroughFrame !== undefined
                    ? askedThrough - completedThroughFrame
                    : 0;

                if (shortBy > 0) {
                    await this.appendCoordinatorNote(
                        attempt.id,
                        {
                            note: 'succeeded short of its range',
                            asked_through_frame: askedThrough,
                            completed_through_frame: completedThroughFrame,
                            frames_short: shortBy,
                        },
                        transaction
                    );
                }
            } else if (outcome === 'failed') {
                const released = await this.endAttemptAndReleaseJob({
                    attempt,
                    job,
                    attemptState: 'failed',
                    failureReason: failureReason || 'The worker reported a failure without saying why.',
                    // Nothing to note: failure_reason on the attempt says it, and
                    // a note repeating it would only pad the event stream.
                    note: null,
                    // The frames it got through before it failed are real, and
                    // are the difference between "never started" and "got half
                    // way and died" (#257).
                    completedThroughFrame,
                    transaction,
                    finalState: 'failed',
                });

                jobState = released.jobState;
            } else if (outcome === 'yielded') {
                // An operator stopped this run part-way. The frames behind it are
                // real, so the attempt is kept and ingested like a success; the
                // rest of the range goes back to the pool for another machine.
                //
                // **`completed_through_frame` is an exclusive bound**, despite
                // the name: the worker computes `start_frame + frames_processed`,
                // which is one past the last frame it finished. That is the same
                // half-open convention as `spec.range.end_frame`, so it is
                // already exactly the frame a resumed lease should start at and
                // needs no adjustment here. Adding one would silently skip a
                // frame on every hand-over.
                await this.db.sequelize.query(
                    `UPDATE gpu_job_attempts
                        SET state = 'yielded',
                            completed_through_frame = :completedThroughFrame,
                            failure_reason = :failureReason,
                            finished_at = NOW()
                      WHERE id = :attemptId`,
                    {
                        replacements: {
                            attemptId: attempt.id,
                            completedThroughFrame: completedThroughFrame === undefined ? null : completedThroughFrame,
                            failureReason: failureReason || null,
                        },
                        transaction,
                    }
                );

                // A job that finished some other way while this attempt was
                // stopping keeps whatever it finished as, exactly as the expiry
                // path decides it.
                if (!TERMINAL_JOB_STATES.includes(job.state)) {
                    jobState = 'queued';

                    // `yields_made` rather than leaving `attempts_made` alone.
                    // `attempts_made` is also the lease epoch, so it has to go on
                    // counting every lease or two of them would share an epoch and
                    // the coordinator could not tell a stale worker from a current
                    // one. Counting yields separately is what lets the budget
                    // ignore them without touching that.
                    //
                    // `resume_from_frame` only moves forward. A worker that
                    // stopped before reaching the point an earlier one had already
                    // covered must not drag the job backwards and cause those
                    // frames to be run twice.
                    await this.db.sequelize.query(
                        `UPDATE gpu_jobs
                            SET state = 'queued',
                                yields_made = yields_made + 1,
                                resume_from_frame = GREATEST(
                                    COALESCE(:completedThroughFrame, resume_from_frame, 0),
                                    COALESCE(resume_from_frame, 0)
                                ),
                                updated_at = NOW(),
                                finished_at = NULL
                          WHERE id = :jobId`,
                        {
                            replacements: {
                                jobId: job.id,
                                completedThroughFrame: completedThroughFrame === undefined ? null : completedThroughFrame,
                            },
                            transaction,
                        }
                    );
                }

                await this.appendCoordinatorNote(
                    attempt.id,
                    {
                        note: 'attempt yielded',
                        completed_through_frame: completedThroughFrame === undefined ? null : completedThroughFrame,
                        job_state: jobState,
                    },
                    transaction
                );

                // The artifacts are recorded the same way a success's are: the
                // bytes exist, they belong to this job, and the next attempt adds
                // to them rather than replacing them.
                artifactsRecorded = await this.recordJobArtifacts({
                    job,
                    attempt,
                    artifacts: artifacts || [],
                    transaction,
                });
            } else {
                // Cancelled by the worker.
                //
                // This used to make the job `cancelled` on the reasoning that "a
                // worker that stops of its own accord and calls it cancelled is
                // saying the same thing" as a human cancelling. It is not the
                // same thing, and the difference is the whole of #257: a human
                // cancelling means nothing is missing, while a worker stopping
                // part-way leaves frames nobody did.
                //
                // Which one this is, is already knowable here. If the job is
                // *already* cancelled, this report is the human's decision
                // coming back round and the job stays cancelled. If it is not,
                // the worker stopped on its own and the job is `interrupted` --
                // the state that gets requeued.
                await this.db.sequelize.query(
                    `UPDATE gpu_job_attempts
                        SET state = 'cancelled',
                            completed_through_frame = COALESCE(:completedThroughFrame, completed_through_frame),
                            failure_reason = :failureReason,
                            finished_at = NOW()
                      WHERE id = :attemptId`,
                    {
                        replacements: {
                            attemptId: attempt.id,
                            failureReason: failureReason || null,
                            completedThroughFrame: completedThroughFrame === undefined ? null : completedThroughFrame,
                        },
                        transaction,
                    }
                );

                if (!TERMINAL_JOB_STATES.includes(job.state)) {
                    jobState = 'interrupted';

                    await this.db.sequelize.query(
                        // `interrupted` rather than `cancelled`, and it still
                        // finishes: the job stopped here and the frames it owed
                        // are requeued as new work rather than resumed in place,
                        // so `finished_at` means the same as it does for the
                        // cancel this used to be (#257, and #104's finish time).
                        "UPDATE gpu_jobs SET state = 'interrupted', updated_at = NOW(), finished_at = NOW() WHERE id = :jobId",
                        { replacements: { jobId: job.id }, transaction }
                    );
                }
            }

            await transaction.commit();

            return {
                action: 'continue',
                accepted: true,
                idempotent: false,
                outcome,
                job_id: job.id,
                job_state: jobState,
                published,
                published_attempt_id: publishedAttemptId,
                artifacts_recorded: artifactsRecorded,

                // Which attempt to ingest, rather than whether the job is
                // finished. A requeued job is finished by several attempts in
                // sequence and each carries its own observations, so the job can
                // no longer be the unit -- see `ingestAttempt`.
                attempt_id: attempt.id,
                ingestable: INGESTABLE_OUTCOMES.includes(outcome),
            };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    // -----------------------------------------------------------------
    // Artifact hand-off
    // -----------------------------------------------------------------

    /**
     * Give up a lease the coordinator could not make usable.
     *
     * The one caller is the poll handler, when the job's video cannot be resolved
     * into something a worker could open. The attempt has already been opened by
     * then -- it is opened in the same transaction that leases the job -- so the
     * choice is what to do with it, not whether it exists.
     *
     * It is failed rather than released, and that costs one of the job's
     * attempts on purpose. Putting the job back as though nothing had happened
     * would retry an unresolvable video forever and never show up anywhere; this
     * way it exhausts its attempts, lands `failed`, and every attempt row carries
     * the reason.
     *
     * @async
     * @param {Object} params
     * @param {number} params.attemptId - Attempt to end.
     * @param {string} params.failureReason - Why, recorded on the attempt.
     * @returns {Promise<Object|null>} `{attempt_id, job_id, job_state}`, or null
     * when the attempt has already gone.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async failAttemptUnresolved({ attemptId, failureReason }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const [attempt] = await this.db.sequelize.query(
                'SELECT * FROM gpu_job_attempts WHERE id = :attemptId FOR UPDATE',
                { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
            );

            if (!attempt) {
                await transaction.commit();
                return null;
            }

            const [job] = await this.db.sequelize.query(
                'SELECT * FROM gpu_jobs WHERE id = :jobId FOR UPDATE',
                { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
            );

            const { jobState } = await this.endAttemptAndReleaseJob({
                attempt,
                job,
                attemptState: 'failed',
                failureReason,
                note: { note: 'video could not be resolved for the lease', reason: failureReason },
                // `failed` rather than the default `expired`: nothing timed out,
                // the coordinator could not produce a spec a worker could run.
                finalState: 'failed',
                transaction,
            });

            await transaction.commit();

            return { attempt_id: attempt.id, job_id: attempt.job_id, job_state: jobState };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Look up a staged artifact by hash.
     *
     * A row means MARP holds those bytes, which is the whole answer the check
     * step needs.
     *
     * @async
     * @param {string} sha256 - Lower-case hex hash.
     * @returns {Promise<Object|null>} The staging row, or null.
     * @throws {Error} Re-throws any database failure.
     */
    async findStagedArtifact(sha256) {
        try {
            const staged = await this.db.gpu_artifacts_staging.findByPk(sha256);

            return staged ? staged.get({ plain: true }) : null;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Record that MARP now holds the bytes for a hash.
     *
     * Upserted rather than inserted, because a worker re-uploading something
     * already held is not an error -- addressing by content means the second copy
     * is the same copy. The `received_at` and `attempt_id` of the most recent
     * hand-off win.
     *
     * @async
     * @param {Object} params
     * @param {string} params.sha256 - Lower-case hex hash of the bytes.
     * @param {number} params.bytes - Size in bytes.
     * @param {string} [params.contentType] - MIME type as declared.
     * @param {number} [params.attemptId] - Attempt handing it over.
     * @returns {Promise<Object>} The staging row.
     * @throws {Error} Re-throws any database failure.
     */
    async recordStagedArtifact({ sha256, bytes, contentType, attemptId }) {
        try {
            const [row] = await this.db.sequelize.query(
                `INSERT INTO gpu_artifacts_staging (sha256, bytes, content_type, received_at, attempt_id)
                 VALUES (:sha256, :bytes, :contentType, NOW(), :attemptId)
                 ON CONFLICT (sha256) DO UPDATE
                    SET bytes = EXCLUDED.bytes,
                        content_type = COALESCE(EXCLUDED.content_type, gpu_artifacts_staging.content_type),
                        received_at = EXCLUDED.received_at,
                        attempt_id = COALESCE(EXCLUDED.attempt_id, gpu_artifacts_staging.attempt_id)
                 RETURNING *`,
                {
                    replacements: {
                        sha256,
                        bytes,
                        contentType: contentType || null,
                        attemptId: attemptId === undefined ? null : attemptId,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            return row;
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
    }

    // -----------------------------------------------------------------
    // Shared internals
    // -----------------------------------------------------------------

    /**
     * Append one coordinator note to an attempt's event stream.
     *
     * Notes take negative sequence numbers, counting down. A worker's own
     * sequence numbers start at zero and go up, so the two can never collide --
     * which matters because a collision would be silently swallowed by the
     * `ON CONFLICT DO NOTHING` that makes worker replay safe, and the losing side
     * would be whichever arrived second.
     *
     * @async
     * @param {number} attemptId - Attempt to note against.
     * @param {Object} payload - What to record.
     * @param {Object} transaction - Transaction to write in.
     * @returns {Promise<void>}
     */
    async appendCoordinatorNote(attemptId, payload, transaction) {
        await this.db.sequelize.query(
            `INSERT INTO gpu_job_events (attempt_id, seq, at, kind, payload)
             SELECT :attemptId,
                    LEAST(COALESCE(MIN(seq), 0), 0) - 1,
                    NOW(),
                    'note',
                    :payload
               FROM gpu_job_events
              WHERE attempt_id = :attemptId`,
            {
                replacements: { attemptId, payload: JSON.stringify(payload) },
                transaction,
            }
        );
    }

    /**
     * End an attempt badly and decide what that leaves the job as.
     *
     * Shared by the two paths that take a lease away -- a failure the worker
     * reported, and a cap the coordinator enforced -- because the decision after
     * either is the same one: back to the queue while attempts remain, and
     * finished otherwise.
     *
     * @async
     * @param {Object} params
     * @param {Object} params.attempt - The attempt row, already locked.
     * @param {Object} params.job - The job row, already locked.
     * @param {string} params.attemptState - Terminal state for the attempt.
     * @param {string} params.failureReason - Why.
     * @param {Object|null} params.note - Payload for a coordinator note, or null for none.
     * @param {string} [params.finalState] - What the job becomes when no attempts
     * remain. Defaults to `expired`, which is right for a lease taken back;
     * a reported failure passes `failed`.
     * @param {Object} params.transaction - Transaction to write in.
     * @returns {Promise<{jobState: string}>} What the job is now.
     */
    async endAttemptAndReleaseJob({
        attempt, job, attemptState, failureReason, note, finalState, transaction,
        completedThroughFrame,
    }) {
        // A failed attempt covered real frames before it failed, and that is
        // worth keeping: without it the only record of a half-done range is the
        // absence of a succeeded job over it, which cannot tell "never started"
        // from "got half way and died". COALESCE so a caller that has nothing
        // to report leaves whatever is already there (#257).
        await this.db.sequelize.query(
            `UPDATE gpu_job_attempts
                SET state = :attemptState,
                    failure_reason = :failureReason,
                    completed_through_frame = COALESCE(:completedThroughFrame, completed_through_frame),
                    finished_at = NOW()
              WHERE id = :attemptId`,
            {
                replacements: {
                    attemptId: attempt.id,
                    attemptState,
                    failureReason,
                    completedThroughFrame: completedThroughFrame === undefined ? null : completedThroughFrame,
                },
                transaction,
            }
        );

        if (note) {
            await this.appendCoordinatorNote(attempt.id, note, transaction);
        }

        let jobState = job.state;

        if (!TERMINAL_JOB_STATES.includes(job.state)) {
            jobState = attemptsSpent(job) < Number(job.max_attempts)
                ? 'queued'
                : (finalState || 'expired');

            await this.db.sequelize.query(
                `UPDATE gpu_jobs SET state = :jobState, updated_at = NOW(), ${FINISHED_AT_SQL} WHERE id = :jobId`,
                { replacements: { jobState, jobId: job.id }, transaction }
            );
        }

        return { jobState };
    }

    /**
     * Undo a published success whose data never reached the database (#225).
     *
     * `publishResult` has already set the attempt `succeeded` and the job with
     * it, because publishing and ingesting are two steps and only the first had
     * happened. When the second fails, that success is not true: *"if a job is
     * considered finished the api has actually ingested it's data, otherwise the
     * job isn't finished"* -- Isaac, 2026-09-19.
     *
     * So this is deliberately not `endAttemptAndReleaseJob`. That one refuses to
     * move a job already in a terminal state, which is right when a lease is
     * taken back from a job somebody else finished, and wrong here: the terminal
     * state it would be protecting is the very one being withdrawn.
     *
     * `published_attempt_id` is cleared for the same reason. It records which
     * attempt finished the job, and a retry has to be able to publish.
     *
     * The job goes back to the queue while attempts remain. Re-running costs GPU
     * time, and that is accepted rather than overlooked: an ingest that fails
     * means MARP does not have data it was supposed to have, and a retry is how
     * the system says so rather than filing the loss quietly.
     *
     * @async
     * @param {number} attemptId - The attempt whose ingest failed.
     * @param {string} reason - Why the ingest refused it.
     * @returns {Promise<{attemptState: string, jobState: string}|null>} What the
     * two are now, or null when the attempt has gone.
     */
    async failAttemptAfterIngest(attemptId, reason) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const [attempt] = await this.db.sequelize.query(
                'SELECT * FROM gpu_job_attempts WHERE id = :attemptId FOR UPDATE',
                { replacements: { attemptId }, type: QueryTypes.SELECT, transaction }
            );

            if (!attempt) {
                await transaction.rollback();

                return null;
            }

            const [job] = await this.db.sequelize.query(
                'SELECT * FROM gpu_jobs WHERE id = :jobId FOR UPDATE',
                { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
            );

            await this.db.sequelize.query(
                `UPDATE gpu_job_attempts
                    SET state = 'failed',
                        failure_reason = :reason,
                        finished_at = NOW()
                  WHERE id = :attemptId`,
                { replacements: { attemptId, reason }, transaction }
            );

            // A cancelled job stays cancelled: somebody stopped it deliberately
            // and a late ingest failure is not grounds to start it again.
            let jobState = job ? job.state : null;

            if (job && job.state !== 'cancelled') {
                jobState = attemptsSpent(job) < Number(job.max_attempts) ? 'queued' : 'failed';

                await this.db.sequelize.query(
                    `UPDATE gpu_jobs
                        SET state = :jobState,
                            published_attempt_id = CASE
                                WHEN published_attempt_id = :attemptId THEN NULL
                                ELSE published_attempt_id END,
                            updated_at = NOW(),
                            ${FINISHED_AT_SQL}
                      WHERE id = :jobId`,
                    { replacements: { jobState, jobId: job.id, attemptId }, transaction }
                );
            }

            await this.appendCoordinatorNote(
                attemptId,
                { note: 'attempt failed because its results were not ingested', reason, job_state: jobState },
                transaction
            );

            await transaction.commit();

            return { attemptState: 'failed', jobState };
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }

    /**
     * Claim an attempt for ingest, or refuse because somebody already has.
     *
     * One statement, and the `IS NULL` is the whole mechanism: PostgreSQL takes
     * a row lock for the `UPDATE`, so two results arriving for one attempt at the
     * same instant cannot both find it null. The loser updates nothing and is
     * told so by the row count.
     *
     * This replaces `gpu_jobs.published_attempt_id` as the ingest guard. That
     * column names one attempt and is written once, which was right while a job
     * had exactly one result and is wrong now that a stopped job is finished by
     * several in sequence.
     *
     * @async
     * @param {number} attemptId - The attempt to claim.
     * @returns {Promise<boolean>} True when this caller took the claim.
     * @throws {Error} Re-throws any database failure.
     */
    async claimAttemptForIngest(attemptId) {
        const [, result] = await this.db.sequelize.query(
            `UPDATE gpu_job_attempts
                SET ingested_at = NOW()
              WHERE id = :attemptId
                AND ingested_at IS NULL`,
            { replacements: { attemptId } }
        );

        // `rowCount` on postgres; the array form is the fallback other dialects
        // answer with, and this is the one place the difference would be silent.
        const changed = result && result.rowCount !== undefined
            ? result.rowCount
            : (Array.isArray(result) ? result.length : 0);

        return Number(changed) === 1;
    }

    /**
     * Give a claim back, for an ingest that did not happen after all.
     *
     * An attempt whose ingest threw, or which had nothing to ingest, has not been
     * ingested -- and leaving the stamp on it would make the recovery route
     * refuse to try again, which is the one job that route has.
     *
     * @async
     * @param {number} attemptId - The attempt to release.
     * @returns {Promise<void>}
     * @throws {Error} Re-throws any database failure.
     */
    async releaseAttemptIngestClaim(attemptId) {
        await this.db.sequelize.query(
            'UPDATE gpu_job_attempts SET ingested_at = NULL WHERE id = :attemptId',
            { replacements: { attemptId } }
        );
    }

    /**
     * Record the staged artifacts a successful attempt handed over, as rows in
     * the existing `artifacts` table.
     *
     * No new artifacts table: `artifacts` already models a tracked output file
     * and already has a `hash`. `training_run_id` is null here and `job_id` names
     * the job instead -- the pair that the migration made possible.
     *
     * Skips a hash **this attempt** already recorded under the same role, so a
     * replay that somehow reaches this far still cannot double-record.
     *
     * **Per attempt, not per job (#230).** It used to skip a hash already recorded
     * for the *job*, and a retry that reproduces its predecessor's output byte for
     * byte names the same hash. So the retry got no row, the ingest -- which reads
     * only the current attempt's artifacts -- found nothing, and a job whose first
     * attempt had failed honestly ended `succeeded` with nothing in the database:
     * 505 of them by 2026-09-20. A replay is the same attempt reporting twice; a
     * retry is a different attempt handing over the same bytes, and gets its own
     * row pointing at the same staged file.
     *
     * @async
     * @param {Object} params
     * @param {Object} params.job - The job row.
     * @param {Object} params.attempt - The attempt that produced them.
     * @param {Array<Object>} params.artifacts - `{sha256, role}` entries.
     * @param {Object} params.transaction - Transaction to write in.
     * @returns {Promise<number>} How many rows were written.
     */
    async recordJobArtifacts({ job, attempt, artifacts, transaction }) {
        let written = 0;

        for (const artifact of artifacts) {
            const role = artifact.role || 'result';

            const recorded = await this.db.artifacts.findAll({
                where: { job_id: job.id, hash: artifact.sha256, artifact_type: role },
                transaction,
            });

            // Only this attempt's own earlier row makes this a replay.
            const replay = recorded.some(
                (row) => row.metadata && Number(row.metadata.attempt_id) === Number(attempt.id)
            );

            if (replay) {
                continue;
            }

            const staged = await this.db.gpu_artifacts_staging.findByPk(artifact.sha256, { transaction });

            await this.db.artifacts.create(
                {
                    training_run_id: null,
                    job_id: job.id,
                    artifact_type: role,
                    // Relative to storage/, like a species picture's filename, so
                    // nothing recorded depends on where the API is deployed.
                    path: `${ARTIFACT_PATH_PREFIX}/${artifact.sha256}`,
                    size_mb: staged ? Number(staged.bytes) / (1024 * 1024) : null,
                    hash: artifact.sha256,
                    metadata: {
                        sha256: artifact.sha256,
                        role,
                        attempt_id: attempt.id,
                        worker_id: attempt.worker_id,
                        lease_epoch: attempt.lease_epoch,
                        content_type: staged ? staged.content_type : null,
                    },
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                { transaction }
            );

            written += 1;
        }

        return written;
    }

    /**
     * Describe how an attempt already ended, for a replayed terminal report.
     *
     * @async
     * @param {Object} attempt - The attempt row, already locked.
     * @param {Object} transaction - Transaction to read in.
     * @returns {Promise<Object>} The same fields a fresh result returns.
     */
    async describeAttemptOutcome(attempt, transaction) {
        const [job] = await this.db.sequelize.query(
            'SELECT * FROM gpu_jobs WHERE id = :jobId',
            { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
        );

        const [counted] = await this.db.sequelize.query(
            'SELECT COUNT(*)::int AS n FROM artifacts WHERE job_id = :jobId',
            { replacements: { jobId: attempt.job_id }, type: QueryTypes.SELECT, transaction }
        );

        return {
            outcome: attempt.state,
            job_id: job.id,
            job_state: job.state,
            published: Number(job.published_attempt_id) === Number(attempt.id),
            published_attempt_id: job.published_attempt_id,
            artifacts_recorded: counted.n,
        };
    }

    /**
     * Frame ranges over one video that are already waiting to be done.
     *
     * Coverage counts work that *finished*, so a range sitting in the queue is
     * not covered -- correctly, because nothing has processed it yet. It is
     * still not owed, though: somebody has already asked for it. Without this,
     * requeueing twice piles a second copy of every gap onto the pool, which a
     * test caught rather than a reading of the code (#257 R7).
     *
     * @async
     * @param {Object} params - Which video.
     * @param {string} [params.jellyfinItemId] - By Jellyfin item id.
     * @param {string} [params.sourceName] - By source name.
     * @param {number} [params.sessionId] - Narrow to one session.
     * @returns {Promise<Array<{start_frame: number, end_frame: number}>>}
     *   Ranges of jobs that are queued or leased, ascending.
     */
    async pendingRanges({ jellyfinItemId = null, sourceName = null, sessionId = null }) {
        const rows = await this.db.sequelize.query(
            `SELECT (spec->'range'->>'start_frame')::int AS start_frame,
                    (spec->'range'->>'end_frame')::int   AS end_frame
               FROM gpu_jobs
              WHERE kind = 'inference'
                AND state IN ('queued', 'leased')
                AND (:jellyfinItemId::text IS NULL
                     OR spec->'video'->>'jellyfin_item_id' = :jellyfinItemId)
                AND (:sourceName::text IS NULL
                     OR spec->'video'->>'source_name' = :sourceName)
                AND (:sessionId::int IS NULL
                     OR (spec->'session'->>'session_id')::int = :sessionId)
              ORDER BY start_frame`,
            {
                replacements: { jellyfinItemId, sourceName, sessionId },
                type: QueryTypes.SELECT,
            }
        );

        return rows.map((row) => ({
            start_frame: Number(row.start_frame),
            end_frame: Number(row.end_frame),
        }));
    }

    /**
     * Videos with work that was interrupted, and the spec to redo it from.
     *
     * Only `interrupted`. A `cancelled` job means a human changed their mind and
     * nothing is missing; a `failed` one has already been retried as far as
     * retrying is worth and waits for somebody to look at it (#257).
     *
     * The newest interrupted job per video supplies the spec a requeue copies --
     * its model, params and reduction -- because what is owed is the rest of
     * *that* work, not a fresh decision about how to do it.
     *
     * @async
     * @param {Object} [params] - Narrowing.
     * @param {string} [params.jellyfinItemId] - One video, by item id.
     * @param {string} [params.sourceName] - One video, by source name.
     * @returns {Promise<Array<Object>>} One row per video: its identity, the
     *   session, and the spec of the most recent interrupted job over it.
     */
    async interruptedWork({ jellyfinItemId = null, sourceName = null } = {}) {
        return this.db.sequelize.query(
            `SELECT DISTINCT ON (item_id, source_name, session_id)
                    item_id, source_name, session_id, spec, job_id
               FROM (
                     SELECT j.spec->'video'->>'jellyfin_item_id'    AS item_id,
                            j.spec->'video'->>'source_name'         AS source_name,
                            (j.spec->'session'->>'session_id')::int AS session_id,
                            j.spec                                  AS spec,
                            j.id                                    AS job_id,
                            j.created_at
                       FROM gpu_jobs j
                      WHERE j.kind = 'inference'
                        AND j.state = 'interrupted'
                        AND (:jellyfinItemId::text IS NULL
                             OR j.spec->'video'->>'jellyfin_item_id' = :jellyfinItemId)
                        AND (:sourceName::text IS NULL
                             OR j.spec->'video'->>'source_name' = :sourceName)
                   ) AS interrupted
              ORDER BY item_id, source_name, session_id, created_at DESC, job_id DESC`,
            {
                replacements: { jellyfinItemId, sourceName },
                type: QueryTypes.SELECT,
            }
        );
    }

    /**
     * The frame intervals actually covered for one video, merged.
     *
     * **Covered means a job reported covering it, never that a job asked to.**
     * A job submitted 0-60,000 that finished at 22,320 because the video ran out
     * covers 22,320 frames, and reading `spec.range` instead would call the
     * video done (#257).
     *
     * A job's coverage is `[spec.range.start_frame, max(completed_through_frame))`
     * across its attempts, and that is contiguous rather than a union of pieces:
     * a resumed lease starts at exactly where the last attempt stopped, so the
     * attempts of one job tile its range in order. Attempts carry no start frame
     * of their own, which is why this is computed per job.
     *
     * Merging is done here rather than in JavaScript because a long video split
     * into pieces is thousands of rows, and folding them in the database keeps
     * that out of the process.
     *
     * @async
     * @param {Object} params - Which video.
     * @param {string} [params.jellyfinItemId] - Jellyfin item id.
     * @param {string} [params.sourceName] - `video.source_name`, for a job that
     *   carried a bare url instead of an item id.
     * @param {number} [params.sessionId] - Narrow to one session. Omitted, every
     *   session's work over this video counts.
     * @returns {Promise<Array<{start_frame: number, end_frame: number, job_ids: Array<number>}>>}
     *   Merged covered intervals, ascending, half-open.
     */
    async coveredIntervals({ jellyfinItemId = null, sourceName = null, sessionId = null }) {
        // Islands and gaps. `runningMax` is the furthest any earlier job reached;
        // a job starting beyond it opens a new island, and the cumulative sum of
        // those breaks numbers the islands so they can be grouped.
        const rows = await this.db.sequelize.query(
            `WITH job_coverage AS (
                 SELECT j.id AS job_id,
                        (j.spec->'range'->>'start_frame')::int AS start_frame,
                        MAX(a.completed_through_frame)         AS end_frame
                   FROM gpu_jobs j
                   JOIN gpu_job_attempts a ON a.job_id = j.id
                  WHERE j.kind = 'inference'
                    AND a.completed_through_frame IS NOT NULL
                    AND (:jellyfinItemId::text IS NULL
                         OR j.spec->'video'->>'jellyfin_item_id' = :jellyfinItemId)
                    AND (:sourceName::text IS NULL
                         OR j.spec->'video'->>'source_name' = :sourceName)
                    AND (:sessionId::int IS NULL
                         OR (j.spec->'session'->>'session_id')::int = :sessionId)
                  GROUP BY j.id, start_frame
                 HAVING MAX(a.completed_through_frame) > (j.spec->'range'->>'start_frame')::int
             ),
             marked AS (
                 SELECT job_id, start_frame, end_frame,
                        CASE WHEN start_frame > MAX(end_frame) OVER (
                                 ORDER BY start_frame, end_frame
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                             ) THEN 1 ELSE 0 END AS opens_island
                   FROM job_coverage
             ),
             islands AS (
                 SELECT job_id, start_frame, end_frame,
                        SUM(opens_island) OVER (ORDER BY start_frame, end_frame) AS island
                   FROM marked
             )
             SELECT MIN(start_frame)::int        AS start_frame,
                    MAX(end_frame)::int          AS end_frame,
                    ARRAY_AGG(job_id ORDER BY job_id) AS job_ids
               FROM islands
              GROUP BY island
              ORDER BY start_frame`,
            {
                replacements: { jellyfinItemId, sourceName, sessionId },
                type: QueryTypes.SELECT,
            }
        );

        return rows.map((row) => ({
            start_frame: Number(row.start_frame),
            end_frame: Number(row.end_frame),
            job_ids: (row.job_ids || []).map(Number),
        }));
    }
}

module.exports = new GpuRepository();

/* The sort whitelist travels with the repository that applies it, so the
   service validates against the same list rather than a second copy of it. */
module.exports.JOB_SORT_COLUMNS = JOB_SORT_COLUMNS;
