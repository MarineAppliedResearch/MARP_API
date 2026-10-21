/**
 * Gives a thumbnail row its own record of how often the **sweeper** has offered it
 * and when it last did, separately from what a reviewer asked for.
 *
 * **Why two new columns rather than the two that look like they would do.** The
 * sweeper's rule is "retry a transient failure, with a growing wait, until a cap"
 * (#121 A1), and the row already carries `attempts` and `completed_at`. Neither
 * says what the rule needs:
 *
 * - `attempts` is incremented by `claimBatch` on **every** claim, including the
 *   one a reviewer caused by pressing *Ask again*. Capping on it would mean a row
 *   a reviewer took an interest in exhausts its background budget faster than one
 *   nobody has looked at -- exactly backwards.
 * - `completed_at` is "when extraction last finished", and is written by the
 *   reviewer path too. A backoff computed from it restarts its clock whenever
 *   somebody presses the button, so the wait never grows.
 *
 * So the background cadence gets its own two columns and the reviewer path is left
 * alone. `requeue()` deliberately does **not** write them: a reviewer asking again
 * is not the sweeper trying again, and a person must always be able to ask even
 * for a row the sweeper has given up on (#121 R4).
 *
 * No data is transformed. Both columns are operational state on a cache table --
 * every byte they describe is re-derivable -- so this does not go through
 * `db/data-integrity.js`, for the same reason
 * `20260913210000-add-review-imagery-cache.js` does not.
 *
 * Refs #121, MarineAppliedResearch/MARP_API#118.
 *
 * @fileoverview Migration adding the sweeper's own retry bookkeeping.
 * @author Isaac Travers
 * @module migrations/a-thumbnail-remembers-its-own-retries
 */

'use strict';

module.exports = {
    /**
     * Adds the two columns and the partial index the sweep query scans.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once both columns exist.
     * @throws {Error} Re-throws after rolling back if the change fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.addColumn('observation_thumbnails', 'sweep_attempts', {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: 'How many times the background sweeper has re-queued this row. Separate from `attempts`, which counts every claim including a reviewer\'s. Both the backoff and the cap are computed from this.',
            }, { transaction });

            await queryInterface.addColumn('observation_thumbnails', 'swept_at', {
                type: Sequelize.DATE,
                allowNull: true,
                comment: 'When the sweeper last re-queued this row, or null if it never has. The backoff is measured from here rather than from completed_at, which a reviewer pressing Ask again would otherwise keep resetting.',
            }, { transaction });

            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_sweep_attempts_check
                   CHECK (sweep_attempts >= 0)`,
                { transaction }
            );

            // The sweep's only scan. Partial on exactly the rows it can act on --
            // a transient failure that has not been evicted -- because those are a
            // small fraction of the table and the whole point is that the pass is
            // cheap enough to run on a timer forever.
            //
            // Built inside the transaction rather than CONCURRENTLY. The predicate
            // is narrow (3,605 of 114,924 rows on the development corpus when this
            // was written) so the build is quick, and the alternative is a
            // non-transactional migration, which is a much bigger thing to be than
            // this needs.
            await sequelize.query(
                `CREATE INDEX observation_thumbnails_sweepable_idx
                   ON observation_thumbnails (swept_at NULLS FIRST, observation_id)
                   WHERE status = 'failed'
                     AND permanent = false
                     AND thumbnail_evicted_at IS NULL`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the index, the constraint and both columns.
     *
     * Nothing is lost that was not re-derivable: a row whose sweep bookkeeping goes
     * away is simply a row the sweeper has never offered, which is where every row
     * started.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once both columns are gone.
     * @throws {Error} Re-throws after rolling back if the change fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                'DROP INDEX IF EXISTS observation_thumbnails_sweepable_idx',
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   DROP CONSTRAINT IF EXISTS observation_thumbnails_sweep_attempts_check`,
                { transaction }
            );
            await queryInterface.removeColumn('observation_thumbnails', 'swept_at', { transaction });
            await queryInterface.removeColumn('observation_thumbnails', 'sweep_attempts', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
