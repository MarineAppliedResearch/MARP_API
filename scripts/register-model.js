/**
 * Register a trained model so MARP can hand it to a worker and ingest its output.
 *
 * Three rows have to exist before an inference job can name a model and have its
 * results become observations, and all three have been created by hand here
 * before and lost to a rebuild:
 *
 * 1. `ml_models` -- the registration, with the `storage_path` MARP serves from.
 * 2. the artifact bytes, under `MODEL_STORAGE_ROOT`, so
 *    `GET /api/v2/model/:id/artifact` can stream them. **A registration with no
 *    bytes behind it is the failure this script exists to prevent**: model 91 had
 *    a row and no file for weeks, every job worked around it with an absolute
 *    local path, and nothing could tell until a second machine tried to run one.
 * 3. `model_species` -- which species the model was trained on. This is what
 *    `checkSessionTypeAgainstModel` reads to refuse an inverts model's output
 *    being written into a fish session, and what resolves a common name that more
 *    than one species carries.
 *
 * Idempotent: re-running finds the existing rows and re-verifies the bytes rather
 * than creating a second registration. Dry-run by default, like its neighbours.
 *
 * Species are named by common name and each must resolve to **exactly one** row.
 * Two matches is refused rather than guessed -- choosing between two species with
 * one common name is not a decision this script can make.
 *
 * Usage:
 *   node scripts/register-model.js --name Star4 --source <file> --species "Bat star,Cookie star"
 *   node scripts/register-model.js --name Star4 --source <file> --species-file <file> --apply
 *
 * @fileoverview Repeatable registration of a trained model and its species.
 * @author Isaac Travers
 * @module scripts/register-model
 */

'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const db = require('../model');
const modelArtifactService = require('../service/model-artifact.service');

const { QueryTypes } = db.Sequelize;

/**
 * Read one named command-line argument.
 *
 * @param {string} name - The flag, including its leading dashes.
 * @returns {string|null} Its value, or null when absent.
 */
function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

/**
 * Hash a file without reading it all into memory.
 *
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Lower-case hex sha256.
 */
async function sha256(filePath) {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    for await (const chunk of stream) {
        digest.update(chunk);
    }

    return digest.digest('hex');
}

/**
 * Resolve one common name to exactly one species row.
 *
 * @async
 * @param {string} comname - The common name as the model reports it.
 * @returns {Promise<Object>} The species row.
 * @throws {Error} When it matches no species, or more than one.
 */
async function resolveSpecies(comname, speciesList) {
    const rows = await db.sequelize.query(
        `SELECT id, comname, species_list
           FROM species
          WHERE lower(comname) = lower(:comname)
            AND (:speciesList::varchar IS NULL OR species_list = :speciesList)`,
        { replacements: { comname, speciesList: speciesList || null }, type: QueryTypes.SELECT }
    );

    if (rows.length === 0) {
        throw new Error(
            `No species is called "${comname}". The model reports this class name, so either the species is `
            + 'missing from the catalogue or the model and MARP disagree about what it is called. Neither is '
            + 'something this script should paper over.'
        );
    }

    if (rows.length > 1) {
        throw new Error(
            `"${comname}" matches ${rows.length} species (${rows.map((r) => r.id).join(', ')}). Choosing `
            + 'between them is not this script\'s decision.'
        );
    }

    return rows[0];
}

