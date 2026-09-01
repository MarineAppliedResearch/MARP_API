/**
 * Adds `observations.species_id` and backfills it, giving observations a real
 * foreign key to the species catalogue instead of a loose taxserial.
 *
 * Observations already store `taxserial` (populated on 438,988 of 440,102 rows)
 * and `comname`, both denormalised because there was no lookup table to join to
 * -- the name had to be copied or it would have been lost. What was missing is
 * the key itself.
 *
 * It could not simply be added, because `taxserial` does not identify a species
 * row: values below 10000 are local codes invented per list and reused across
 * lists. The list has to come from somewhere, and the only thing that implies it
 * is the owning session's `type`, which is what {@link SESSION_TYPE_TO_LIST}
 * maps.
 *
 * Nullable on purpose. Around 4% of observations genuinely do not resolve --
 * taxserials that no longer exist on their list, two sessions with a type
 * outside the mapping, and 1,114 rows with no taxserial at all -- so a NOT NULL
 * column would make this migration impossible to run. What does not resolve is
 * reported rather than left silently null.
 *
 * `comname` is deliberately left in place. It is the only record of what the
 * annotator actually chose at the time, and roughly 50,000 observations
 * disagree with what their list says today, because lists have been renamed and
 * renumbered underneath recorded data. Keeping it makes that auditable;
 * dropping it would quietly rewrite history.
 *
 * Refs #52.
 *
 * @fileoverview Migration adding and backfilling observations.species_id.
 * @author Isaac Travers
 * @module migrations/add-observations-species-id
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Maps a session's `type` onto the annotation list its observations were
 * recorded against.
 *
 * Two session types in the development database fall outside this (`InvertGULF`
 * and `Other`, two observations between them). They are reported rather than
 * guessed at: `Other` genuinely does not say which list was in use.
 *
 * @constant
 * @type {Object<string, string>}
 */
const SESSION_TYPE_TO_LIST = {
    Fish: 'Fish',
    Invert: 'Inverts',
    Inverts: 'Inverts',
    GULF_Fish: 'GULF_Fish',
    GULF_Inverts: 'GULF_Inverts',
    Habitat: 'Habitat',
    Substrate60Second: 'Substrate_60Seconds',
    MarineDebris: 'MarineDebris',
};

/** @type {Object} */
module.exports = {
    /**
     * Adds the column and its foreign key, backfills every observation that
     * resolves, indexes the column, then reports what did not resolve.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the column is added, backfilled and indexed.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.addColumn(
                'observations',
                'species_id',
                {
                    type: Sequelize.INTEGER,
                    // Nullable: about 4% of historical observations cannot be
                    // resolved to a current list entry, and losing them is not
                    // an option.
                    allowNull: true,
                    references: { model: 'species', key: 'id' },
                    // An observation outlives a species-list edit. Removing a
                    // list entry should not delete the observations recorded
                    // against it, nor block the removal.
                    onDelete: 'SET NULL',
                    onUpdate: 'CASCADE',
                    comment:
                        'The species catalogue entry this observation records, resolved from taxserial plus the owning session\'s type. Null where that could not be resolved; comname remains the record of what the annotator chose.',
                },
                { transaction }
            );

            // Backfilling touches 440,102 observations in one statement, so it
            // runs inside an integrity check: nothing here should delete a row
            // or drop an existing reference, and if it does the migration rolls
            // back rather than leaving a partly-rewritten table.
            const updateMetadata = await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'observations species_id',
                tables: ['observations', 'species'],
                work: async () => {

            // One statement rather than a row-by-row loop: this touches
            // 440,102 rows, and the join is exactly the identity rule --
            // session type gives the list, taxserial gives the entry within it.
            const mappingValues = Object.entries(SESSION_TYPE_TO_LIST)
                .map(([, list], index) => `(:type${index}, :list${index})`)
                .join(', ');

            /** @type {Object<string, string>} */
            const replacements = {};
            Object.entries(SESSION_TYPE_TO_LIST).forEach(([type, list], index) => {
                replacements[`type${index}`] = type;
                replacements[`list${index}`] = list;
            });

            // Sequelize hands back [results, metadata] here, and for a Postgres
            // UPDATE the row count is on the metadata object rather than being
            // the metadata itself.
            const [, metadata] = await sequelize.query(
                // Joined through WHERE rather than JOIN ... ON: Postgres does
                // not allow the UPDATE target (`o`) to be referenced from a
                // join condition inside FROM.
                `WITH type_map(session_type, species_list) AS (VALUES ${mappingValues})
                 UPDATE observations o
                    SET species_id = sp.id
                   FROM sessions s, type_map tm, species sp
                  WHERE o.session_id     = s.session_id
                    AND tm.session_type  = s.type
                    AND sp.species_list  = tm.species_list
                    AND sp.taxserial     = o.taxserial
                    AND o.taxserial IS NOT NULL
                    AND o.species_id IS NULL`,
                { replacements, transaction }
            );

                    return metadata;
                },
            });

            await queryInterface.addIndex('observations', ['species_id'], {
                name: 'observations_species_id_idx',
                transaction,
            });

            // Everything that did not resolve, grouped so somebody who knows
            // the taxonomy can act on it rather than reading 18,000 rows.
            const unresolved = await sequelize.query(
                `SELECT s.type AS session_type,
                        o.taxserial,
                        o.comname,
                        COUNT(*)::int AS observation_count
                   FROM observations o
                   LEFT JOIN sessions s ON s.session_id = o.session_id
                  WHERE o.species_id IS NULL
                  GROUP BY 1, 2, 3
                  ORDER BY observation_count DESC`,
                { type: QueryTypes.SELECT, transaction }
            );

            const totals = await sequelize.query(
                `SELECT COUNT(*)::int AS total,
                        COUNT(species_id)::int AS resolved
                   FROM observations`,
                { type: QueryTypes.SELECT, transaction }
            );

            const { total, resolved } = totals[0];
            const unresolvedRows = total - resolved;
            const share = total === 0 ? 0 : ((resolved / total) * 100).toFixed(1);

            const backfilled = (updateMetadata && updateMetadata.rowCount) || 0;

            console.log(
                `[observations species_id] ${backfilled} rows backfilled; `
                + `${resolved} of ${total} observations resolved (${share}%), `
                + `${unresolvedRows} left null across ${unresolved.length} distinct groups`
            );

            // Capped deliberately, and the cap is stated: the full list belongs
            // in a report, not in migration output.
            const REPORT_LIMIT = 25;
            for (const group of unresolved.slice(0, REPORT_LIMIT)) {
                console.log(
                    `[observations species_id]   unresolved ${group.observation_count} x `
                    + `session type '${group.session_type}' taxserial ${group.taxserial} `
                    + `comname '${group.comname}'`
                );
            }
            if (unresolved.length > REPORT_LIMIT) {
                console.log(
                    `[observations species_id]   ...and ${unresolved.length - REPORT_LIMIT} `
                    + 'more groups not listed'
                );
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the index and the column. Genuinely reversible: nothing else
     * reads `species_id` yet, and dropping it leaves `taxserial` and `comname`
     * exactly as they were.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the column is gone.
     * @throws {Error} Re-throws after rolling back if removal fails.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeIndex('observations', 'observations_species_id_idx', { transaction });
            await queryInterface.removeColumn('observations', 'species_id', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
