'use strict';

/**
 * Removes dataset memberships whose observation no longer exists.
 *
 * `20260909120300-add-dataset-observations-observation-fk` adds the foreign key
 * with `ON DELETE CASCADE`: deleting an observation removes its memberships. Before
 * it existed, deletes left them behind. Production had 24 on 2026-10-06 -- Star1
 * (1), Star3 (2), CAMPA_GORGONIANS_1 (21) -- for observations deleted in October
 * 2025 and July 2026, and the foreign key refuses to be added over them.
 *
 * Decided 2026-10-06: remove them, which is what the cascade does to every delete
 * from now on. The observations were already gone; these rows pointed at nothing.
 * Each one is printed before it goes, so the upgrade log is the record.
 *
 * @fileoverview Removes dataset_observations rows that reference missing observations.
 * @author Isaac Travers
 * @module migrations/remove-orphaned-dataset-memberships
 */

const { QueryTypes } = require('sequelize');

module.exports = {
    /**
     * Prints and deletes every membership whose observation does not exist.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves once they are gone.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            const orphans = await sequelize.query(
                `SELECT dso.*, d.name AS dataset_name
                   FROM dataset_observations dso
                   LEFT JOIN datasets d ON d.id = dso.dataset_id
                  WHERE NOT EXISTS (SELECT 1 FROM observations o
                                     WHERE o.observation_id = dso.observation_id)
                  ORDER BY dso.dataset_id, dso.observation_id`,
                { type: QueryTypes.SELECT, transaction }
            );

            for (const row of orphans) {
                console.log(`[orphaned memberships] removing ${JSON.stringify(row)}`);
            }

            if (orphans.length > 0) {
                await sequelize.query(
                    'DELETE FROM dataset_observations WHERE id IN (:ids)',
                    { replacements: { ids: orphans.map((row) => row.id) }, transaction }
                );
            }

            console.log(`[orphaned memberships] ${orphans.length} removed.`);

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Nothing: the rows pointed at observations that no longer exist, and the
     * foreign key added next would refuse them back.
     *
     * @async
     * @returns {Promise<void>} Resolves immediately.
     */
    async down() {
        console.log('[orphaned memberships] down is a no-op; the removed rows are printed in the up log.');
    },
};
