/**
 * Turns the weights a training run produced into a model MARP can run.
 *
 * Until this existed the pool could train a model and not use one: the weights were
 * published, recorded as an artifact against the job, and that was the end of them. There
 * was no `ml_models` row to name in an inference job spec, so the thing somebody had just
 * trained was a 136 MB file nobody could reach.
 *
 * Three things have to be true for a registered model to actually work, and each of them
 * is a decision rather than a detail:
 *
 * **The bytes have to be where models are served from.** The published artifact lives in
 * the GPU artifact store, content-addressed, and `/api/v2/model/:id/artifact` serves from
 * `MODEL_STORAGE_ROOT` — a different tree. So the file is copied into the model store.
 * The duplicate is deliberate: one serving path is worth 136 MB, and the file server in
 * #120 is what later takes both over.
 *
 * **It has to say which species it knows.** The tracking engine refuses weights whose
 * vocabulary disagrees with what MARP registered for them, so a model with no
 * `model_species` is a model no inference job can run. The species come from the
 * dataset's own vocabulary, `dataset_classes`, which records a species per class index
 * rather than a name to be matched later (#268).
 *
 * **It must not quietly become the default.** A newly trained model is usable immediately
 * and is not `preferred`: promoting it is a human act, after somebody has looked at what
 * it scored.
 *
 * Lives in the repository layer rather than above it because registration happens inside
 * the transaction that closes the training run -- a model that exists while its run is
 * still open, or that is missing after a run that succeeded, are both states somebody
 * would have to reconcile by hand.
 *
 * @fileoverview Registering the model a training run produced.
 * @author Isaac Travers
 * @module repository/trained-model
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');
// `storageRoot` is a path helper rather than business logic, and this is the one place
// it is defined. Duplicating the `MODEL_STORAGE_ROOT` default here is what would
// eventually let the route and the writer disagree about where models live.
const { storageRoot } = require('../service/model-artifact.service');
const logger = require('../logger/api.logger');

/** Where a registered model's weights are kept, relative to the model storage root. */
const MODEL_PATH_PREFIX = 'models';

/** The artifact role the finished weights are published under. */
const WEIGHTS_ROLE = 'weights';


/**
 * The name a trained model is registered under.
 *
 * Composed rather than asked for. A person naming every run would be naming it before
 * they knew anything about it, and `ml_models.name` is NOT NULL so it cannot simply be
 * left out the way a job's name can. Dataset plus date is what somebody scanning a list
 * actually wants to tell two runs apart; a nickname for the one they care about is a
 * dashboard affordance and a different piece of work.
 *
 * @param {string} datasetName - What the dataset is called.
 * @param {Date} when - When the run finished.
 * @returns {string} The base name, before collisions are resolved.
 */
function composeName(datasetName, when) {
    const day = when.toISOString().slice(0, 10);
    const stem = String(datasetName || 'training').trim().replace(/\s+/g, '-');
    return `${stem}-${day}`;
}


/**
 * Resolves the dataset's class names to species ids.
 *
 * **Exactly one match, or the registration fails.** A name matching nothing, or matching
 * two rows, means the model's vocabulary cannot be stated — and a model registered with a
 * hole in its vocabulary is one the tracking engine will refuse later, somewhere far from
 * here. Common names are not unique across the catalogue, which is why "two matches" is a
 * real case rather than a defensive one.
 *
 * @async
 * @param {Object} db - The models object.
 * @param {string[]} classNames - The dataset's class names, in index order.
 * @param {Object} transaction - The open transaction.
 * @returns {Promise<number[]>} Species ids, in the same order.
 * @throws {Error} When a name does not resolve to exactly one species.
 */
async function resolveSpecies(db, classNames, transaction) {
    const ids = [];

    for (const name of classNames) {
        const rows = await db.sequelize.query(
            'SELECT id FROM species WHERE comname = :name',
            { replacements: { name }, type: db.Sequelize.QueryTypes.SELECT, transaction, logging: false }
        );

        if (rows.length !== 1) {
            throw new Error(
                `dataset class "${name}" matches ${rows.length} species by common name; `
                + 'a model cannot be registered without knowing what it was trained on'
            );
        }
        ids.push(rows[0].id);
    }

    return ids;
}


/**
 * Registers the model a finished training job produced.
 *
 * Called from the same transaction that closes the training run, so a model never exists
 * for a run that is still open and never fails to exist for one that succeeded.
 *
 * Does nothing, without complaint, for a job that is not training, that did not succeed,
 * that published no weights, or that has already been registered — the last being what
 * makes a re-reported job produce one model rather than two.
 *
 * @async
 * @param {Object} params - The call.
 * @param {Object} params.db - The models object.
 * @param {Object} params.job - The job row, with `id`, `kind` and `spec`.
 * @param {Object} params.transaction - The open transaction.
 * @returns {Promise<Object|null>} `{id, name, species}` when one was registered.
 */
