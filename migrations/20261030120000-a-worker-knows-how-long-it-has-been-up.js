'use strict';

/**
 * A worker knows how long it has been up.
 *
 * **The Workers table's Uptime column has always said "not reported".** The worker's own
 * `resources.process.uptime_s` is not usable -- it read 4.8 s on a machine that had been
 * up for hours (#277) -- and nothing on MARP's side recorded it. MARP does not need to ask:
 * a machine checks in at least once a minute, so how long it has been up is how long it has
 * been checking in without a break.
 *
 * `gpu_workers.up_since` is the start of the current unbroken run of check-ins, where a
 * break is a silence longer than `WORKER_OFFLINE_SECONDS` (180 s). Every check-in keeps it,
 * or starts it again after a break. Backfilled here from `gpu_worker_samples`, which the
 * poll writes once a minute per machine: each worker gets the first sample of its latest
 * unbroken run.
 *
 * Adds a column and fills only that column, so nothing existing changes. `down` drops it.
 *
 * @fileoverview Migration adding gpu_workers.up_since and backfilling it.
 * @module migrations/a-worker-knows-how-long-it-has-been-up
 */

const { guardDataIntegrity } = require('../db/data-integrity');

/** A silence longer than this, in seconds, is a break. `WORKER_OFFLINE_SECONDS`. */
const BREAK_SECONDS = 180;

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'worker up_since',
                tables: ['gpu_workers'],
                work: async () => {
                    await queryInterface.addColumn('gpu_workers', 'up_since', {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'Start of the current unbroken run of check-ins; a silence over 180 s starts a new one.',
                    }, { transaction });

                    await queryInterface.sequelize.query(
                        `WITH stepped AS (
                             SELECT worker_id, at,
                                    at - lag(at) OVER (PARTITION BY worker_id ORDER BY at) AS gap
                               FROM gpu_worker_samples
                         ), starts AS (
                             SELECT worker_id, max(at) AS run_start
                               FROM stepped
                              WHERE gap IS NULL OR gap > (:breakSeconds * interval '1 second')
                              GROUP BY worker_id
                         )
                         UPDATE gpu_workers w
                            SET up_since = starts.run_start
                           FROM starts
                          WHERE starts.worker_id = w.id`,
                        { replacements: { breakSeconds: BREAK_SECONDS }, transaction }
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
        await queryInterface.removeColumn('gpu_workers', 'up_since');
    },
};
