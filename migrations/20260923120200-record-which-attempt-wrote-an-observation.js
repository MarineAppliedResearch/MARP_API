/**
 * Adds `observations.gpu_attempt_id`, so an observation can be traced to the
 * settings it was produced under.
 *
 * `gpu_job_id` says which job, and that is not enough once a job's settings are
 * recorded per attempt. A job that is stopped and resumed holds observations from
 * several attempts, run on different machines and possibly different worker
 * versions whose defaults differ -- so `gpu_jobs.published_attempt_id`, which
 * names one attempt, would attribute every segment to that one's settings and be
 * wrong about the rest. The attempt is known at ingest, which already filters a
 * job's artifacts to the attempt handing them over; this keeps it.
 *
 * A nullable add with no default, so on PostgreSQL >= 11 it is a catalog change
 * rather than a rewrite of the table. **Nothing is backfilled**, settled on #232:
 * existing rows were written before any attempt recorded its settings, so there
 * is nothing true to point them at. Null means "not recorded", as it does for
 * `gpu_job_id` and `ml_model_id`.
 *
 * Refs MarineAppliedResearch/MARP_API#232.
 *
 * @fileoverview Migration adding observations.gpu_attempt_id.
 * @author Isaac Travers
 * @module migrations/record-which-attempt-wrote-an-observation
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/** @type {Object} */
module.exports = {
    /**
     * Adds the column and indexes it.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the column and its index exist.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            // Additive, so the guard should report one column and zero rows
            // changed. Running it anyway proves that rather than asserting it.
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'observations gpu_attempt_id',
                tables: ['observations', 'gpu_job_attempts'],
                work: async () => {
                    await queryInterface.addColumn(
                        'observations',
                        'gpu_attempt_id',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: true,
                            references: { model: 'gpu_job_attempts', key: 'id' },
                            // Keep the observation if the attempt record goes:
                            // which attempt produced it is provenance, not a
                            // dependency of the scientific record. Same as
                            // gpu_job_id.
                            onDelete: 'SET NULL',
                            onUpdate: 'CASCADE',
                            comment:
                                'The GPU job attempt whose result produced this observation, and so the settings it was produced under (gpu_attempt_settings). Null means no attempt recorded, which is every hand-entered row and every row ingested before attempts recorded their settings. A resumed job can hold observations from several attempts, which is why gpu_job_id alone is not enough.',
                        },
                        { transaction }
                    );

                    // Partial, like gpu_job_id's: null on every row that exists
                    // today, and indexing those buys nothing.
                    await sequelize.query(
                        `CREATE INDEX observations_gpu_attempt_id_idx
                             ON observations (gpu_attempt_id)
                          WHERE gpu_attempt_id IS NOT NULL`,
                        { transaction }
                    );

                    return null;
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the index and the column.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the column is gone.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query('DROP INDEX IF EXISTS observations_gpu_attempt_id_idx', {
                transaction,
            });
            await queryInterface.removeColumn('observations', 'gpu_attempt_id', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
