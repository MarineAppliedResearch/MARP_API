/**
 * Seeds the annotation lists that FathomNet-family detectors classify against.
 *
 * MARP's catalogue is species-level and partitioned into lists, and a session's
 * `type` is the only thing that says which list its observations were recorded
 * against. The FathomNet and MBARI detectors do not classify species: they
 * classify **morphotaxonomic groups** -- `Sea fans`, `Bony fishes`, `Glass
 * sponges`. Of the MBARI benthic model's 29 classes, exactly one ("Flatfish")
 * existed anywhere in this catalogue, and on a different list.
 *
 * So each model's vocabulary gets a list of its own, which is how MARP already
 * partitions. **`Habitat` is the precedent rather than an exception**: it holds
 * `comname = 'Rock'` with a null `species`, so a list of things that are not
 * species already exists here and already works. Settled with Isaac on
 * 2026-09-18, against one shared morphotaxa list and against a new table.
 *
 * Why a list per model rather than one shared list: two of these vocabularies
 * overlap in meaning but not in wording -- MBARI says `Sea fans` where the VME
 * detector says `corals` -- and merging them would make "which model called it
 * that" unanswerable from the record. The ingest narrows a common name to the
 * model's trained species before looking wider, so a list per model is what
 * keeps that narrowing meaningful.
 *
 * `taxserial` is a small ordinal here, which is not a shortcut: values below
 * 10000 are documented as local codes invented per list and reused across
 * lists, and `Substrate_60Seconds` (1-15) already does exactly this.
 *
 * This seeds the **vocabulary**. Registering weights and linking `model_species`
 * is `scripts/register-model.js`, which needs these rows to exist first and
 * refuses a name it cannot resolve.
 *
 * Idempotent on `(species_list, comname)`, so re-running after a rebuild is the
 * fix rather than a source of duplicates.
 *
 * Usage:
 *   node scripts/seed-morphotaxa-vocabulary.js                 # what it would do
 *   node scripts/seed-morphotaxa-vocabulary.js --apply
 *   node scripts/seed-morphotaxa-vocabulary.js --list FathomNet_VME --apply
 *
 * @fileoverview Seeds morphotaxonomic annotation lists for FathomNet models.
 * @author Isaac Travers
 * @module scripts/seed-morphotaxa-vocabulary
 */

'use strict';

require('dotenv').config();

const { QueryTypes } = require('sequelize');

const db = require('../model');

/**
 * One entry per model vocabulary.
 *
 * `classes` is in the model's own class-index order, and each string is copied
 * from the weights rather than retyped -- the ingest resolves a detection by
 * matching this text exactly, and the model-identity check (#216) refuses a run
 * whose loaded class names disagree with what is registered here. A typo does
 * not degrade anything; it stops the model running, which is the right failure
 * and the reason these are worth checking against the artifact.
 *
 * @constant
 * @type {Array<Object>}
 */
const VOCABULARIES = require('./data/morphotaxa-vocabularies.json');

/**
 * Reads a named command-line argument.
 *
 * @param {string} name - The flag, including its leading dashes.
 * @returns {?string} The value after it, or null.
 */
function argument(name) {
    const index = process.argv.indexOf(name);

    return index >= 0 ? process.argv[index + 1] : null;
}

/**
 * Create whatever of one vocabulary is missing.
 *
 * @async
 * @param {Object} vocabulary - An entry from `VOCABULARIES`.
 * @param {boolean} apply - Whether to write.
 * @returns {Promise<Object>} What was, or would be, created.
 */
async function seedVocabulary(vocabulary, apply) {
    const existing = await db.sequelize.query(
        'SELECT comname FROM species WHERE species_list = :list',
        { replacements: { list: vocabulary.list }, type: QueryTypes.SELECT }
    );
    const have = new Set(existing.map((row) => row.comname));
    const missing = vocabulary.classes.filter((name) => !have.has(name));

    if (!apply) {
        return { created: 0, present: have.size, missing: missing.length };
    }

    for (const [index, comname] of vocabulary.classes.entries()) {
        if (have.has(comname)) {
            continue;
        }

        await db.sequelize.query(
            `INSERT INTO species
                 (taxserial, comname, gui_display_name, species_list, is_active,
                  notes, created_at, updated_at)
             VALUES (:taxserial, :comname, :comname, :list, true, :notes, NOW(), NOW())`,
            {
                replacements: {
                    // The model's own class index, one-based. Only meaningful
                    // within this list, which is what taxserial already means.
                    taxserial: index + 1,
                    comname,
                    list: vocabulary.list,
                    notes: `Morphotaxonomic group, not a species. Class ${index} of `
                        + `${vocabulary.model} (${vocabulary.licence}). ${vocabulary.source}`,
                },
            }
        );
    }

    return { created: missing.length, present: have.size, missing: missing.length };
}

/**
 * Entry point.
 *
 * @async
 * @returns {Promise<void>} Resolves when every wanted vocabulary is handled.
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const only = argument('--list');
    const wanted = only ? VOCABULARIES.filter((entry) => entry.list === only) : VOCABULARIES;

    if (!wanted.length) {
        console.error(`No vocabulary called ${only}. Known: `
            + VOCABULARIES.map((entry) => entry.list).join(', '));
        process.exitCode = 1;

        return;
    }

    for (const vocabulary of wanted) {
        const result = await seedVocabulary(vocabulary, apply);
        const verb = apply ? 'created' : 'would create';

        console.log(`${vocabulary.list}: ${verb} ${result.missing}, `
            + `${result.present} already present, ${vocabulary.classes.length} in the model`);
    }

    if (!apply) {
        console.log('');
        console.log('Dry run. Re-run with --apply to write.');

        return;
    }

    console.log('');
    console.log('Next, register each model against its list, which is what links model_species:');

    for (const vocabulary of wanted) {
        console.log(`  node scripts/register-model.js --name ${vocabulary.model} \\`);
        console.log('    --source <weights> --species-file <one class name per line> --apply');
    }

    console.log('');
    console.log('And a session must carry the matching type, or its observations resolve');
    console.log('against the wrong list:');

    for (const vocabulary of wanted) {
        console.log(`  ${vocabulary.sessionType} -> ${vocabulary.list}`);
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exitCode = 1;
    });
