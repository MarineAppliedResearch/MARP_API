/**
 * Imports the seven annotation species lists into the `species` table, and adds
 * the `(species_list, taxserial)` unique constraint once the data supports it.
 *
 * Updates in place rather than replacing rows. The 218 rows already in this
 * table are referenced by 212,000 rows in `metrics_curves`, 236 in
 * `metrics_summary` and 224 in `model_species`, all by `species.id`, so
 * deleting and re-inserting would either fail on those foreign keys or orphan
 * a large amount of machine-learning history. Every existing row keeps its id.
 *
 * An existing row is matched to a CSV entry by its list plus its taxserial,
 * where the list is derived from the pseudo-list values already sitting in
 * `observation_type` (`invert`, `invert patch`, `Fish`, `Invert_GULF`). 209 of
 * the 218 match a CSV entry exactly, 2 match with a trivially different common
 * name, 7 do not match at all and are left as they are apart from being given a
 * list.
 *
 * Refs #52.
 *
 * @fileoverview Migration importing the annotation species lists.
 * @author Isaac Travers
 * @module migrations/import-species-lists
 */

'use strict';

const { readSpeciesLists } = require('../seed-data/species/species-source');

/**
 * Maps the pseudo-list values already stored in `observation_type` on the 218
 * pre-existing rows onto real list names.
 *
 * `observation_type` cannot be used as the list column going forward -- five of
 * the seven CSVs leave it blank on every row -- but for these historical rows it
 * is the only clue to which list they came from, and `Invert_GULF` appears
 * nowhere in the CSVs at all.
 *
 * @constant
 * @type {Object<string, string>}
 */
const LEGACY_OBSERVATION_TYPE_TO_LIST = {
    invert: 'Inverts',
    'invert patch': 'Inverts',
    Fish: 'Fish',
    Invert_GULF: 'GULF_Inverts',
};

/**
 * Columns the import writes. `id` is deliberately absent: existing rows keep
 * theirs, and new rows get one from the sequence.
 *
 * @constant
 * @type {Array<string>}
 */
const IMPORT_COLUMNS = [
    'species_list', 'taxserial', 'itis_tsn', 'comname', 'species',
    'taxonomic_level', 'report_group', 'observation_type',
    'depth_min', 'depth_max', 'habitat_preference',
    'region', 'likelihood', 'max_size', 'record_max', 'notes',
    'gui_home_order', 'gui_maintab', 'gui_subtab',
    'gui_main_tab_order', 'gui_sub_tab_order', 'gui_item_order',
    'gui_display_name',
];