async function registerTrainedModel({ db, job, transaction }) {
    if (!job || job.kind !== 'training') return null;

    const spec = job.spec || {};

    // Already registered. The check is the job, not the hash: re-reporting a finished job
    // must not produce a second model, and the weights of one run are one model.
    const [existing] = await db.sequelize.query(
        `SELECT m.id FROM ml_models m
           JOIN training_runs r ON r.model_id IS NOT NULL AND r.job_id = :jobId
          WHERE m.notes LIKE :marker
          LIMIT 1`,
        {
            replacements: { jobId: job.id, marker: `%trained by GPU job ${job.id}.%` },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
            logging: false,
        }
    );
    if (existing) return null;

    // The weights, as the worker published them.
    const [artifact] = await db.sequelize.query(
        `SELECT hash, path FROM artifacts
          WHERE job_id = :jobId AND artifact_type = :role
          ORDER BY id DESC LIMIT 1`,
        {
            replacements: { jobId: job.id, role: WEIGHTS_ROLE },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
            logging: false,
        }
    );

    // A run that finished without publishing weights has nothing to register. That is a
    // real outcome -- a job stopped before its first improvement -- and not an error.
    if (!artifact || !artifact.hash) return null;

    const source = path.join(ARTIFACT_DIRECTORY, artifact.hash);
    if (!fs.existsSync(source)) {
        throw new Error(`weights ${artifact.hash} are recorded but missing from the artifact store`);
    }

    const dataset = spec.dataset || {};
    const classNames = await datasetClassNames(db, dataset.dataset_id, transaction);
    const speciesIds = await resolveSpecies(db, classNames, transaction);

    // A name nobody else has. The suffix is a counter rather than a timestamp, because two
    // runs over one dataset on one day is the case this exists for and `-2` says that
    // plainly.
    const base = composeName(dataset.name, new Date());
    const name = await uniqueName(db, base, transaction);

    // Copied into the model store, because that is where the route that serves models
    // looks. Written to a temporary name and renamed, so a half-copied file is never
    // something a worker could fetch.
    const relative = `${MODEL_PATH_PREFIX}/${name}/weights/${name}.pt`;
    const destination = path.resolve(storageRoot(), relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const partial = `${destination}.partial`;
    fs.copyFileSync(source, partial);
    fs.renameSync(partial, destination);

    const parent = spec.model && spec.model.ml_model_id ? Number(spec.model.ml_model_id) : null;
    const modelType = await deriveModelType(db, { parent, datasetId: dataset.dataset_id, transaction });
    const [registered] = await db.sequelize.query(
        /* **`artifact.hash` is already the sha256 of these bytes**, because the
           artifact store is content-addressed -- the file this just copied was read from
           `ARTIFACT_DIRECTORY/<hash>`. So recording the checksum here costs nothing
           and hashes nothing; it stops being a sentence in `notes` that only a person
           can read and becomes the field a job spec is composed from. */
        /* **`training_run_id` is set here, where the answer is known.** The sentence
           appended to `training_runs.notes` below recorded the same link in prose, which
           no query can join on -- the registry read `training_runs.model_id` instead and
           named every model after the checkpoint it trained from. The subquery is the
           same run that sentence is written to. */
        `INSERT INTO ml_models (name, parent_model_id, model_type, architecture_version,
                                storage_path, artifact_sha256, status, preferred, notes,
                                training_run_id, created_at, updated_at)
         VALUES (:name, :parent, :modelType, :architecture, :storagePath, :sha256, 'active',
                 false, :notes,
                 (SELECT id FROM training_runs WHERE job_id = :jobId ORDER BY id DESC LIMIT 1),
                 now(), now())
         RETURNING id`,
        {
            replacements: {
                name,
                parent,
                modelType,
                architecture: (spec.model && spec.model.name) || null,
                storagePath: relative,
                sha256: String(artifact.hash).toLowerCase(),
                /* The sentence stays. It is the human-readable provenance, and the
                   guard at the top of this function reads it to refuse registering the
                   same job twice. */
                notes: `Weights ${artifact.hash} trained by GPU job ${job.id}.`,
                jobId: job.id,
            },
            type: db.Sequelize.QueryTypes.INSERT,
            transaction,
            logging: false,
        }
    );
    const modelId = registered[0].id;

    for (const speciesId of speciesIds) {
        await db.sequelize.query(
            `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
             VALUES (:modelId, :speciesId, now(), now())`,
            { replacements: { modelId, speciesId }, transaction, logging: false }
        );
    }

    // The run now points at what it produced rather than only at what it started from.
    await db.sequelize.query(
        'UPDATE training_runs SET notes = concat(coalesce(notes, \'\'), :note), updated_at = now() '
        + 'WHERE job_id = :jobId',
        {
            replacements: { jobId: job.id, note: ` Produced ml_models ${modelId}.` },
            transaction,
            logging: false,
        }
    );

    logger.info(`Registered trained model ${modelId} (${name}) from job ${job.id}`);
    return { id: modelId, name, species: speciesIds.length };
}


/**
 * What kind of model a training run produced.
 *
 * **It used to be the literal `'detection'`**, which was true of every run MARP had done
 * and stopped being true the first time one was not: model 441,
 * `Session-625-classify-test-2026-10-28`, is a classifier trained from `yolo11m-cls` and
 * was registered as a detector. Nothing refuses that, and nothing downstream can tell --
 * the registry, the task filter on the training form, and anything choosing a model to run
 * all read this column and would have been wrong about it for as long as it stood.
 *
 * **The checkpoint first, the dataset second.** The parent is what was actually
 * fine-tuned, and a checkpoint decides the task -- the engine is never told which task was
 * asked for, which is why the training form filters its dropdown by task and
 * `training-submit.test.mjs` pins that filter as a rule rather than a courtesy. The
 * dataset's own `task` is the same answer arrived at from the other side, and it stands in
 * when a run named its weights by name and hash without naming a registered model.
 *
 * **Refused rather than defaulted when neither can say.** `ml_models.model_type` is NOT
 * NULL, so there is no honest gap to leave, and a guess here is precisely the defect being
 * fixed: the weights are safe in the artifact store and a loud failure can be re-run,
 * where a model silently filed under the wrong kind is found months later by somebody
 * wondering why it will not load.
 *
 * @async
 * @param {Object} db - The models object.
 * @param {Object} params - `{parent, datasetId, transaction}`.
 * @returns {Promise<string>} The `model_type` to record.
 * @throws {Error} When neither the checkpoint nor the dataset says.
 */
async function deriveModelType(db, { parent, datasetId, transaction }) {
    if (parent) {
        const [row] = await db.sequelize.query(
            'SELECT model_type FROM ml_models WHERE id = :parent',
            { replacements: { parent }, type: db.Sequelize.QueryTypes.SELECT, transaction }
        );

        if (row && row.model_type) return row.model_type;
    }

    if (datasetId) {
        const [row] = await db.sequelize.query(
            'SELECT task FROM datasets WHERE id = :datasetId',
            { replacements: { datasetId }, type: db.Sequelize.QueryTypes.SELECT, transaction }
        );

        if (row && row.task) return row.task;
    }

    throw new Error(
        `cannot tell what kind of model this run produced: checkpoint ${parent || 'unnamed'} has no `
        + `model_type and dataset ${datasetId || 'unnamed'} has no task. Record one of the two and `
        + 'register again -- guessing here is how model 441 was filed as a detector.'
    );
}

/**
 * The class names a dataset was packaged with.
 *
 * @async
 * @param {Object} db - The models object.
 * @param {number} datasetId - `datasets.id`.
 * @param {Object} transaction - The open transaction.
 * @returns {Promise<string[]>} The names, in index order.
 * @throws {Error} When the dataset has none recorded.
 */
async function datasetClassNames(db, datasetId, transaction) {
    /* From `dataset_classes`, which records a *species* per index, rather than from the
       `class_names` strings this used to read. The two were written hours apart for the
       same question and settled into one on 2026-10-20 (#268). Resolving strings against
       `species.comname` worked for `rockfish5` and would break the first time a species
       was renamed -- which has happened in this platform, under records that were correct
       when they were made. An index means a species; the name is how it is printed. */
    const rows = await db.sequelize.query(
        `SELECT s.comname
           FROM dataset_classes dc
           JOIN species s ON s.id = dc.species_id
          WHERE dc.dataset_id = :id
          ORDER BY dc.class_index`,
        { replacements: { id: datasetId }, type: db.Sequelize.QueryTypes.SELECT, transaction, logging: false }
    );

    if (!rows.length) {
        throw new Error(
            `dataset ${datasetId} has no recorded classes, so the model it trained `
            + 'cannot say what it knows; build or re-package it to record them'
        );
    }

    return rows.map((row) => String(row.comname));
}


/**
 * A model name nothing else is using.
 *
 * @async
 * @param {Object} db - The models object.
 * @param {string} base - The composed name.
 * @param {Object} transaction - The open transaction.
 * @returns {Promise<string>} `base`, or `base-2`, `base-3` and so on.
 */
async function uniqueName(db, base, transaction) {
    for (let suffix = 1; suffix < 100; suffix += 1) {
        const candidate = suffix === 1 ? base : `${base}-${suffix}`;
        const rows = await db.sequelize.query(
            'SELECT 1 FROM ml_models WHERE name = :name LIMIT 1',
            { replacements: { name: candidate }, type: db.Sequelize.QueryTypes.SELECT, transaction, logging: false }
        );
        if (rows.length === 0) return candidate;
    }

    throw new Error(`cannot find an unused name for ${base}`);
}


module.exports = { registerTrainedModel, composeName };
