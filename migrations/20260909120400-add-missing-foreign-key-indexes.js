/**
 * Adds the three missing foreign-key indexes: `keyframes (observation_id)`,
 * `observations (session_id)` and `observations (project_id)`.
 *
 * All three are foreign keys with nothing behind them. `keyframes` has exactly
 * one index, its primary key, so every "the keyframes for this observation"
 * lookup -- which the mosaic performs per tile -- is a sequential scan of the
 * whole table, and so is the referential check every observation delete
 * performs. `observations` has two indexes, its primary key and
 * `species_id`, so filtering by session or project scans 440,000 rows. They are
 * correct whatever the mosaic query turns out to be, which is why they are here
 * rather than waiting for Phase 4 to measure. The sort-serving composites are
 * deliberately not here: each needs a plan to justify it, and
 * `observations ("updatedAt", observation_id)` in particular defeats HOT updates
 * on every write to the table the annotation GUI writes all day.
 *
 * **This migration opens no transaction, and that is the whole point of it being
 * its own file.** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
 * block, and every other migration in this repository opens one -- that is this
 * repository's convention, not the migrator's; `sequelize-cli` does not wrap a
 * migration for you. Building these indexes any other way takes an
 * `ACCESS EXCLUSIVE` lock for the length of the build, which on `observations`
 * means the annotation GUI stops writing until it finishes.
 *
 * Three consequences follow, and each is here so the next person does not
 * discover it the hard way:
 *
 * - **It cannot use `guardDataIntegrity`.** The guard needs a transaction, so
 *   that a lost row rolls the migration back; there is no transaction to roll
 *   back to. That is safe rather than sloppy here because this migration adds
 *   and removes no rows and changes no constraint -- there is nothing for the
 *   guard to protect.
 * - **A failed `CONCURRENTLY` build leaves an invalid index behind**, which
 *   `CREATE INDEX CONCURRENTLY IF NOT EXISTS` will then skip forever, quietly
 *   leaving an index that the planner refuses to use. So each index is checked
 *   against `pg_index.indisvalid` first and an invalid leftover is dropped
 *   before rebuilding. Re-running after a failure is therefore the fix, rather
 *   than a manual clean-up.
 * - **`down` drops them concurrently too**, also outside a transaction, for the
 *   same locking reason.
 *
 * Refs #103, #99.
 *
 * @fileoverview Migration adding the three missing foreign-key indexes, concurrently.
 * @author Isaac Travers
 * @module migrations/add-missing-foreign-key-indexes
 */

'use strict';

/**
 * The three indexes, each named after the table and column it covers so the
 * name says what it is for.
 *
 * @constant
 * @type {Array<{name: string, table: string, column: string}>}
 */
const INDEXES = [
    { name: 'keyframes_observation_id_idx', table: 'keyframes', column: 'observation_id' },
    { name: 'observations_session_id_idx', table: 'observations', column: 'session_id' },
    { name: 'observations_project_id_idx', table: 'observations', column: 'project_id' },
];

/**
 * Drops an index left behind invalid by a failed concurrent build.
 *
 * An invalid index is worse than a missing one: it is maintained on every write
 * and used by nothing, and `IF NOT EXISTS` treats it as present. Reported rather
 * than dropped silently, because it means a previous run of this migration
 * failed and somebody should know that.
 *
 * @async
 * @param {Object} sequelize - Sequelize instance.
 * @param {string} name - Index name to check.
 * @returns {Promise<void>} Resolves once any invalid index of that name is gone.
 */
async function dropIfInvalid(sequelize, name) {
    const { QueryTypes } = sequelize.constructor;

    const rows = await sequelize.query(
        `SELECT c.relname AS name, i.indisvalid AS valid
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = :name`,
        { replacements: { name }, type: QueryTypes.SELECT }
    );

    if (rows.length > 0 && rows[0].valid === false) {
        console.log(
            `[foreign key indexes] ${name} exists but is invalid, so a previous concurrent `
            + 'build failed. Dropping it and rebuilding.'
        );
        await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
    }
}

/** @type {Object} */
module.exports = {
    /**
     * Builds each index concurrently, dropping an invalid leftover first.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once all three indexes are valid.
     * @throws {Error} If a build fails; re-running the migration is the fix.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        for (const index of INDEXES) {
            await dropIfInvalid(sequelize, index.name);

            // No transaction, deliberately. See the file comment: this cannot
            // be wrapped, and wrapping it is the mistake to avoid.
            await sequelize.query(
                `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index.name}
                   ON ${index.table} (${index.column})`
            );

            console.log(`[foreign key indexes] ${index.name} on ${index.table} (${index.column})`);
        }
    },

    /**
     * Drops all three, concurrently.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once all three indexes are gone.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;

        for (const index of INDEXES) {
            await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS ${index.name}`);
        }
    },
};
