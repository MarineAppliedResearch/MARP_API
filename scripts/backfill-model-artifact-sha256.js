/**
 * Records the sha256 of every already-registered model's weights.
 *
 * `ml_models.artifact_sha256` is written from `20261023010000` onwards -- by the
 * registration path when a training run produces a model, and by
 * `scripts/stage-model-artifact.js` when one is staged by hand. Every model registered
 * before that has a null, which means the Training screen cannot compose a job spec
 * against it: a spec must carry `spec.model.sha256` because the worker hashes what it
 * fetched and refuses a mismatch.
 *
 * **Hashing the file, for every model, rather than reading it from anywhere.** For the
 * models MARP trained the digest is also inside a sentence in `notes` ("Weights 5e5a...
 * trained by GPU job 21542."), and it would be cheaper to parse. It is not read: prose is
 * not a field, two of sixteen models have that sentence, and a backfill with two code
 * paths is a backfill where one of them is never exercised. Hashing is exact for all of
 * them and is paid once.
 *
 * **A model whose artifact is missing records nothing, not an empty string.** Its
 * checksum is unknown, which is a different fact from having none, and a null is what the
 * submit path refuses on. Same rule the split-image backfill follows for a dataset whose
 * archive cannot be read.
 *
 * **It never overwrites a recorded hash unless asked.** A value already there was written
 * by the registration path from the artifact store's own content address, which is at
 * least as trustworthy as re-reading the file; `--recheck` hashes anyway and reports a
 * disagreement, which would mean the bytes under a registration have changed.
 *
 * A script rather than a data migration, because it depends on the artifacts being on the
 * machine that runs it -- a migration would record itself applied on a server whose model
 * store lives elsewhere and leave the column null for ever.
 *
 *   node scripts/backfill-model-artifact-sha256.js             # dry run; writes nothing
 *   node scripts/backfill-model-artifact-sha256.js --apply
 *   node scripts/backfill-model-artifact-sha256.js --apply --recheck
 *
 * Idempotent: a second run finds the hashes recorded and does nothing. Run from the
 * repository root, so `dotenv` finds `.env` and `MODEL_STORAGE_ROOT` with it.
 *
 * @fileoverview Backfills ml_models.artifact_sha256 for models registered before it existed.
 * @module scripts/backfill-model-artifact-sha256
 */

'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');

const db = require('../model');
const modelArtifactService = require('../service/model-artifact.service');

/**
 * The sha256 of a file, streamed.
 *
 * Streamed rather than read whole because a `.pt` is tens to hundreds of megabytes and
 * this walks every registered one.
 *
 * @async
 * @param {string} filePath - The artifact.
 * @returns {Promise<string>} Lowercase hex.
 */
async function sha256(filePath) {
    const digest = crypto.createHash('sha256');

    for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);

    return digest.digest('hex');
}

/**
 * Every registered model, oldest first.
 *
 * @async
 * @returns {Promise<Object[]>} `{id, name, storage_path, artifact_sha256}`.
 */
async function candidates() {
    return db.sequelize.query(
        `SELECT id, name, storage_path, artifact_sha256
           FROM ml_models
          ORDER BY id`,
        { type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );
}

/**
 * Works out and records one model's checksum.
 *
 * @async
 * @param {Object} model - From {@link candidates}.
 * @param {boolean} apply - Whether to write.
 * @param {boolean} recheck - Hash again even when one is recorded.
 * @returns {Promise<string>} What happened, for the report.
 */
async function backfill(model, apply, recheck) {
    if (model.artifact_sha256 && !recheck) return 'already recorded';

    if (!model.storage_path) return 'no storage_path, so there is no artifact to hash';

    /* Resolved through the service rather than by joining paths here, so this is subject
       to the same containment check the download route is -- a `storage_path` that climbs
       out of the model store resolves to nothing in both places rather than only one. */
    const artifact = await modelArtifactService.resolveArtifact(model.id);

    if (!artifact) {
        /* The ordinary case for a model registered on another machine, and not a failure
           of this script: there is no file here, so the checksum stays unknown. */
        return 'artifact not on this machine, so nothing recorded';
    }

    const bytes = fs.statSync(artifact.path).size;
    const started = Date.now();
    const digest = await sha256(artifact.path);
    const took = `${(bytes / 1048576).toFixed(1)} MB in ${Date.now() - started} ms`;

    if (model.artifact_sha256 && model.artifact_sha256.toLowerCase() === digest) {
        return `unchanged (${took})`;
    }

    /* **A disagreement is reported and not written.** The recorded hash came from the
       artifact store's own content address; if the file under the registration now hashes
       differently, the bytes a job would fetch are not the bytes that were registered,
       and quietly recording the new ones would erase the evidence. */
    if (model.artifact_sha256) {
        return `MISMATCH: recorded ${model.artifact_sha256}, file hashes ${digest} -- not written`;
    }

    if (apply) {
        await db.sequelize.query(
            `UPDATE ml_models
                SET artifact_sha256 = :digest, updated_at = NOW()
              WHERE id = :id AND artifact_sha256 IS NULL`,
            { replacements: { id: model.id, digest }, logging: false }
        );
    }

    return `${digest} (${took})`;
}

/**
 * Reports what it would do, or does it.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const recheck = process.argv.includes('--recheck');

    console.log(apply ? '== recording ==' : '== dry run; nothing will be written ==');
    console.log(`model store: ${modelArtifactService.storageRoot()}`);

    const models = await candidates();

    if (!models.length) {
        console.log('No model is registered, so there is nothing to hash.');

        return;
    }

    let mismatched = 0;

    for (const model of models) {
        const outcome = await backfill(model, apply, recheck);

        if (outcome.startsWith('MISMATCH')) mismatched += 1;

        console.log(`  ${String(model.id).padStart(5)}  ${model.name}: ${outcome}`);
    }

    if (!apply) console.log('\nnothing written. Re-run with --apply.');

    // A non-zero exit, so a mismatch is not something a caller has to read the log to find.
    if (mismatched) {
        console.error(`\n${mismatched} model${mismatched === 1 ? '' : 's'} disagree with the recorded hash.`);
        process.exitCode = 1;
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exitCode = 1;
    });