/** @type {Object} */
module.exports = {
    /**
     * Imports every list entry, giving the pre-existing rows a list, then adds
     * the unique constraint.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the import and constraint are in place.
     * @throws {Error} Re-throws after rolling back if two existing rows collide on
     * `(list, taxserial)`, or if any statement fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            // `species_taxserial_idx` is UNIQUE on taxserial alone, which
            // encodes the assumption that a taxserial identifies one entry
            // globally. It does not: 59 taxserials appear on more than one
            // list, because values below 10000 are local codes reused across
            // lists. It has to go before the import can insert a second row
            // for taxserial 27, and it is replaced at the end of this
            // migration by the same index over (species_list, taxserial).
            await queryInterface.removeIndex('species', 'species_taxserial_idx', { transaction });

            const { records, skippedEmpty, merged } = readSpeciesLists();

            console.log(
                `[species import] ${records.length} entries parsed; `
                + `${skippedEmpty.length} empty rows skipped; ${merged.length} duplicate keys merged`
            );
            for (const skip of skippedEmpty) {
                console.log(`[species import]   skipped empty row: ${skip.speciesList}.csv line ${skip.line}`);
            }
            for (const merge of merged) {
                const detail = merge.conflicts.length
                    ? merge.conflicts.map((c) => `${c.column} kept '${c.kept}' over '${c.discarded}'`).join('; ')
                    : 'no conflicting values';
                console.log(
                    `[species import]   merged duplicate ${merge.speciesList} taxserial ${merge.taxserial} `
                    + `(line ${merge.line}): ${detail}`
                );
            }

            const existing = await sequelize.query(
                'SELECT id, taxserial, comname, observation_type, species_list FROM species',
                { type: QueryTypes.SELECT, transaction }
            );

            // Index the pre-existing rows by the key the import matches on.
            // Built before anything is written so a collision is caught up
            // front rather than surfacing as a constraint violation later.
            /** @type {Map<string, Object>} */
            const existingByKey = new Map();
            /** @type {Array<Object>} */
            const existingWithoutList = [];

            for (const row of existing) {
                // A row that already has a list has been through this import
                // before, so trust that over the legacy guess. This is what
                // makes re-running the migration an update rather than a
                // duplicate insert.
                const list = row.species_list
                    || LEGACY_OBSERVATION_TYPE_TO_LIST[(row.observation_type || '').trim()];
                if (!list) {
                    existingWithoutList.push(row);
                    continue;
                }
                const key = `${list} ${row.taxserial}`;
                if (existingByKey.has(key)) {
                    throw new Error(
                        `Two existing species rows map to the same list and taxserial (${key}): `
                        + `ids ${existingByKey.get(key).id} and ${row.id}. `
                        + 'Resolve by hand before importing, since both may be referenced by metrics.'
                    );
                }
                existingByKey.set(key, { ...row, species_list: list });
            }

            let updated = 0;
            let inserted = 0;

            for (const record of records) {
                const key = `${record.species_list} ${record.taxserial}`;
                const match = existingByKey.get(key);

                const assignments = IMPORT_COLUMNS.map((column) => `"${column}" = :${column}`).join(', ');
                const replacements = {};
                for (const column of IMPORT_COLUMNS) {
                    replacements[column] = record[column] === undefined ? null : record[column];
                }

                if (match) {
                    await sequelize.query(
                        `UPDATE species SET ${assignments}, updated_at = NOW() WHERE id = :id`,
                        { replacements: { ...replacements, id: match.id }, transaction }
                    );
                    existingByKey.delete(key);
                    updated += 1;
                } else {
                    const columnList = IMPORT_COLUMNS.map((column) => `"${column}"`).join(', ');
                    const valueList = IMPORT_COLUMNS.map((column) => `:${column}`).join(', ');
                    await sequelize.query(
                        `INSERT INTO species (${columnList}, created_at, updated_at)
                         VALUES (${valueList}, NOW(), NOW())`,
                        { replacements, transaction }
                    );
                    inserted += 1;
                }
            }

            // Pre-existing rows that no CSV entry claimed. They stay, because
            // metrics reference them, and they get a list where one can be
            // derived so they are at least attributable.
            for (const leftover of existingByKey.values()) {
                await sequelize.query(
                    'UPDATE species SET species_list = :list, updated_at = NOW() WHERE id = :id',
                    { replacements: { list: leftover.species_list, id: leftover.id }, transaction }
                );
                console.log(
                    `[species import]   kept unmatched row id=${leftover.id} `
                    + `${leftover.species_list} taxserial ${leftover.taxserial} '${leftover.comname}' `
                    + '(not in the current list; referenced by metrics)'
                );
            }

            // Rows whose observation_type says nothing about a list. Left with
            // species_list NULL rather than being guessed into one: the two in
            // the development database are sentinels ('No code',
            // 'Line start taxserial'), not species. A NULL list simply means the
            // row is not on any current list, and the list endpoints skip it.
            for (const row of existingWithoutList) {
                console.log(
                    `[species import]   left row id=${row.id} taxserial ${row.taxserial} `
                    + `'${row.comname}' with no list (observation_type='${row.observation_type}')`
                );
            }

            console.log(
                `[species import] ${updated} existing rows updated, ${inserted} inserted, `
                + `${existingByKey.size} pre-existing rows kept without a CSV match, `
                + `${existingWithoutList.length} left with no list`
            );

            // Postgres treats NULLs as distinct in a unique index, so the rows
            // left without a list do not collide with each other.
            await queryInterface.addIndex('species', ['species_list', 'taxserial'], {
                name: 'species_list_taxserial_unique',
                unique: true,
                transaction,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the unique constraint and leaves the imported data in place.
     *
     * Deliberately deletes nothing. Once the import has run there is no
     * trustworthy way to tell a row it inserted from one of the original 218 it
     * updated: both now carry a list and CSV values, and the previous values of
     * the updated rows are not recorded anywhere. Guessing by timestamp or id
     * range would risk deleting rows that 212,000 `metrics_curves` entries
     * depend on.
     *
     * That is safe to do because `up` is idempotent -- it matches on
     * `(species_list, taxserial)` before falling back to the legacy
     * `observation_type` mapping -- so running it again after this updates the
     * same rows instead of inserting duplicates.
     *
     * Genuinely undoing the import means restoring a backup taken before it,
     * which is the honest answer for a data migration of this size.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the unique index has been dropped.
     * @throws {Error} Re-throws if the index cannot be removed.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeIndex('species', 'species_list_taxserial_unique', { transaction });

            // Restored non-unique, deliberately. The original index was UNIQUE
            // on taxserial alone and the imported data provably violates that
            // -- 59 taxserials appear on more than one list -- so recreating it
            // as it was would simply fail. A plain index keeps the lookups it
            // was there for.
            await queryInterface.addIndex('species', ['taxserial'], {
                name: 'species_taxserial_idx',
                unique: false,
                transaction,
            });

            await transaction.commit();

            console.log(
                '[species import] down: dropped the (species_list, taxserial) unique index and '
                + 'restored species_taxserial_idx as NON-unique. Imported rows are left in place '
                + 'on purpose -- see this migration\'s comments. Re-running up() is safe.'
            );
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
