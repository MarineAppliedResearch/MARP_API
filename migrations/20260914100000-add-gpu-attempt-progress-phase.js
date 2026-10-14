/**
 * Adds the worker's current phase and elapsed time to an attempt's latest
 * progress snapshot. Existing attempts remain valid with NULL for both fields.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#10.
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['gpu_job_attempts'],
                label: 'gpu-attempt-progress-phase',
                work: async () => {
                    await queryInterface.addColumn('gpu_job_attempts', 'progress_phase', {
                        type: Sequelize.STRING(64),
                        allowNull: true,
                        comment: 'Current worker-defined phase within this job type.',
                    }, { transaction });
                    await queryInterface.addColumn('gpu_job_attempts', 'progress_elapsed_s', {
                        type: Sequelize.DOUBLE,
                        allowNull: true,
                        comment: 'Worker-reported seconds elapsed since this attempt started.',
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
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['gpu_job_attempts'],
                label: 'gpu-attempt-progress-phase-down',
                work: async () => {
                    await queryInterface.removeColumn(
                        'gpu_job_attempts', 'progress_elapsed_s', { transaction }
                    );
                    await queryInterface.removeColumn(
                        'gpu_job_attempts', 'progress_phase', { transaction }
                    );
                },
            });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
