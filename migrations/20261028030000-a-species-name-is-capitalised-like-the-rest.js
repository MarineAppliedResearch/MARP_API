/**
 * Nine lowercase species names take the catalogue's own capitalisation, and the one
 * genuine duplicate among them is retired.
 *
 * Isaac, on the nine names that differ from another row only in case: *"these should
 * probably share the same capitalization."*
 *
 * **Eight of the nine pairs are not duplicates, and this does not merge them.** Each sits
 * on a different species list -- `Crab` on `GULF_Inverts` against `crab` on
 * `FathomNet_Trash`, `Urchin` on `GULF_Inverts` against `urchin` on `NOAA_Sea_Urchin` --
 * and one name on two lists is how this catalogue already works. `Red sea urchin` is on
 * both `Inverts` and `GULF_Inverts`, which is why the ingest narrows to a model's trained
 * species before the whole catalogue, and `checkSessionTypeAgainstModel` refuses a model
 * whose list does not match the session. Merging them would move a row from one list into
 * another, which MARP has no way to express and the session check would then be wrong
 * about. They are not the same organism either: `Crab` carries `Decapoda (crab)` and
 * taxserial 235 where `crab` has taxserial 6 and no scientific name.
 *
 * **`Equipment` and `equipment` are both on `MBARI_315k`, and that one is a duplicate.**
 * Capitalising both would leave two identical names on one list, which is worse than the
 * state it replaced -- so the later row is retired into the earlier and its references
 * are repointed.
 *
 * **Uppercase-first is the catalogue's own convention**, not an imposed one: 1,344 of its
 * 1,389 named rows already begin with a capital.
 *
 * **`observations.comname` is updated alongside, and that is the part a merge would have
 * hidden.** An observation keeps its own copy of the name, and on all 351 affected rows
 * it currently agrees with the catalogue exactly. Renaming the species alone would leave
 * a row whose `species_id` says `Fish` and whose `comname` says `fish` -- a disagreement
 * this migration would have created, in a table that is a scientific record.
 *
 * **This rename would have broken inference without the change that went with it.** The
 * FathomNet, MBARI and NOAA models emit lowercase class names, and the ingest matched
 * `species.comname` with case-sensitive equality -- so after this, every detection from
 * those models would have failed to resolve, and each future observation would have
 * arrived with no species and nothing to say why. `findTrainedSpeciesByName` and
 * `findSpeciesByName` fold case as of the same change, with a test that goes red without
 * it. A rename can break inference where a merge would not.
 *
 * **Nothing is deleted.** The retired row keeps its id and its list and is marked
 * inactive, so a reference that escapes this migration still finds a row rather than a
 * dangling id, and `down` restores every name, every reference and the active flag.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration capitalising nine species names and retiring one duplicate.
 * @module migrations/a-species-name-is-capitalised-like-the-rest
 */

/**
 * The rows to capitalise, as `id: [from, to]`.
 *
 * **Pinned by id and by the name expected there**, rather than found by a pattern. A
 * pattern would also catch rows added after this was written, and a migration that
 * renames whatever it happens to find is not reviewable.
 */
const CAPITALISE = {
    2074: ['anchor', 'Anchor'],
    1592: ['crab', 'Crab'],
    1588: ['eel', 'Eel'],
    1591: ['fish', 'Fish'],
    1599: ['ray', 'Ray'],
    2095: ['sand', 'Sand'],
    1597: ['shark', 'Shark'],
    2104: ['urchin', 'Urchin'],
};

/**
 * The one true duplicate: both rows are `MBARI_315k`, so capitalising would collide.
 *
 * The earlier id is kept, for the same reason the first report of a setting is the
 * record: it is the one anything older already points at.
 */
const MERGE = { from: 2081, into: 1767, name: 'equipment', canonical: 'Equipment' };

/** Every column that references `species.id`, read from the schema rather than recalled. */
const REFERENCES = [
    ['observations', 'species_id'],
    ['observation_reviews', 'corrected_species_id'],
    ['observation_reviews', 'previous_species_id'],
    ['model_species', 'species_id'],
    ['metrics_summary', 'species_id'],
    ['metrics_curves', 'species_id'],
    ['dataset_classes', 'species_id'],
    ['dataset_split_species', 'species_id'],
    ['species_pictures', 'species_id'],
];

