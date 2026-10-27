/**
 * Register the pretrained classifiers a classification run starts from.
 *
 * MARP has no `-cls` model registered, so the dashboard's base-model list is empty for
 * classification and nobody can queue one. These two are starting points, not models
 * MARP trained:
 *
 * - **`yolo11m-cls.pt`** -- YOLO11, generally better per parameter.
 * - **`yolov8m-cls.pt`** -- the family rockfish5 belongs to, which the worker identified
 *   by exact parameter count (68,163,201 parameters over 11 classes, so YOLOv8x rather
 *   than YOLO11).
 *
 * Registering both makes "which family" one training job rather than an argument.
 * Medium scale on purpose: a classifier for mosaic crops is judged on whether it helps a
 * reviewer, and x-scale is a great deal of model for small single-animal crops.
 *
 * **They carry no species, and `is_base` is what says so.** A pretrained classifier's
 * thousand ImageNet classes are not in MARP's catalogue; it has no species until
 * training gives it some, and the model trained *from* it takes its species from the
 * dataset the way a detector does. The flag is stated rather than inferred from an empty
 * `model_species`, because a trained model whose species nobody seeded yet also has
 * none -- that one is unhelpful, this one must never reach inference.
 *
 * **A registration with no bytes behind it is the failure `register-model.js` exists to
 * prevent** -- model 91 had a row and no file for weeks, and nothing could tell until a
 * second machine tried to run one. So this refuses rather than inserting a row whose
 * weights are missing, and verifies what it staged by hashing it back.
 *
 * **It does not load or execute the weights.** A `.pt` is a pickle; hashing and copying
 * are the only things done to one here.
 *
 * Idempotent and dry-run by default, like its neighbours.
 *
 * Usage:
 *   node scripts/seed-base-models.js --from <directory>
 *   node scripts/seed-base-models.js --from <directory> --apply
 *
 * @fileoverview Repeatable registration of the pretrained classification base models.
 * @author Isaac Travers
 * @module scripts/seed-base-models
 */

'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const db = require('../model');
const modelArtifactService = require('../service/model-artifact.service');

/** Where these weights come from, named once so no caller has to guess. */
const SOURCE_RELEASE = 'https://github.com/ultralytics/assets/releases/download/v8.4.0';

/**
 * What to register, and the bytes each one must be.
 *
 * **The hashes are pinned deliberately.** They were computed here from the files
 * downloaded from Ultralytics' official release assets and taken from no third party.
 * Pinning them means a later run against a different file is refused rather than quietly
 * registering something else under a name people have started to trust.
 *
 * @constant
 * @type {Array<Object>}
 */
const BASE_MODELS = [
    {
        name: 'yolo11m-cls',
        file: 'yolo11m-cls.pt',
        modelType: 'classification',
        bytes: 23487128,
        sha256: '80583b974e44292d56fc5ba4d26cd0bb04e77edc8bbf4317f7ce678147156dd5',
        notes: 'Pretrained YOLO11-medium classifier, Ultralytics assets v8.4.0. '
            + 'A starting point for training, never for inference.',
    },
    {
        name: 'yolov8m-cls',
        file: 'yolov8m-cls.pt',
        modelType: 'classification',
        bytes: 34285204,
        sha256: '864010e833b46be542ed849b2eb0fdacf51e4679dc677c18dcc4505244d08ec1',
        notes: 'Pretrained YOLOv8-medium classifier, Ultralytics assets v8.4.0. '
            + 'The family rockfish5 belongs to. A starting point for training, never for inference.',
    },
];

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
 * @async
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
 * Where a base model's weights live under the storage root.
 *
 * The shape `register-model.js` already uses, so one directory listing explains every
 * registered model rather than two conventions sitting side by side.
 *
 * @param {Object} entry - From `BASE_MODELS`.
 * @returns {string} A storage-root-relative POSIX path.
 */
function storagePathFor(entry) {
    return path.posix.join('models', entry.name, 'weights', entry.file);
}

/**
 * Register one base model, bytes first and row second.
 *
 * @async
 * @param {Object} entry - From `BASE_MODELS`.
 * @param {string} sourceDir - Directory holding the downloaded weights.
 * @param {boolean} apply - Whether to write.
 * @returns {Promise<Object>} What was done, for the summary.
 */