async function main() {
    const name = argument('--name');
    const source = argument('--source');
    const speciesArgument = argument('--species');
    const speciesFile = argument('--species-file');
    // Which annotation list the names belong to.
    //
    // A common name identifies a species only *within* a list, and that stopped
    // being a nicety when the FathomNet models arrived: "Flatfish" is a
    // `GULF_Fish` species and also an MBARI benthic supercategory, so an
    // unscoped lookup finds two rows and this script correctly refuses to guess.
    // Naming the list is how the caller says which one they mean. Omitted, the
    // lookup stays as it was -- catalogue-wide, and refusing on ambiguity.
    const speciesList = argument('--species-list');
    const modelType = argument('--model-type') || 'detection';
    const apply = process.argv.includes('--apply');

    if (!name || !source || (!speciesArgument && !speciesFile)) {
        throw new Error(
            'Usage: node scripts/register-model.js --name <name> --source <file> '
            + '(--species "A,B" | --species-file <file>) [--model-type <type>] [--apply]'
        );
    }

    const sourcePath = path.resolve(source);
    const stat = await fsp.stat(sourcePath);

    if (!stat.isFile()) {
        throw new Error(`The source is not a file: ${sourcePath}`);
    }

    const comnames = (speciesFile
        ? (await fsp.readFile(speciesFile, 'utf8')).split('\n')
        : speciesArgument.split(','))
        .map((value) => value.trim())
        .filter(Boolean);

    if (comnames.length === 0) {
        throw new Error('No species names were given. A model with no species cannot have its output ingested.');
    }

    const hash = await sha256(sourcePath);
    // Named for the model, not `best.pt`.
    //
    // Every checkpoint downloaded from Hugging Face is called `best.pt`, so a
    // storage tree full of them is a tree where nothing on disk says which model
    // it is -- and this is the directory somebody digs through when a run has
    // produced the wrong animals. The directory already carries the name; so
    // does the file now. The extension follows the source, because an engine
    // picks its loader from it.
    const storagePath = path.posix.join(
        'models', name, 'weights', `${name}${path.extname(sourcePath) || '.pt'}`
    );
    const root = modelArtifactService.storageRoot();
    const destination = path.resolve(root, storagePath);

    console.log(`model        ${name}`);
    console.log(`source       ${sourcePath}  (${stat.size} bytes)`);
    console.log(`sha256       ${hash}`);
    console.log(`storage_path ${storagePath}`);
    console.log(`destination  ${destination}`);

    // Resolve every species before writing anything. A registration whose
    // species half failed leaves a model that can be leased and cannot be
    // ingested, which is a worse state than not registering at all.
    const species = [];

    for (const comname of comnames) {
        species.push(await resolveSpecies(comname, speciesList));
    }

    const lists = [...new Set(species.map((row) => row.species_list))];

    console.log(`species      ${species.length} resolved, on species_list: ${lists.join(', ')}`);

    for (const row of species) {
        console.log(`             ${String(row.id).padStart(5)}  ${row.comname}`);
    }

    if (lists.length > 1) {
        console.log(
            '\nNOTE: these species span more than one list, so this model\'s output will be accepted into '
            + 'a session of either type. That may be right; it is unusual enough to say out loud.'
        );
    }

    const existing = await db.ml_models.findOne({ where: { name } });

    if (!apply) {
        console.log(`\nregistration ${existing ? `exists, id ${existing.id}` : 'would be created'}`);
        console.log('Dry run. Nothing was written. Pass --apply.');
        return;
    }

    const model = existing || await db.ml_models.create({
        name,
        model_type: modelType,
        storage_path: storagePath,
        status: 'active',
        notes: `Registered by scripts/register-model.js from ${path.basename(sourcePath)}.`,
    });

    if (existing && existing.storage_path !== storagePath) {
        await existing.update({ storage_path: storagePath });
    }

    // The bytes, second. `resolveArtifact` refuses an absolute or escaping
    // `storage_path`, so this lands inside the storage root or not at all.
    await fsp.mkdir(path.dirname(destination), { recursive: true });

    let staged = false;

    try {
        const already = await sha256(destination);
        staged = already === hash;

        if (!staged) {
            console.log('destination holds different bytes; replacing them');
        }
    } catch {
        // Not there yet, which is the ordinary case.
    }

    if (!staged) {
        await fsp.copyFile(sourcePath, destination);

        const written = await sha256(destination);

        if (written !== hash) {
            throw new Error(`The copy does not match: wrote ${written}, expected ${hash}.`);
        }
    }

    // The species, last, and replaced wholesale rather than merged: the model's
    // trained classes are a fact about the file, so a re-registration of
    // different weights under the same name must not leave the old list behind.
    await db.sequelize.query(
        'DELETE FROM model_species WHERE model_id = :modelId',
        { replacements: { modelId: model.id } }
    );

    for (const row of species) {
        await db.sequelize.query(
            `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
             VALUES (:modelId, :speciesId, NOW(), NOW())`,
            { replacements: { modelId: model.id, speciesId: row.id } }
        );
    }

    console.log(`\nml_model_id  ${model.id}`);
    console.log(`artifact     staged and verified at ${destination}`);
    console.log(`model_species ${species.length} rows`);
    console.log('\nUse in a job spec:');
    console.log(JSON.stringify({
        name,
        sha256: hash,
        url: `/api/v2/model/${model.id}/artifact`,
        ml_model_id: model.id,
    }, null, 2));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`\n${error.message}`);
        process.exit(1);
    });
