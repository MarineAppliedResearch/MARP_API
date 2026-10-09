/**
 * Adds `species.is_active`, and retires the entries that are not on any current
 * annotation list.
 *
 * The list import kept five pre-existing rows that no CSV entry claimed, because
 * `metrics_curves`, `metrics_summary` and `model_species` reference them and
 * deleting them would orphan machine-learning history. Giving them a list made
 * them attributable, but it also made them appear as extra buttons in the
 * annotation GUI, which is wrong twice over:
 *
 * - `Fish` taxserial 3030 and 1666730 carry `gui_home_order` 3 and 2, colliding
 *   with real Fish entries. The GUI drops whichever home-screen item it sees
 *   second, so a live species could lose its place to a retired one.
 * - `Inverts` taxserial 59 and 61 repeat the names of 57 and 60, showing the
 *   same sponge twice under Other -> Sponge.
 *
 * So a row can belong to a list historically without being offered for
 * annotation. `is_active` is that distinction. It is also the mechanism for
 * retiring an entry in future: a species that observations reference cannot be
 * deleted, so retiring is the only way to take one out of use.
 *
 * Which rows to retire is derived from the CSVs rather than hardcoded, so this
 * produces the same result on any database the import has run against.
 *
 * Refs #52.
 *
 * @fileoverview Migration adding species.is_active and retiring off-list entries.
 * @author Isaac Travers
 * @module migrations/add-species-is-active
 */

'use strict';

const { readSpeciesLists } = require('../seed-data/species/species-source');

/** @type {Object} */
module.exports = {
    /**
     * Adds the column, then retires every entry whose `(species_list,
     * taxserial)` does not appear in the CSVs.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the column exists and off-list entries are retired.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.addColumn(
                'species',
                'is_active',
                {
                    type: Sequelize.BOOLEAN,
                    allowNull: false,
                    // Active by default, so an entry added later is offered for
                    // annotation without anyone remembering to set this.
                    defaultValue: true,
                    comment:
                        'Whether this entry is offered for annotation. False for entries kept only because observations or machine-learning metrics reference them: a species that is referenced cannot be deleted, so retiring is how one is taken out of use.',
                },
                { transaction }
            );

            const { records } = readSpeciesLists();
            const onCurrentList = new Set(
                records.map(record => `${record.species_list} ${record.taxserial}`)
            );

            const existing = await sequelize.query(
                'SELECT id, species_list, taxserial, comname, gui_display_name FROM species WHERE species_list IS NOT NULL',
                { type: QueryTypes.SELECT, transaction }
            );

            /** @type {Array<Object>} */
            const retired = existing.filter(
                row => !onCurrentList.has(`${row.species_list} ${row.taxserial}`)
            );

            if (retired.length > 0) {
                await sequelize.query(
                    'UPDATE species SET is_active = false, updated_at = NOW() WHERE id IN (:ids)',
                    { replacements: { ids: retired.map(row => row.id) }, transaction }
                );
            }

            // Entries with no list at all were never on one, so they are retired
            // too -- 'No code' and 'Line start taxserial' are sentinels, not
            // species.
            const [, listlessMetadata] = await sequelize.query(
                'UPDATE species SET is_active = false, updated_at = NOW() WHERE species_list IS NULL',
                { transaction }
            );
            const listless = (listlessMetadata && listlessMetadata.rowCount) || 0;

            console.log(
                `[species is_active] retired ${retired.length} entries not on a current list, `
                + `plus ${listless} with no list; the rest stay active`
            );
            for (const row of retired) {
                console.log(
                    `[species is_active]   retired ${row.species_list} taxserial ${row.taxserial} `
                    + `'${row.comname}' (would have shown as '${row.gui_display_name}')`
                );
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the column. Retirement is not recorded anywhere else, so this
     * loses it -- and re-running `up` recomputes it from the CSVs.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the column is gone.
     */
    async down(queryInterface) {
        await queryInterface.removeColumn('species', 'is_active');
    },
};
