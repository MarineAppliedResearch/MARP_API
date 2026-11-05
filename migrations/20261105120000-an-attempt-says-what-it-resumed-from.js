'use strict';

/**
 * An attempt says which checkpoint it resumed from.
 *
 * #319. A training run that is paused or fails part way leaves a checkpoint, and the
 * next attempt carries on from it rather than from epoch 0. A checkpoint can be the
 * cause of the failure, though, and then every retry would load it and fail the same
 * way. The lease records the checkpoint it handed out here, so a checkpoint an attempt
 * resumed from and then failed on is not handed out again.
 *
 * Adds one nullable column and changes no row. `down` drops it.
 *
 * @fileoverview Migration adding gpu_job_attempts.resumed_from_sha256.
 * @module migrations/an-attempt-says-what-it-resumed-from
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('gpu_job_attempts', 'resumed_from_sha256', {
            type: Sequelize.STRING(64),
            allowNull: true,
            comment: 'The checkpoint this attempt was handed to resume training from (#319); null when it started from the beginning.',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('gpu_job_attempts', 'resumed_from_sha256');
    },
};
