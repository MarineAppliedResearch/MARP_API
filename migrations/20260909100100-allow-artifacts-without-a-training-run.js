/**
 * Lets an artifact belong to a GPU job instead of a training run.
 *
 * `artifacts.training_run_id` is `NOT NULL` today, which means an inference
 * result has nowhere to be recorded: there is no training run behind it and
 * inventing one would put a row in `training_runs` that describes no training.
 * So the column becomes nullable and a `job_id` arrives beside it.
 *
 * A check constraint keeps the pair honest: an artifact belongs to a training
 * run or to a job, and never to neither. Without it, nulling both would produce
 * an artifact row that nothing can find and nothing owns. Every existing row has
 * a `training_run_id` -- the column was `NOT NULL` until this migration -- so the
 * constraint is satisfied by everything already there.
 *
 * No new artifacts table. `artifacts` already exists and already has a `hash`,
 * which is exactly what a hand-off addressed by sha256 needs.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#3.
 *
 * @fileoverview Migration making artifacts.training_run_id nullable and adding artifacts.job_id.
 * @author Isaac Travers
 * @module migrations/allow-artifacts-without-a-training-run
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/** @type {Object} */
module.exports = {
    /**
     * Drops the `NOT NULL`, adds `job_id` and its foreign key, and adds the
     * check constraint that requires one owner or the other.
     *
     * The nullability change is raw SQL rather than `changeColumn`, because
     * `changeColumn` rewrites the whole column definition from what it is given
     * and would have to be told about the type and the existing foreign key to
     * avoid quietly changing them.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the column is nullable and job_id exists.
     * @throws {Error} Re-throws after rolling back if anything fails, including
     * the integrity guard finding lost rows.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['artifacts', 'training_runs'],
                label: 'artifacts-job-id',
                work: async () => {
                    await sequelize.query(
                        'ALTER TABLE "artifacts" ALTER COLUMN "training_run_id" DROP NOT NULL',
                        { transaction }
                    );

                    await queryInterface.addColumn(
                        'artifacts',
                        'job_id',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: true,
                            references: { model: 'gpu_jobs', key: 'id' },
                            // Refused rather than cleared. `SET NULL` would try
                            // to null the only owner this row has, which the
                            // check constraint below then refuses anyway -- so
                            // the same deletion fails either way, and this way it
                            // fails saying what is actually wrong: a result
                            // cannot outlive the record of what produced it.
                            onDelete: 'RESTRICT',
                            onUpdate: 'CASCADE',
                            comment: 'The GPU job that produced this artifact (gpu_jobs.id). Null for anything produced by a training run rather than a job.',
                        },
                        { transaction }
                    );

                    await sequelize.query(
                        `ALTER TABLE "artifacts"
                         ADD CONSTRAINT "artifacts_owner_check"
                         CHECK ("training_run_id" IS NOT NULL OR "job_id" IS NOT NULL)`,
                        { transaction }
                    );

                    // Every "what did this job produce" lookup.
                    await queryInterface.addIndex('artifacts', ['job_id'], {
                        name: 'artifacts_job_id_idx',
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
     * Puts the `NOT NULL` back and removes `job_id`.
     *
     * Reversing this cannot keep an inference artifact: such a row has no
     * training run, so restoring the `NOT NULL` would fail while one exists.
     * Rows owned only by a job are therefore deleted first, which is declared to
     * the integrity guard rather than hidden from it -- there is no way to
     * reverse the migration and keep them, and failing to say so would make the
     * guard the thing that blocks a rollback.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the column is required again.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['artifacts', 'training_runs'],
                mayShrink: ['artifacts'],
                label: 'artifacts-job-id-down',
                work: async () => {
                    await sequelize.query(
                        'DELETE FROM "artifacts" WHERE "training_run_id" IS NULL',
                        { transaction }
                    );

                    await sequelize.query(
                        'ALTER TABLE "artifacts" ALTER COLUMN "training_run_id" SET NOT NULL',
                        { transaction }
                    );
                },
            });

            // Removing the column happens outside the guard, though still inside
            // this transaction. The guard discovers foreign keys once, up front,
            // and then counts them again afterwards -- so a migration that
            // removes a column the guard is watching makes the second count fail
            // on a column that is no longer there. Dropping a column cannot lose a
            // row, which is the thing the guard exists to catch, so the row loss
            // above is what it wraps.
            await sequelize.query(
                'ALTER TABLE "artifacts" DROP CONSTRAINT IF EXISTS "artifacts_owner_check"',
                { transaction }
            );
            await queryInterface.removeIndex('artifacts', 'artifacts_job_id_idx', { transaction });
            await queryInterface.removeColumn('artifacts', 'job_id', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