async function seedOne(entry, sourceDir, apply) {
    const source = path.resolve(sourceDir, entry.file);

    if (!fs.existsSync(source)) {
        throw new Error(
            `${entry.file} is not in ${sourceDir}. Download it from ${SOURCE_RELEASE}/${entry.file} `
            + 'and nowhere else. This script will not register a model whose bytes are missing.'
        );
    }

    const stat = await fsp.stat(source);
    const hash = await sha256(source);

    /* **Both checked, because they fail differently.** A wrong size is usually a
       truncated download; the right size with a wrong hash is a different file. Either
       way it is not what the name promises, and registering it would put a name people
       trust onto bytes nobody checked. */
    if (stat.size !== entry.bytes || hash !== entry.sha256) {
        throw new Error(
            `${entry.file} is not the file this script registers.\n`
            + `  expected ${entry.bytes} bytes, sha256 ${entry.sha256}\n`
            + `  found    ${stat.size} bytes, sha256 ${hash}`
        );
    }

    const storagePath = storagePathFor(entry);
    const destination = path.resolve(modelArtifactService.storageRoot(), storagePath);
    const existing = await db.ml_models.findOne({ where: { name: entry.name } });

    console.log(`\n${entry.name}`);
    console.log(`  source       ${source} (${stat.size} bytes)`);
    console.log(`  sha256       ${hash}`);
    console.log(`  storage_path ${storagePath}`);
    console.log(`  registration ${existing ? `exists, id ${existing.id}` : 'would be created'}`);

    if (!apply) {
        return { name: entry.name, id: existing ? existing.id : null, applied: false };
    }

    /* The bytes first. A row pointing at a file that is not there is the failure this
       whole script is shaped around, and it is only recoverable while nobody has tried
       to lease it yet. */
    await fsp.mkdir(path.dirname(destination), { recursive: true });

    let staged = false;

    try {
        staged = (await sha256(destination)) === hash;
    } catch {
        // Not there yet, which is the ordinary case.
    }

    if (!staged) {
        await fsp.copyFile(source, destination);

        const written = await sha256(destination);

        if (written !== hash) {
            throw new Error(`The copy does not match: wrote ${written}, expected ${hash}.`);
        }
    }

    const fields = {
        model_type: entry.modelType,
        storage_path: storagePath,
        status: 'active',
        is_base: true,
        artifact_sha256: hash,
        notes: entry.notes,
    };

    const model = existing
        ? await existing.update(fields)
        : await db.ml_models.create({ name: entry.name, ...fields });

    /* **No `model_species` rows, and none are removed either.** A base model has no
       species by definition, so there should never be any -- and deleting would be
       reaching into rows this script did not create. Finding some means something else
       wrote them, which is worth stopping for rather than tidying away. */
    const [{ count }] = await db.sequelize.query(
        'SELECT COUNT(*)::int AS count FROM model_species WHERE model_id = :id',
        { replacements: { id: model.id }, type: db.Sequelize.QueryTypes.SELECT }
    );

    if (count > 0) {
        throw new Error(
            `Model ${model.id} (${entry.name}) is a base model but carries ${count} model_species `
            + 'row(s). A base model has no species; something else wrote these and this script will '
            + 'not silently remove them.'
        );
    }

    console.log(`  registered   id ${model.id}, is_base true, ${count} species`);

    return { name: entry.name, id: model.id, applied: true, sha256: hash, storagePath };
}

/**
 * Seed both base models.
 *
 * @async
 * @returns {Promise<void>} Resolves when done.
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const sourceDir = argument('--from');

    if (!sourceDir) {
        throw new Error('--from <directory> is required: the directory holding the downloaded weights.');
    }

    console.log(`Base models, from ${path.resolve(sourceDir)}`);

    const done = [];

    for (const entry of BASE_MODELS) {
        done.push(await seedOne(entry, sourceDir, apply));
    }

    if (!apply) {
        console.log('\nDry run. Nothing was written. Pass --apply.');
    }

    console.log(`\n${done.filter((d) => d.applied).length} of ${BASE_MODELS.length} registered.`);
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(`\nFAILED: ${error.message}`);
        await db.sequelize.close();
        process.exit(1);
    });

module.exports = { BASE_MODELS, storagePathFor, SOURCE_RELEASE };
