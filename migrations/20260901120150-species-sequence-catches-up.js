'use strict';

/**
 * Move `species_id_seq` up to the table before the species list import inserts.
 *
 * Production's species rows were inserted with explicit ids, so its sequence never
 * moved: on the 2026-10-06 production copy the highest id is 944 and the sequence
 * stands at 478. `20260901120200-import-species-lists` takes new ids from the
 * sequence, so its first insert asked for 479 -- already "Stichopathes sp." -- and
 * the whole upgrade stopped there. The development databases never showed it,
 * because they were built from the baseline, whose sequence matches its rows.
 *
 * Numbered to run just before the import. On a database that already ran the
 * import it runs out of order, which is harmless: same rules as the observations
 * catch-up -- no row changes, safe to run twice, **never backwards**, and no
 * meaningful `down`.
 *
 * @fileoverview Advances the species sequence past ids inserted without it.
 * @author Isaac Travers
 * @module migrations/species-sequence-catches-up
 */

module.exports = {
    /**
     * Advance the sequence to the table's maximum, if it is behind.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when the sequence is correct.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        const [[before]] = await sequelize.query(
            `SELECT (SELECT COALESCE(max(id), 0) FROM species) AS max_id,
                    (SELECT last_value FROM species_id_seq) AS seq`
        );

        // setval(0) is rejected, and an empty table's sequence is already right.
        if (Number(before.max_id) === 0) {
            console.log('[species sequence] table is empty; the sequence is already correct');

            return;
        }

        await sequelize.query(
            `SELECT setval('species_id_seq',
                           GREATEST(
                               (SELECT max(id) FROM species),
                               (SELECT last_value FROM species_id_seq)
                           ),
                           true)`
        );

        const [[after]] = await sequelize.query('SELECT last_value FROM species_id_seq');

        console.log(
            `[species sequence] max_id ${before.max_id}, sequence ${before.seq} -> `
            + `${after.last_value}. The next species takes ${Number(after.last_value) + 1}.`
        );
    },

    /**
     * Deliberately nothing: moving the sequence back only recreates the collisions.
     *
     * @async
     * @returns {Promise<void>} Resolves immediately.
     */
    async down() {
        console.log(
            '[species sequence] down is a no-op: moving the sequence backwards would '
            + 'only reintroduce the primary key collisions this fixed.'
        );
    },
};
