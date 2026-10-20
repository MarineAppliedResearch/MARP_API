'use strict';

/**
 * Lets a training run say which GPU job produced it.
 *
 * `training_runs` predates distributed compute: it describes a run that somebody
 * started on their own machine from the legacy script, so it names a model and a
 * dataset and nothing about who ran it. Now a run is a job the pool executes, and
 * there is no way to get from the job to the run it opened -- which means no way
 * to write the second epoch of a run without having kept the id in memory since
 * the first.
 *
 * `artifacts` already went this way for the same reason: migration
 * `20260909100100-allow-artifacts-without-a-training-run` added `job_id` beside
 * `training_run_id` so a result could belong to either. This is the other half
 * of that idea -- the run itself pointing at the job.
 *
 * Nullable, because a training run started by hand has no job and that is not an
 * error. `ON DELETE SET NULL` for the same reason: deleting a job must not take
 * the scientific record of what it trained with it.
 *
 * No `guardDataIntegrity`: one nullable column, no backfill, nothing re-inserted
 * and no existing reference touched.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#67.
 *
 * @fileoverview Migration adding training_runs.job_id.
 * @author Isaac Travers
 * @module migrations/a-training-run-knows-its-job
 */

/** @type {Object} */
module.exports = {
    /**
     * Adds the nullable `job_id` and its index.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @param {Object} Sequelize - Sequelize data types.
     * @returns {Promise<void>} Resolves when the column exists.
     */
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('training_runs', 'job_id', {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'gpu_jobs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
                comment:
                    'The GPU job that produced this run, when one did. NULL for a run '
                    + 'started by hand outside the pool, which is not an error.',
            }, { transaction });

            // Every epoch written during a run looks this up, so it is the one
            // index that is not optional.
            await queryInterface.addIndex('training_runs', ['job_id'], {
                name: 'training_runs_job_id_idx',
                transaction,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the index and the column.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when they are gone.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeIndex('training_runs', 'training_runs_job_id_idx', { transaction });
            await queryInterface.removeColumn('training_runs', 'job_id', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
