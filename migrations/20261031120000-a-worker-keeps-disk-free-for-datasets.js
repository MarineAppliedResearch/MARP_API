'use strict';

/**
 * A worker keeps disk free for datasets, and can be asked to clear its cache.
 *
 * #320. A worker caches every training dataset it fetches -- 20 GB for the largest so far
 * -- and nothing ever removed one. It now evicts its least-recently-used datasets to keep
 * a floor of free disk, which Isaac settled on 2026-10-31 at 50 GB and adjustable per
 * worker. The floor is MARP's to hold rather than the machine's, so it can be changed
 * without touching a volunteer's computer.
 *
 * - `dataset_keep_free_bytes`: the floor for this machine. Null means the default
 *   (`DEFAULT_DATASET_KEEP_FREE_BYTES`), so changing the default changes every worker
 *   nobody has set.
 * - `clear_dataset_cache_requested_at`: set when somebody asks for the cache to be
 *   cleared, and cleared again when the next poll carries the request to the machine.
 *
 * Adds two nullable columns and fills neither, so nothing existing changes. `down` drops
 * them.
 *
 * @fileoverview Migration adding a worker's dataset cache floor and clear request.
 * @module migrations/a-worker-keeps-disk-free-for-datasets
 */

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'worker dataset cache floor',
                tables: ['gpu_workers'],
                work: async () => {
                    await queryInterface.addColumn('gpu_workers', 'dataset_keep_free_bytes', {
                        type: Sequelize.BIGINT,
                        allowNull: true,
                        comment: 'Free disk this machine keeps by evicting cached datasets; null is the default.',
                    }, { transaction });

                    await queryInterface.addColumn('gpu_workers', 'clear_dataset_cache_requested_at', {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'When clearing the dataset cache was asked for; null once the machine has been told.',
                    }, { transaction });
                },
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
            await queryInterface.removeColumn('gpu_workers', 'clear_dataset_cache_requested_at', { transaction });
            await queryInterface.removeColumn('gpu_workers', 'dataset_keep_free_bytes', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
