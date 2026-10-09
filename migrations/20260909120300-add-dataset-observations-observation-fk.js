/**
 * Gives `dataset_observations.observation_id` the foreign key it never had.
 *
 * The table has only ever been constrained on `dataset_id`, so the permanent
 * delete #68 settled would leave training-set membership rows pointing at
 * nothing -- scientific provenance referring to an observation that no longer
 * exists. This is #100.
 *
 * **`ON DELETE CASCADE`, decided against the recommendation and for a product
 * reason: a delete must not be blocked.** A reviewer in Delete Mode has decided
 * a record should go, and refusing them until somebody first unpicks a
 * training-set membership turns one gesture into a two-person errand.
 * `RESTRICT` was recommended because a published model's training-set
 * composition would otherwise silently shrink; that risk is real and is not
 * dismissed, it is accepted -- there is no deletion provenance record in MARP,
 * by decision, so a permanent delete leaves no trace anywhere and this is one
 * more thing it takes with it. If the loss starts to matter, the remedy is
 * Delete Mode refusing those rows, which is a product decision rather than a
 * constraint.
 *
 * **The cascade reaches the membership row and stops.** It lives on the join
 * table in both directions -- `dataset_observations_dataset_id_fkey` already
 * cascades from `datasets`, and this adds the matching action from
 * `observations` -- so deleting a dataset cannot delete its observations and
 * deleting an observation cannot delete a dataset. A wrong referential action
 * here is silent and would destroy scientific data, so
 * `tests/dataset-observations-cascade.test.js` proves all four facts against a
 * real database rather than reading them off `pg_constraint`, which only says
 * what was declared.
 *
 * Pre-existing orphans are counted and reported rather than guessed at or
 * cleaned up: a non-zero count aborts with the number in the message, because
 * that failure is information. Cleaning it up silently would be the loss the
 * constraint exists to prevent.
 *
 * No index is added. `dataset_observations_observation_id_idx` already exists.
 *
 * Refs #103, #100.
 *
 * @fileoverview Migration adding the dataset_observations to observations foreign key.
 * @author Isaac Travers
 * @module migrations/add-dataset-observations-observation-fk
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Constraint name, matching the convention the rest of the schema uses so a
 * later reader does not have to look it up.
 *
 * @constant
 * @type {string}
 */
const CONSTRAINT_NAME = 'dataset_observations_observation_id_fkey';

/** @type {Object} */
module.exports = {
    /**
     * Counts orphaned membership rows, aborts if there are any, then adds the
     * constraint and validates it.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the constraint exists and is valid.
     * @throws {Error} If any membership row points at a missing observation, or after rolling back on failure.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            // This is the one migration in the phase that touches an existing
            // table's constraints, so it is the one where the guard has
            // something real to protect.
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'dataset_observations observation fk',
                tables: ['dataset_observations', 'observations', 'datasets'],
                work: async () => {
                    const orphans = await sequelize.query(
                        `SELECT COUNT(*)::int AS n
                           FROM dataset_observations d
                          WHERE NOT EXISTS (
                                SELECT 1 FROM observations o
                                 WHERE o.observation_id = d.observation_id)`,
                        { type: QueryTypes.SELECT, transaction }
                    );

                    const orphanCount = orphans[0].n;

                    if (orphanCount > 0) {
                        // The count is the message. Somebody has to decide what
                        // those memberships meant before they are thrown away
                        // or repaired, and that is not a migration's decision.
                        throw new Error(
                            `${orphanCount} dataset_observations row(s) reference an observation that does not exist. `
                            + 'The foreign key cannot be added until somebody decides what those membership rows meant. '
                            + 'List them with: SELECT * FROM dataset_observations d WHERE NOT EXISTS '
                            + '(SELECT 1 FROM observations o WHERE o.observation_id = d.observation_id);'
                        );
                    }

                    console.log(
                        `[dataset_observations observation fk] 0 orphaned membership row(s); adding the constraint`
                    );

                    // Added NOT VALID and validated separately: the two-step is
                    // the right shape for a large table, because the validation
                    // scan then takes only SHARE UPDATE EXCLUSIVE. Sharing one
                    // transaction with the ADD means the locks are held to
                    // commit either way -- that is this repository's convention
                    // for an atomic `down`, and the statement shape is kept so
                    // it stays correct if the convention ever changes.
                    await sequelize.query(
                        `ALTER TABLE dataset_observations
                           ADD CONSTRAINT ${CONSTRAINT_NAME}
                           FOREIGN KEY (observation_id)
                           REFERENCES observations (observation_id)
                           ON DELETE CASCADE
                           ON UPDATE CASCADE
                           NOT VALID`,
                        { transaction }
                    );

                    await sequelize.query(
                        `ALTER TABLE dataset_observations
                           VALIDATE CONSTRAINT ${CONSTRAINT_NAME}`,
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
     * Drops the constraint, returning the column to being unconstrained.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the constraint is gone.
     */
    async down(queryInterface) {
        await queryInterface.sequelize.query(
            `ALTER TABLE dataset_observations DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`
        );
    },
};
