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

const {
    LEASE_SECONDS,
    ATTEMPT_CAP_SECONDS,
    ARTIFACT_PATH_PREFIX,
    LIVE_ATTEMPT_STATES,
    TERMINAL_JOB_STATES,
    RESULT_OUTCOMES,
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
                        a.progress_done,
                        a.progress_total,
                        a.progress_unit,
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
     * List jobs, newest first.
     *
     * Ordered `created_at DESC, id DESC` -- the id tie-breaker is not decoration.
     * A batch's pieces are all inserted in the same statement and share a
     * `created_at` to the microsecond, so without it two pages of the same list
     * could show the same piece twice and miss another.
     *
     * @async
     * @param {Object} [filters]
     * @param {string} [filters.state] - Only jobs in this state.
     * @param {string} [filters.kind] - Only jobs of this kind.
     * @param {string} [filters.batchId] - Only jobs in this batch.
     * @param {number} [filters.limit] - Page size.
     * @param {number} [filters.offset] - Rows to skip.
     * @returns {Promise<{jobs: Array<Object>, total: number}>} The page, and how many matched in total.
     * @throws {Error} Re-throws any database failure.
     */
    async listJobs(filters = {}) {
        try {
            const where = {};

            if (filters.state) {
                where.state = filters.state;
            }

            if (filters.kind) {
                where.kind = filters.kind;
            }

            if (filters.batchId) {
                where.batch_id = filters.batchId;
            }

            const { rows, count } = await this.db.gpu_jobs.findAndCountAll({
                where,
                order: [['created_at', 'DESC'], ['id', 'DESC']],
                limit: filters.limit,
                offset: filters.offset,
            });

            return {
                jobs: rows.map((job) => job.get({ plain: true })),
                total: count,
            };
        } catch (error) {
            logger.error('Error::' + error);
            throw error;
        }
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
                    SET state = 'cancelled', updated_at = NOW()
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
                AND attempts_made < max_attempts
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
                        updated_at = NOW()
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
                    jobState = Number(job.attempts_made) < Number(job.max_attempts) ? 'queued' : 'expired';

                    await this.db.sequelize.query(
                        'UPDATE gpu_jobs SET state = :jobState, updated_at = NOW() WHERE id = :jobId',
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
     * @param {Object} [params.progress] - `{done, total, unit}`, overwritten in place.
     * @returns {Promise<Object>} `{action, reason, lease_expires_at, heartbeat_seconds, attempt}`.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async recordHeartbeat({ attemptId, workerId, leaseEpoch, state, progress }) {
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
                        progress_unit = COALESCE(:progressUnit, progress_unit)
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
     * @param {Array<Object>} params.events - `{seq, kind, at, payload}` entries.
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
    async publishResult({ attemptId, workerId, leaseEpoch, outcome, failureReason, artifacts }) {
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
                                updated_at = NOW()
                          WHERE id = :jobId`,
                        { replacements: { attemptId: attempt.id, jobId: job.id }, transaction }
                    );

                    artifactsRecorded = await this.recordJobArtifacts({
                        job,
                        attempt,
                        artifacts: artifacts || [],
                        transaction,
                    });
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

                await this.db.sequelize.query(
                    `UPDATE gpu_job_attempts
                        SET state = 'succeeded', finished_at = NOW()
                      WHERE id = :attemptId`,
                    { replacements: { attemptId: attempt.id }, transaction }
                );
            } else if (outcome === 'failed') {
                const released = await this.endAttemptAndReleaseJob({
                    attempt,
                    job,
                    attemptState: 'failed',
                    failureReason: failureReason || 'The worker reported a failure without saying why.',
                    // Nothing to note: failure_reason on the attempt says it, and
                    // a note repeating it would only pad the event stream.
                    note: null,
                    transaction,
                    finalState: 'failed',
                });

                jobState = released.jobState;
            } else {
                // Cancelled. The job is cancelled whether or not the cancel came
                // from a human -- a worker that stops of its own accord and calls
                // it cancelled is saying the same thing.
                await this.db.sequelize.query(
                    `UPDATE gpu_job_attempts
                        SET state = 'cancelled',
                            failure_reason = :failureReason,
                            finished_at = NOW()
                      WHERE id = :attemptId`,
                    {
                        replacements: { attemptId: attempt.id, failureReason: failureReason || null },
                        transaction,
                    }
                );

                if (!TERMINAL_JOB_STATES.includes(job.state)) {
                    jobState = 'cancelled';

                    await this.db.sequelize.query(
                        "UPDATE gpu_jobs SET state = 'cancelled', updated_at = NOW() WHERE id = :jobId",
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
    async endAttemptAndReleaseJob({ attempt, job, attemptState, failureReason, note, finalState, transaction }) {
        await this.db.sequelize.query(
            `UPDATE gpu_job_attempts
                SET state = :attemptState,
                    failure_reason = :failureReason,
                    finished_at = NOW()
              WHERE id = :attemptId`,
            {
                replacements: { attemptId: attempt.id, attemptState, failureReason },
                transaction,
            }
        );

        if (note) {
            await this.appendCoordinatorNote(attempt.id, note, transaction);
        }

        let jobState = job.state;

        if (!TERMINAL_JOB_STATES.includes(job.state)) {
            jobState = Number(job.attempts_made) < Number(job.max_attempts)
                ? 'queued'
                : (finalState || 'expired');

            await this.db.sequelize.query(
                'UPDATE gpu_jobs SET state = :jobState, updated_at = NOW() WHERE id = :jobId',
                { replacements: { jobState, jobId: job.id }, transaction }
            );
        }

        return { jobState };
    }

    /**
     * Record the staged artifacts a successful attempt handed over, as rows in
     * the existing `artifacts` table.
     *
     * No new artifacts table: `artifacts` already models a tracked output file
     * and already has a `hash`. `training_run_id` is null here and `job_id` names
     * the job instead -- the pair that the migration made possible.
     *
     * Skips a hash already recorded for this job under the same role, so a replay
     * that somehow reaches this far still cannot double-record.
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

            const existing = await this.db.artifacts.findOne({
                where: { job_id: job.id, hash: artifact.sha256, artifact_type: role },
                transaction,
            });

            if (existing) {
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
}

module.exports = new GpuRepository();
