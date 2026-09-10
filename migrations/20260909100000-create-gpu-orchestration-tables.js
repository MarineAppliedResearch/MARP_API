/**
 * Creates the five orchestration tables that make MARP_API the control plane for
 * GPU workers.
 *
 * Orchestration only. The ten existing ML tables already model datasets, runs,
 * epochs, hyperparameters, metrics and artifacts, and none of them is duplicated
 * here -- in particular there is no new artifacts table, because `artifacts`
 * already exists and already has a `hash`.
 *
 * **No table here can hold a worker's address.** There is no host, url, port or
 * hostname column anywhere in this migration, and that is the design rather than
 * an omission: a worker dials out, so push is unrepresentable rather than merely
 * unused. Adding such a column later would silently re-open it.
 *
 * Five tables and not six, twice over. Slots were going to be a table; a
 * `slot_count` on the worker plus a `slot_index` on the attempt says everything
 * Milestone 1 scheduling needs, and a table can arrive when multi-GPU placement
 * policy actually exists. Log lines were going to be their own table; a `kind`
 * on events costs nothing and keeps one ordered, replay-safe stream per attempt.
 *
 * A split video is N jobs sharing a `batch_id`, not one job with children. Each
 * piece leases, retries, fails and reports independently, which is what makes ten
 * workers on a ten-hour video straightforward.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#3.
 *
 * @fileoverview Migration creating gpu_workers, gpu_jobs, gpu_job_attempts, gpu_job_events and gpu_artifacts_staging.
 * @author Isaac Travers
 * @module migrations/create-gpu-orchestration-tables
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Worker lifecycle states. `paused` is how a machine is taken out of rotation
 * without un-enrolling it; a paused worker's running attempt is told to pause at
 * its next heartbeat.
 *
 * @constant
 * @type {Array<string>}
 */
const WORKER_STATES = ['online', 'offline', 'paused'];

/**
 * What a job can be. Milestone 1 only queues `inference` and `tracking`;
 * `training` and `diagnostic` are named now so the check constraint does not
 * have to be rewritten to accept them later.
 *
 * @constant
 * @type {Array<string>}
 */
const JOB_KINDS = ['inference', 'tracking', 'training', 'diagnostic'];

/**
 * Job states. `expired` is distinct from `failed`: nothing went wrong with the
 * work, the coordinator simply stopped hearing from every machine that tried it.
 *
 * @constant
 * @type {Array<string>}
 */
const JOB_STATES = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired'];

/**
 * Attempt states. The first four are a worker's own report of where it is; the
 * last five are terminal and only the coordinator writes them, because the
 * coordinator's row is the truth and a worker's report is evidence.
 *
 * @constant
 * @type {Array<string>}
 */
const ATTEMPT_STATES = [
    'assigned', 'preparing', 'running', 'uploading',
    'succeeded', 'failed', 'cancelled', 'preempted', 'abandoned',
];

/**
 * Event kinds. `metric` and `log` are what a worker sends; `note` is for
 * anything the coordinator itself records against an attempt, such as why a
 * lease was taken away.
 *
 * @constant
 * @type {Array<string>}
 */
const EVENT_KINDS = ['metric', 'log', 'note'];

/**
 * Render a value list as the inside of a SQL `IN (...)`.
 *
 * @param {Array<string>} values - Allowed values.
 * @returns {string} e.g. `'a', 'b'`.
 */
function quoted(values) {
    return values.map((value) => `'${value}'`).join(', ');
}

