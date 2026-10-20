'use strict';

/**
 * Records which kind of work a GPU reading was taken during (#104).
 *
 * The Workers and Dashboard charts are specified to show how the pool's compute divides
 * between inference and training. `gpu_worker_samples` could say how hard a card was
 * working and not what it was working on, so that split could not be drawn.
 *
 * **Denormalised deliberately.** The sample already names its attempt, and the attempt names
 * a job that knows its kind, so this could be two joins at read time instead of a column.
 * It is a column because:
 *
 * - `attempt_id` is `ON DELETE SET NULL` -- a reading is a fact about the machine and
 *   outlives the job that happened to be running. Joining through it would make the split
 *   silently disappear from history as old jobs are cleared, which is the worst way for a
 *   chart to be wrong.
 * - a sample is a time-series row: what was true when it was taken is the thing worth
 *   keeping, not what a join says is true now.
 *
 * Nullable, because a reading can arrive without one: an older worker, or a heartbeat whose
 * attempt the coordinator has already closed. Null means "not known", not "no work".
 *
 * Existing rows keep null rather than being guessed at from their attempt. The backfill
 * would be one join and would be wrong in exactly the case the column exists for -- a
 * reading whose attempt has since been nulled -- and a column that is partly inferred is
 * worse than one that is honestly empty for a fortnight.
 *
 * @fileoverview Migration adding gpu_worker_samples.job_kind.
 * @author Isaac Travers
 * @module migrations/a-gpu-reading-knows-what-work-it-was-doing
 */

/** @type {Object} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('gpu_worker_samples', 'job_kind', {
                type: Sequelize.STRING(16),
                allowNull: true,
                comment: 'The kind of job running when this reading was taken: inference, tracking, training or diagnostic. Null when it was not known.',
            }, { transaction });

            // Every read of this is "the pool over a window, split by kind".
            await queryInterface.addIndex('gpu_worker_samples', ['at', 'job_kind'], {
                name: 'gpu_worker_samples_at_kind_idx',
                transaction,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeIndex('gpu_worker_samples', 'gpu_worker_samples_at_kind_idx', { transaction });
            await queryInterface.removeColumn('gpu_worker_samples', 'job_kind', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