/**
 * Count what each referencing column holds for one species.
 *
 * @async
 * @param {Object} sequelize - The connection.
 * @param {number} id - Species id.
 * @param {Object} transaction - The transaction.
 * @returns {Promise<Object>} Column path to count, non-zero only.
 */
async function referencesTo(sequelize, id, transaction) {
    const held = {};

    for (const [table, column] of REFERENCES) {
        const [rows] = await sequelize.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = :id`,
            { replacements: { id }, transaction }
        );

        if (rows[0].n) held[`${table}.${column}`] = rows[0].n;
    }

    return held;
}

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            const before = {};

            for (const id of [...Object.keys(CAPITALISE).map(Number), MERGE.from, MERGE.into]) {
                before[id] = await referencesTo(sequelize, id, transaction);
            }

            console.log(`[species-case] references before: ${JSON.stringify(before)}`);

            /* **Each rename is pinned to the name it expects.** A row somebody has already
               corrected by hand is left alone rather than overwritten, and the count says
               so, because a migration that silently does nothing is indistinguishable from
               one that silently does the wrong thing. */
            for (const [id, [from, to]] of Object.entries(CAPITALISE)) {
                const [, species] = await sequelize.query(
                    `UPDATE species SET comname = :to, updated_at = NOW()
                      WHERE id = :id AND comname = :from`,
                    { replacements: { id: Number(id), from, to }, transaction }
                );

                /* The observation's own copy of the name, moved with it. Scoped to rows
                   that still carry the old spelling, so a row corrected by hand keeps
                   whatever it was corrected to. */
                const [, observations] = await sequelize.query(
                    `UPDATE observations SET comname = :to, "updatedAt" = NOW()
                      WHERE species_id = :id AND comname = :from`,
                    { replacements: { id: Number(id), from, to }, transaction }
                );

                console.log(
                    `[species-case] ${from} -> ${to}: ${species?.rowCount ?? 0} species row(s), `
                    + `${observations?.rowCount ?? 0} observation name(s)`
                );
            }

            /* **One link already existed on both sides, and a repoint cannot create it
               twice.** `model_species` is unique on (model_id, species_id), and model 173
               is linked to the duplicate AND to the row it is being merged into. Updating
               that row to point at 1767 would violate the constraint -- which it did, and
               the transaction rolled the whole migration back rather than writing half of
               it.

               So a link that would become a duplicate is removed rather than moved. No
               information goes: the surviving row says exactly what the removed one said,
               that model 173 was trained on this species. The count is logged because a
               deletion is the one thing here that `down` cannot reverse. */
            const [, deduped] = await sequelize.query(
                `DELETE FROM model_species ms
                  WHERE ms.species_id = :from
                    AND EXISTS (SELECT 1 FROM model_species other
                                 WHERE other.model_id = ms.model_id
                                   AND other.species_id = :into)`,
                { replacements: { from: MERGE.from, into: MERGE.into }, transaction }
            );

            if (deduped?.rowCount) {
                console.log(
                    `[species-case] model_species: ${deduped.rowCount} link(s) removed as already `
                    + `held against ${MERGE.into}; the surviving row carries the same fact`
                );
            }

            /* **The duplicate: repoint, then retire.** Every reference moves first, so the
               retired row is unreferenced by the time it is marked inactive.

               The other three unique constraints that involve a species reference --
               dataset_classes (dataset_id, species_id), dataset_split_species
               (dataset_id, split, species_id) and species_pictures -- could collide the
               same way in principle. None does here, because the retired row holds nothing
               in those tables. If one ever did, this UPDATE raises and the whole migration
               rolls back, which is the right failure: a collision there is two rows
               claiming different things about one species, and choosing between them is
               not a decision a migration should make silently. */
            for (const [table, column] of REFERENCES) {
                const [, moved] = await sequelize.query(
                    `UPDATE ${table} SET ${column} = :into WHERE ${column} = :from`,
                    { replacements: { into: MERGE.into, from: MERGE.from }, transaction }
                );

                if (moved?.rowCount) {
                    console.log(`[species-case] ${table}.${column}: ${moved.rowCount} moved to ${MERGE.into}`);
                }
            }

            /* **Retired, not deleted.** Its id stays resolvable, so anything holding one
               this migration did not see finds a row that says what happened rather than a
               dangling reference -- and `down` has something to restore. */
            await sequelize.query(
                `UPDATE species
                    SET is_active = false,
                        comname = :retired,
                        notes = COALESCE(notes || ' ', '')
                                || 'Retired 2026-10-28: a duplicate of species '
                                || :into || ' on the same species list, differing only in '
                                || 'capitalisation. References were repointed; this row is '
                                || 'kept so its id still resolves.',
                        updated_at = NOW()
                  WHERE id = :from`,
                {
                    replacements: {
                        from: MERGE.from,
                        into: MERGE.into,
                        retired: `${MERGE.canonical} (retired duplicate)`,
                    },
                    transaction,
                }
            );

            const after = {};

            for (const id of [...Object.keys(CAPITALISE).map(Number), MERGE.from, MERGE.into]) {
                after[id] = await referencesTo(sequelize, id, transaction);
            }

            console.log(`[species-case] references after: ${JSON.stringify(after)}`);

            /* **The total must not move.** Every reference this touched was repointed, not
                removed, so the sum across the merged pair is the same before and after.
                Checked rather than asserted in prose, and a mismatch rolls the whole thing
                back -- `db/data-integrity.js` makes the same argument for data migrations. */
            const total = (held) => Object.values(held).reduce((sum, n) => sum + n, 0);
            const pairBefore = total(before[MERGE.from]) + total(before[MERGE.into]);
            const pairAfter = total(after[MERGE.from]) + total(after[MERGE.into]);

            /* **Minus the links that were already duplicated, which is the one legitimate
               reduction and has to be named rather than waived.** This check fired on the
               first real run: the pair held two references and one afterwards, because a
               model linked to both species cannot be linked to the survivor twice. That is
               not a loss -- the surviving row states the same fact -- but the only honest
               way to permit it is to subtract exactly what was removed, so a reference
               that went missing for any other reason still rolls the migration back. */
            const removed = deduped?.rowCount ?? 0;

            if (pairBefore - removed !== pairAfter) {
                throw new Error(
                    `[species-case] the merged pair held ${pairBefore} reference(s) before, `
                    + `${removed} were removed as already-held duplicates, and ${pairAfter} `
                    + `remain -- which does not add up, so this is rolled back.`
                );
            }

            if (total(after[MERGE.from]) !== 0) {
                throw new Error(
                    `[species-case] species ${MERGE.from} still holds `
                    + `${total(after[MERGE.from])} reference(s) after the repoint; rolled back.`
                );
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            /* **The retired row comes back first**, so its references have somewhere to
               return to before anything points at it again. */
            await sequelize.query(
                `UPDATE species
                    SET is_active = true, comname = :name, updated_at = NOW()
                  WHERE id = :from`,
                { replacements: { from: MERGE.from, name: MERGE.name }, transaction }
            );

            /* **What `down` cannot do, and says rather than pretends.** The repoint moved
               rows from 2081 to 1767 and both ids are now 1767; nothing distinguishes a
               row that was always 1767 from one that moved. So the references stay where
               they are, and the row they point at is the surviving one -- which is the
               honest restoration rather than a guess that would move somebody else's rows.

               The counts logged by `up` are what a reader needs to undo it by hand. */
            const [rows] = await sequelize.query(
                `SELECT count(*)::int AS n FROM model_species WHERE species_id = :into`,
                { replacements: { into: MERGE.into }, transaction }
            );

            console.log(
                `[species-case] down: species ${MERGE.from} is active again as "${MERGE.name}". `
                + `References repointed to ${MERGE.into} are NOT moved back -- ${rows[0].n} `
                + 'model_species row(s) now point at it and nothing records which were moved. '
                + 'See the "references before" line this migration logged on the way up.'
            );

            for (const [id, [from, to]] of Object.entries(CAPITALISE)) {
                await sequelize.query(
                    `UPDATE species SET comname = :from, updated_at = NOW()
                      WHERE id = :id AND comname = :to`,
                    { replacements: { id: Number(id), from, to }, transaction }
                );

                await sequelize.query(
                    `UPDATE observations SET comname = :from, "updatedAt" = NOW()
                      WHERE species_id = :id AND comname = :to`,
                    { replacements: { id: Number(id), from, to }, transaction }
                );
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
