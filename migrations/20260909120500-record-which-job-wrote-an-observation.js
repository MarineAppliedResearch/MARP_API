/**
 * Adds `observations.gpu_job_id` and `observations.jellyfin_item_id`, the two
 * things a machine-written observation needs in order to be traceable.
 *
 * `ml_model_id` arrived with the mosaic work and says *which model*. That is not
 * enough on its own, because re-running inference over the same range is settled
 * as producing a **second set** of observations rather than replacing the first --
 * that is what keeps model-to-model comparison possible. Two sets from one model
 * are then indistinguishable without a job reference, and ingest cannot tell a
 * replayed terminal report (write nothing) from a deliberate re-run (write a new
 * set). Hence the column, and hence its index: "what did job 1256 produce" is the
 * question the ML dashboard asks first.
 *
 * `jellyfin_item_id` is the video reference the settled design puts on the
 * observation rather than on the session -- a session is a dive and a line and
 * may span several videos, so the video cannot live there. `video_source` already
 * holds the filename, which is what a person reads, but a filename is not an
 * identity: it is not unique across projects and it does not survive a rename.
 * The worker already carries the item id back out of the job spec for exactly
 * this purpose, as a key always present and null for a bare-url job, and without
 * somewhere to put it that provenance is discarded at ingest.
 *
 * Both are nullable adds with no default, so on PostgreSQL >= 11 they are catalog
 * changes rather than a rewrite of a 440,000-row table. Nothing is backfilled:
 * no observation in MARP was written by a GPU job, and no existing row has a
 * Jellyfin item recorded anywhere to backfill from. Null means "not recorded",
 * as it does for `ml_model_id`.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#3.
 *
 * @fileoverview Migration adding observations.gpu_job_id and observations.jellyfin_item_id.
 * @author Isaac Travers
 * @module migrations/record-which-job-wrote-an-observation
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/** @type {Object} */
module.exports = {
    /**
     * Adds both columns and indexes the job reference.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once both columns and the index exist.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            // Additive, so the guard should report two columns and zero rows
            // changed. Running it anyway proves that rather than asserting it.
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'observations gpu_job_id+jellyfin_item_id',
                tables: ['observations', 'gpu_jobs'],
                work: async () => {
                    await queryInterface.addColumn(
                        'observations',
                        'gpu_job_id',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: true,
                            references: { model: 'gpu_jobs', key: 'id' },
                            // Keep the observation if the job record goes: which
                            // run produced it is provenance, not a dependency of
                            // the scientific record. Same reasoning as
                            // ml_model_id.
                            onDelete: 'SET NULL',
                            onUpdate: 'CASCADE',
                            comment:
                                'The GPU job whose result produced this observation. Null means no job recorded, which is every hand-entered row. Re-running inference over the same range creates a second set of observations rather than replacing the first, so this is what distinguishes the sets -- and what lets ingest tell a replayed report from a deliberate re-run.',
                        },
                        { transaction }
                    );

                    await queryInterface.addColumn(
                        'observations',
                        'jellyfin_item_id',
                        {
                            type: Sequelize.STRING(255),
                            allowNull: true,
                            comment:
                                'The Jellyfin item the observation was made in, where there is one. The video reference belongs on the observation rather than the session, because a session is a dive and a line and may span several videos. Null for a video that did not come from Jellyfin, and for every row predating this column. video_source holds the filename a person reads; this holds the identity a request can use.',
                        },
                        { transaction }
                    );

                    // Indexed, unlike ml_model_id: "everything job N produced" is
                    // the ML dashboard's first question and is also how ingest
                    // checks whether it has already run for a job. Partial,
                    // because the column is null on every one of the 440,000 rows
                    // that exist today and indexing those buys nothing.
                    await sequelize.query(
                        `CREATE INDEX observations_gpu_job_id_idx
                             ON observations (gpu_job_id)
                          WHERE gpu_job_id IS NOT NULL`,
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
     * Drops the index and both columns.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once both columns are gone.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query('DROP INDEX IF EXISTS observations_gpu_job_id_idx', {
                transaction,
            });
            await queryInterface.removeColumn('observations', 'jellyfin_item_id', { transaction });
            await queryInterface.removeColumn('observations', 'gpu_job_id', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