/** @type {Object} */
module.exports = {
    /**
     * Creates the five tables, their check constraints and their indexes.
     *
     * The one ordering subtlety is `gpu_jobs.published_attempt_id`, which points
     * at a table created after it. The column is created with the table and its
     * foreign key added afterwards -- an attempt cannot exist before a job
     * either, so one of the two references has to be added late whichever order
     * is chosen.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once every table exists.
     * @throws {Error} Re-throws after rolling back if creation fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                // The only pre-existing table these reference. Named so the guard
                // watches every foreign key in and out of it while five new tables
                // and one new reference to it appear alongside.
                tables: ['users'],
                label: 'gpu-orchestration',
                work: async () => {
                    await queryInterface.createTable(
                        'gpu_workers',
                        {
                            id: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                primaryKey: true,
                                autoIncrement: true,
                            },
                            name: {
                                type: Sequelize.STRING(255),
                                allowNull: false,
                                unique: true,
                                comment: 'What this machine calls itself. Unique, so a worker that restarts and enrols again is the same row rather than a second one.',
                            },
                            enrolled_at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                defaultValue: Sequelize.literal('NOW()'),
                                comment: 'When this machine first enrolled.',
                            },
                            last_seen_at: {
                                type: Sequelize.DATE,
                                allowNull: true,
                                comment: 'Coordinator clock reading at this worker\'s last poll or heartbeat. Null until it says something after enrolling.',
                            },
                            state: {
                                type: Sequelize.STRING(16),
                                allowNull: false,
                                defaultValue: 'online',
                                comment: `One of ${WORKER_STATES.join(', ')}.`,
                            },
                            slot_count: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                defaultValue: 1,
                                comment: 'How many attempts this machine will run at once. A count rather than a slots table, which is all Milestone 1 placement needs.',
                            },
                            worker_version: {
                                type: Sequelize.STRING(64),
                                allowNull: true,
                                comment: 'Version of the worker software, as it reported at enrolment.',
                            },
                            capabilities: {
                                type: Sequelize.JSONB,
                                allowNull: true,
                                comment: 'What the machine says it has: GPUs and VRAM, driver, disk, engines, ranges supported. Reported by the worker and not verified.',
                            },
                        },
                        { transaction }
                    );

                    await queryInterface.createTable(
                        'gpu_jobs',
                        {
                            id: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                primaryKey: true,
                                autoIncrement: true,
                            },
                            batch_id: {
                                type: Sequelize.UUID,
                                allowNull: true,
                                comment: 'Groups the pieces of one split video. Null for a job submitted on its own. The dashboard groups by this.',
                            },
                            kind: {
                                type: Sequelize.STRING(16),
                                allowNull: false,
                                comment: `One of ${JOB_KINDS.join(', ')}.`,
                            },
                            spec: {
                                type: Sequelize.JSONB,
                                allowNull: false,
                                comment: 'The whole of what to do: engine, model, video, frame range, params, reduction. A range is always present, even for a whole video, so nothing special-cases the undivided case.',
                            },
                            state: {
                                type: Sequelize.STRING(16),
                                allowNull: false,
                                defaultValue: 'queued',
                                comment: `One of ${JOB_STATES.join(', ')}. This row is the truth about the job; a worker's report is evidence.`,
                            },
                            priority: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                defaultValue: 0,
                                comment: 'Higher is claimed first.',
                            },
                            attempts_made: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                defaultValue: 0,
                                comment: 'How many times this job has been leased. Also the lease epoch of the current attempt, which is what makes a resurrected worker detectable.',
                            },
                            max_attempts: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                defaultValue: 3,
                                comment: 'After this many attempts a failure or expiry is final rather than requeued.',
                            },
                            published_attempt_id: {
                                type: Sequelize.INTEGER,
                                allowNull: true,
                                comment: 'The attempt whose result was recorded. Set once and never overwritten, which is what stops a second attempt replacing the first one\'s artifacts.',
                            },
                            created_by: {
                                type: Sequelize.INTEGER,
                                allowNull: true,
                                references: { model: 'users', key: 'user_id' },
                                // Who queued it is provenance, not a dependency.
                                onDelete: 'SET NULL',
                                onUpdate: 'CASCADE',
                                comment: 'User who submitted the job. Null when it was submitted by an application token rather than a person.',
                            },
                            created_at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                defaultValue: Sequelize.literal('NOW()'),
                            },
                            updated_at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                defaultValue: Sequelize.literal('NOW()'),
                            },
                        },
                        { transaction }
                    );

                    await queryInterface.createTable(
                        'gpu_job_attempts',
                        {
                            id: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                primaryKey: true,
                                autoIncrement: true,
                            },
                            job_id: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                references: { model: 'gpu_jobs', key: 'id' },
                                // An attempt is meaningless without its job.
                                onDelete: 'CASCADE',
                                onUpdate: 'CASCADE',
                                comment: 'The job this is an attempt at.',
                            },
                            worker_id: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                references: { model: 'gpu_workers', key: 'id' },
                                // Attempt history outlives a machine being removed,
                                // so removing one that has attempts is refused
                                // rather than quietly deleting them.
                                onDelete: 'RESTRICT',
                                onUpdate: 'CASCADE',
                                comment: 'The one machine that holds this attempt.',
                            },
                            slot_index: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                defaultValue: 0,
                                comment: 'Which of the worker\'s slots is running this, as the worker reported free at poll time.',
                            },
                            lease_epoch: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                comment: 'The job\'s attempt ordinal at the moment this lease was granted. Every state-changing call carries it, and a mismatch is answered with abandon.',
                            },
                            state: {
                                type: Sequelize.STRING(16),
                                allowNull: false,
                                defaultValue: 'assigned',
                                comment: `One of ${ATTEMPT_STATES.join(', ')}. Only the coordinator writes a terminal one.`,
                            },
                            leased_at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                defaultValue: Sequelize.literal('NOW()'),
                                comment: 'Coordinator clock reading when the lease was granted.',
                            },
                            lease_expires_at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                comment: 'When this lease stops being valid unless a heartbeat extends it. Judged on the coordinator\'s clock only.',
                            },
                            last_heartbeat_at: {
                                type: Sequelize.DATE,
                                allowNull: true,
                                comment: 'Coordinator clock reading at the last heartbeat. Null until the first one arrives.',
                            },
                            progress_done: {
                                type: Sequelize.INTEGER,
                                allowNull: true,
                                comment: 'Units finished. Small, and overwritten in place at every heartbeat -- durable numbers are appended as events instead.',
                            },
                            progress_total: {
                                type: Sequelize.INTEGER,
                                allowNull: true,
                                comment: 'Units expected in total.',
                            },
                            progress_unit: {
                                type: Sequelize.STRING(32),
                                allowNull: true,
                                comment: 'What a unit is, e.g. "frames".',
                            },
                            capabilities_snapshot: {
                                type: Sequelize.JSONB,
                                allowNull: true,
                                comment: 'What the machine said it had when it took this lease. Kept on the attempt because the worker row moves on and a result has to stay explainable.',
                            },
                            failure_reason: {
                                type: Sequelize.TEXT,
                                allowNull: true,
                                comment: 'Why this attempt ended badly, in the worker\'s words or the coordinator\'s.',
                            },
                            finished_at: {
                                type: Sequelize.DATE,
                                allowNull: true,
                                comment: 'When the attempt reached a terminal state, on the coordinator\'s clock.',
                            },
                        },
                        { transaction }
                    );

                    await queryInterface.createTable(
                        'gpu_job_events',
                        {
                            attempt_id: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                primaryKey: true,
                                references: { model: 'gpu_job_attempts', key: 'id' },
                                onDelete: 'CASCADE',
                                onUpdate: 'CASCADE',
                                comment: 'The attempt this event belongs to.',
                            },
                            seq: {
                                type: Sequelize.INTEGER,
                                allowNull: false,
                                primaryKey: true,
                                comment: 'The worker\'s own counter for this attempt. Half of the primary key, which is what makes a replayed batch harmless.',
                            },
                            at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                defaultValue: Sequelize.literal('NOW()'),
                                comment: 'When the worker says this happened. Evidence, not a clock anything is judged on.',
                            },
                            kind: {
                                type: Sequelize.STRING(16),
                                allowNull: false,
                                comment: `One of ${EVENT_KINDS.join(', ')}.`,
                            },
                            payload: {
                                type: Sequelize.JSONB,
                                allowNull: true,
                                comment: 'The metric, the log line, or the note.',
                            },
                        },
                        { transaction }
                    );

                    await queryInterface.createTable(
                        'gpu_artifacts_staging',
                        {
                            sha256: {
                                type: Sequelize.CHAR(64),
                                allowNull: false,
                                primaryKey: true,
                                comment: 'Hash of the bytes, lower-case hex. The primary key, because an artifact is addressed by what it is rather than by who sent it -- which is what makes the hand-off idempotent.',
                            },
                            bytes: {
                                type: Sequelize.BIGINT,
                                allowNull: false,
                                comment: 'Size of the file in bytes. The bytes themselves live under storage/gpu-artifacts/, not in the database.',
                            },
                            content_type: {
                                type: Sequelize.STRING(128),
                                allowNull: true,
                                comment: 'MIME type as the worker declared it.',
                            },
                            received_at: {
                                type: Sequelize.DATE,
                                allowNull: false,
                                defaultValue: Sequelize.literal('NOW()'),
                                comment: 'When the bytes finished arriving. A row exists only once they have, so its presence is the answer to "already have?".',
                            },
                            attempt_id: {
                                type: Sequelize.INTEGER,
                                allowNull: true,
                                references: { model: 'gpu_job_attempts', key: 'id' },
                                // Which attempt handed it over is provenance; the
                                // bytes stay addressable by hash regardless.
                                onDelete: 'SET NULL',
                                onUpdate: 'CASCADE',
                                comment: 'The attempt that handed these bytes over. Null once that attempt is gone.',
                            },
                        },
                        { transaction }
                    );

                    // The late half of the jobs/attempts cycle. Cleared rather than
                    // cascading, because losing an attempt row must not delete the
                    // job whose result it published.
                    await queryInterface.addConstraint('gpu_jobs', {
                        type: 'foreign key',
                        name: 'gpu_jobs_published_attempt_id_fkey',
                        fields: ['published_attempt_id'],
                        references: { table: 'gpu_job_attempts', field: 'id' },
                        onDelete: 'SET NULL',
                        onUpdate: 'CASCADE',
                        transaction,
                    });

                    // Every state column is a small closed vocabulary. Check
                    // constraints rather than Postgres enums, because adding a
                    // value to an enum type is its own migration and these
                    // vocabularies are still settling.
                    const checks = [
                        ['gpu_workers', 'gpu_workers_state_check', `state IN (${quoted(WORKER_STATES)})`],
                        ['gpu_jobs', 'gpu_jobs_kind_check', `kind IN (${quoted(JOB_KINDS)})`],
                        ['gpu_jobs', 'gpu_jobs_state_check', `state IN (${quoted(JOB_STATES)})`],
                        ['gpu_job_attempts', 'gpu_job_attempts_state_check', `state IN (${quoted(ATTEMPT_STATES)})`],
                        ['gpu_job_events', 'gpu_job_events_kind_check', `kind IN (${quoted(EVENT_KINDS)})`],
                        ['gpu_workers', 'gpu_workers_slot_count_check', 'slot_count > 0'],
                        ['gpu_jobs', 'gpu_jobs_max_attempts_check', 'max_attempts > 0'],
                        ['gpu_artifacts_staging', 'gpu_artifacts_staging_bytes_check', 'bytes >= 0'],
                        // Lower-case hex only, so two spellings of one hash cannot
                        // both exist and defeat addressing by content.
                        ['gpu_artifacts_staging', 'gpu_artifacts_staging_sha256_check', "sha256 ~ '^[0-9a-f]{64}$'"],
                    ];

                    for (const [table, name, expression] of checks) {
                        await sequelize.query(
                            `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression})`,
                            { transaction }
                        );
                    }

                    // One attempt per job per epoch. Belt and braces beside the
                    // claim transaction: even a bug in the claim cannot produce two
                    // live attempts at one job, because both would carry the same
                    // epoch.
                    await queryInterface.addIndex('gpu_job_attempts', ['job_id', 'lease_epoch'], {
                        name: 'gpu_job_attempts_job_epoch_unique',
                        unique: true,
                        transaction,
                    });

                    // The claim query's ordering: queued jobs, best priority first,
                    // oldest first within a priority.
                    await queryInterface.addIndex('gpu_jobs', ['state', 'priority', 'created_at'], {
                        name: 'gpu_jobs_claim_idx',
                        transaction,
                    });

                    // The dashboard's grouping.
                    await queryInterface.addIndex('gpu_jobs', ['batch_id'], {
                        name: 'gpu_jobs_batch_id_idx',
                        transaction,
                    });

                    // The expiry sweep: live attempts whose lease has run out.
                    await queryInterface.addIndex('gpu_job_attempts', ['state', 'lease_expires_at'], {
                        name: 'gpu_job_attempts_expiry_idx',
                        transaction,
                    });

                    // "What has this machine been doing", for the pool view.
                    await queryInterface.addIndex('gpu_job_attempts', ['worker_id'], {
                        name: 'gpu_job_attempts_worker_id_idx',
                        transaction,
                    });

                    // "What happened during this job".
                    await queryInterface.addIndex('gpu_job_attempts', ['job_id'], {
                        name: 'gpu_job_attempts_job_id_idx',
                        transaction,
                    });
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the five tables. Indexes and check constraints go with them.
     *
     * Dropped in reverse dependency order, with the jobs/attempts cycle broken
     * first so neither drop is blocked by the other's foreign key.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the tables are gone.
     * @throws {Error} Re-throws after rolling back if a drop fails.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeConstraint('gpu_jobs', 'gpu_jobs_published_attempt_id_fkey', { transaction });
            await queryInterface.dropTable('gpu_artifacts_staging', { transaction });
            await queryInterface.dropTable('gpu_job_events', { transaction });
            await queryInterface.dropTable('gpu_job_attempts', { transaction });
            await queryInterface.dropTable('gpu_jobs', { transaction });
            await queryInterface.dropTable('gpu_workers', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
