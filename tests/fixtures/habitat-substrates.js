/**
 * The Habitat list's substrates, for tests that need them (#287).
 *
 * A database built from the baseline has no Rock, Mud, Sand, Cobble or Boulder on the
 * Habitat list -- they came with production's species -- so a test seeds the ones that are
 * missing and removes only those. A development database that has them keeps its own.
 *
 * @fileoverview Seeding and removing the Habitat substrates.
 * @module tests/fixtures/habitat-substrates
 */

const db = require('../../model');

const { QueryTypes } = db.Sequelize;

/** Production's taxserials for the five, so a seeded row looks like the real one. */
const SUBSTRATES = { Rock: 666001, Boulder: 666002, Cobble: 666003, Sand: 666004, Mud: 666005 };

/**
 * Make sure the five substrates are on the Habitat list.
 *
 * @async
 * @returns {Promise<{byName: Object<string, number>, created: Array<number>}>} Each
 *   substrate's species id, and the ids this call added.
 */
async function ensureSubstrates() {
    const byName = {};
    const created = [];
    for (const [name, taxserial] of Object.entries(SUBSTRATES)) {
        const [found] = await db.sequelize.query(
            `SELECT id FROM species WHERE species_list = 'Habitat' AND comname = :name ORDER BY id LIMIT 1`,
            { replacements: { name }, type: QueryTypes.SELECT }
        );
        if (found) {
            byName[name] = Number(found.id);
            continue;
        }
        const [row] = await db.sequelize.query(
            `INSERT INTO species (taxserial, comname, gui_display_name, species_list, gui_maintab, gui_subtab,
                                  is_active, created_at, updated_at)
             VALUES (:taxserial, :name, :name, 'Habitat', 'HAB', 'TYPE1', true, NOW(), NOW()) RETURNING id`,
            { replacements: { name, taxserial }, type: QueryTypes.SELECT }
        );
        byName[name] = Number(row.id);
        created.push(Number(row.id));
    }
    return { byName, created };
}

/**
 * Remove the substrates `ensureSubstrates` added.
 *
 * @async
 * @param {?Object} seeded - What it returned.
 * @returns {Promise<void>}
 */
async function removeSubstrates(seeded) {
    if (seeded && seeded.created.length) {
        await db.sequelize.query('DELETE FROM species WHERE id IN (:ids)', { replacements: { ids: seeded.created } });
    }
}

module.exports = { SUBSTRATES, ensureSubstrates, removeSubstrates };
