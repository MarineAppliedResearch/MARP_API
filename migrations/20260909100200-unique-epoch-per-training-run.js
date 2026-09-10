/**
 * Adds `UNIQUE (training_run_id, epoch_number)` to `epochs`.
 *
 * Nothing stops the same epoch being recorded twice today, so a worker that
 * replays a batch of epoch rows -- after a network timeout it never saw the
 * answer to, say -- would double-insert them. Every other replay path in the
 * orchestration work is keyed against exactly this kind of accident, and epochs
 * were the one table where the key did not exist.
 *
 * Epochs belong to Milestone 2 and nothing in Milestone 1 writes one. The
 * constraint is here anyway because it is cheap now, it belongs with the
 * idempotency work, and the alternative is discovering the gap from duplicated
 * training curves later.
 *
 * Refs MarineAppliedResearch/marp-inference-worker#3.
 *
 * @fileoverview Migration adding the unique epoch-per-run constraint.
 * @author Isaac Travers
 * @module migrations/unique-epoch-per-training-run
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Name of the constraint, used by both directions.
 *
 * @constant
 * @type {string}
 */
const CONSTRAINT_NAME = 'epochs_training_run_id_epoch_number_unique';

/** @type {Object} */
module.exports = {
    /**
     * Adds the constraint, after saying plainly what is in the way if anything
     * is.
     *
     * The duplicate check comes first so a database that already holds two rows
     * for one epoch gets a message naming them rather than a bare constraint
     * violation. Which rows to keep is a question about the data and not one
     * this migration can answer on its own -- it deletes nothing.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the constraint exists.
     * @throws {Error} If duplicates already exist, or after rolling back on any
     * other failure.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['epochs', 'training_runs'],
                label: 'unique-epoch',
                work: async () => {
                    const duplicates = await sequelize.query(
                        `SELECT training_run_id, epoch_number, COUNT(*)::int AS n
                           FROM epochs
                          GROUP BY training_run_id, epoch_number
                         HAVING COUNT(*) > 1
                          ORDER BY 1, 2`,
                        { type: QueryTypes.SELECT, transaction }
                    );

                    if (duplicates.length > 0) {
                        const listed = duplicates
                            .slice(0, 20)
                            .map((row) => `run ${row.training_run_id} epoch ${row.epoch_number} (${row.n} rows)`)
                            .join(', ');

                        throw new Error(
                            `epochs already holds ${duplicates.length} duplicated (training_run_id, epoch_number) pair(s), `
                            + `so the unique constraint cannot be added: ${listed}. `
                            + 'Which of each pair to keep is a question about the data -- decide that first, by hand.'
                        );
                    }

                    await queryInterface.addConstraint('epochs', {
                        type: 'unique',
                        name: CONSTRAINT_NAME,
                        fields: ['training_run_id', 'epoch_number'],
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
     * Removes the constraint.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the constraint is gone.
     */
    async down(queryInterface) {
        await queryInterface.removeConstraint('epochs', CONSTRAINT_NAME);
    },
};
