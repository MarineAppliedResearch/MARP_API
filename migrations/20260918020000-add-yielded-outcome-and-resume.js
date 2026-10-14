/**
 * A stopped job keeps its work and goes back to the pool.
 *
 * Four columns and one constraint, all in service of one behaviour: an operator
 * stops a run, what was processed is kept and ingested, and the remainder is
 * carried on by whichever machine polls next.
 *
 * The vocabulary is spelled out here rather than imported from
 * `config/gpu-orchestration.js`. That is the convention the original
 * orchestration migration set, and the reason is worth repeating: a migration
 * that reads the config silently rewrites itself when the config changes, so a
 * database built today and one built last month stop being the same database
 * with nothing to show for it. Spelled out, a divergence surfaces as a
 * constraint violation instead.
 *
 * Refs MarineAppliedResearch/MARP_API#197.
 * Refs MarineAppliedResearch/marp-inference-worker#20.
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * The attempt states after this migration. `yielded` joins the terminal group:
 * a worker stopped on purpose, part-way, with real work behind it.
 *
 * @constant
 * @type {Array<string>}
 */
const ATTEMPT_STATES_AFTER = [
    'assigned', 'preparing', 'running', 'uploading',
    'succeeded', 'failed', 'cancelled', 'preempted', 'abandoned', 'yielded',
];

/**
 * The same list as it stood before, for the down.
 *
 * @constant
 * @type {Array<string>}
 */
const ATTEMPT_STATES_BEFORE = ATTEMPT_STATES_AFTER.filter((state) => state !== 'yielded');

/**
 * Render a value list as the inside of a SQL `IN (...)`.
 *
 * @param {Array<string>} values - Allowed values.
 * @returns {string} e.g. `'a', 'b'`.
 */
function quoted(values) {
    return values.map((value) => `'${value}'`).join(', ');
}

module.exports = {
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['gpu_jobs', 'gpu_job_attempts'],
                label: 'yielded-outcome-and-resume',
                work: async () => {
                    await queryInterface.addColumn('gpu_job_attempts', 'completed_through_frame', {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Last frame this attempt actually finished. The worker computes it; a resumed job starts from it. Null when the attempt did not stop part-way.',
                    }, { transaction });

                    // Ingest moves from once-per-job to once-per-attempt. A job
                    // finished by three volunteers in sequence has three lots of
                    // observations to take, and `gpu_jobs.published_attempt_id`
                    // can only ever name one of them.
                    await queryInterface.addColumn('gpu_job_attempts', 'ingested_at', {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'When this attempt\'s observations were taken into the record. The ingest guard, which used to be the job\'s.',
                    }, { transaction });

                    await queryInterface.addColumn('gpu_jobs', 'resume_from_frame', {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Where the next lease starts, when an earlier attempt stopped part-way. Null means start from the range in `spec`, which is never rewritten.',
                    }, { transaction });

                    // `attempts_made` is two things at once: how much of the
                    // budget is spent, and the next lease epoch. A yield must not
                    // spend budget but must still advance the epoch, or two
                    // leases would share one and the coordinator could not tell
                    // them apart. So yields are counted separately and subtracted
                    // where the budget is judged, and `attempts_made` goes on
                    // meaning "leases granted" without exception.
                    await queryInterface.addColumn('gpu_jobs', 'yields_made', {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        defaultValue: 0,
                        comment: 'Leases that ended in a deliberate stop. Subtracted from attempts_made when judging the attempt budget, because a volunteer stopping is not a failure.',
                    }, { transaction });

                    // Plain SQL rather than `addConstraint`, which wants a
                    // `fields` list it then ignores for a check and refuses to
                    // run without. The clause is the whole point of this
                    // migration, so it is written as the clause it is.
                    await sequelize.query(
                        'ALTER TABLE gpu_job_attempts DROP CONSTRAINT gpu_job_attempts_state_check',
                        { transaction }
                    );
                    await sequelize.query(
                        `ALTER TABLE gpu_job_attempts ADD CONSTRAINT gpu_job_attempts_state_check
                         CHECK (state IN (${quoted(ATTEMPT_STATES_AFTER)}))`,
                        { transaction }
                    );
                },
            });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['gpu_jobs', 'gpu_job_attempts'],
                label: 'yielded-outcome-and-resume-down',
                work: async () => {
                    // Narrowing the constraint fails against any attempt already
                    // recorded as yielded, which is the truth about what happened
                    // and is not ours to rewrite silently. Those go back to
                    // `cancelled` first -- lossy, and the reason this down is a
                    // last resort rather than a routine reversal.
                    await sequelize.query(
                        "UPDATE gpu_job_attempts SET state = 'cancelled' WHERE state = 'yielded'",
                        { transaction }
                    );

                    await sequelize.query(
                        'ALTER TABLE gpu_job_attempts DROP CONSTRAINT gpu_job_attempts_state_check',
                        { transaction }
                    );
                    await sequelize.query(
                        `ALTER TABLE gpu_job_attempts ADD CONSTRAINT gpu_job_attempts_state_check
                         CHECK (state IN (${quoted(ATTEMPT_STATES_BEFORE)}))`,
                        { transaction }
                    );

                    await queryInterface.removeColumn('gpu_jobs', 'yields_made', { transaction });
                    await queryInterface.removeColumn('gpu_jobs', 'resume_from_frame', { transaction });
                    await queryInterface.removeColumn('gpu_job_attempts', 'ingested_at', { transaction });
                    await queryInterface.removeColumn('gpu_job_attempts', 'completed_through_frame', { transaction });
                },
            });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
