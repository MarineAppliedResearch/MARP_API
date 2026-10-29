'use strict';

/**
 * An attempt's progress can count past two billion.
 *
 * **A 20 GB dataset could not be trained on, and the screen never said why.** A training
 * attempt reports its dataset download in bytes, and `gpu_job_attempts.progress_done` and
 * `progress_total` were 32-bit, so the first heartbeat past 2,147,483,647 bytes -- the
 * archive's own size, sent as the total on the first one -- failed with *integer out of
 * range*. The heartbeat rolled back, the lease was never extended, and the coordinator
 * expired the attempt as having sent no heartbeat at all, which is the opposite of what
 * happened: it sent one every five seconds. Seen on job 21953, *WpFeCec*, training on
 * dataset 391 (20,126,426,112 bytes). Smaller archives trained, which is why it went
 * unseen until a dataset passed 2 GB.
 *
 * `gpu_attempt_progress`, the per-minute history of the same two numbers, was already
 * BIGINT; only the attempt's own copy was not.
 *
 * Lossless: every value an INTEGER holds is a BIGINT. `down` narrows it again, and refuses
 * rather than truncates if any attempt has since counted past the old ceiling.
 *
 * @fileoverview Migration widening an attempt's progress counts to BIGINT.
 * @module migrations/an-attempt-can-count-past-two-billion
 */

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'attempt progress to bigint',
                tables: ['gpu_job_attempts'],
                work: async () => {
                    for (const column of ['progress_done', 'progress_total']) {
                        await queryInterface.changeColumn('gpu_job_attempts', column, {
                            type: Sequelize.BIGINT,
                            allowNull: true,
                        }, { transaction });
                    }
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface, Sequelize) {
        const [[{ over }]] = await queryInterface.sequelize.query(
            `SELECT COUNT(*)::int AS over FROM gpu_job_attempts
              WHERE progress_done > 2147483647 OR progress_total > 2147483647`
        );

        if (over > 0) {
            throw new Error(`${over} attempt(s) count past 2,147,483,647; narrowing would lose them.`);
        }

        for (const column of ['progress_done', 'progress_total']) {
            await queryInterface.changeColumn('gpu_job_attempts', column, { type: Sequelize.INTEGER, allowNull: true });
        }
    },
};
