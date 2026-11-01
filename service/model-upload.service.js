'use strict';

/**
 * Register a model from weights somebody uploaded (#321).
 *
 * The dashboard's Register Model form was a mockup that called nothing; models arrived
 * only through training or the scripts in `scripts/`. Settled with Isaac on 2026-10-31:
 * upload a `.pt`, and MARP stores it, hashes it, reads what it is and its class names from
 * the file, and registers it. It moves to the file server later (#120).
 *
 * **Class names that match no species register with a warning** (Isaac, 2026-10-31): the
 * model is registered with the species that matched, and the rest are returned so the
 * screen can say that detections of those classes cannot become observations. A name
 * matching two species -- the same common name on two lists -- is unmatched too, because
 * choosing one would be a guess about what was meant.
 *
 * @module service/model-upload
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const modelArtifactService = require('./model-artifact.service');
const { describeWeights } = require('./model-weights.service');

/** Where uploaded weights live, as trained ones do. */
const MODEL_PATH_PREFIX = 'models';

/** A file name made from a model name: letters, digits and a little punctuation. */
const safeName = (name) => name.replace(/[^A-Za-z0-9._()-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';

/**
 * Match class names to species, ignoring case.
 *
 * @async
 * @param {string[]} classNames - From the weights.
 * @param {Object} transaction - The open transaction.
 * @returns {Promise<{matched: Array<{class_name, species_id}>, unmatched: Array<{class_name, matches}>}>}
 */
async function matchSpecies(classNames, transaction) {
    const matched = [];
    const unmatched = [];

    for (const name of classNames) {
        const rows = await db.sequelize.query(
            'SELECT id FROM species WHERE lower(comname) = lower(:name)',
            { replacements: { name }, type: db.Sequelize.QueryTypes.SELECT, transaction, logging: false }
        );

        if (rows.length === 1) matched.push({ class_name: name, species_id: rows[0].id });
        else unmatched.push({ class_name: name, matches: rows.length });
    }

    return { matched, unmatched };
}

/**
 * Register uploaded weights as a model.
 *
 * @async
 * @param {Object} upload - `{file, name, version_label, notes, parent_model_id}`; `file` is
 *   the temporary path multer wrote.
 * @returns {Promise<Object>} `{model, class_names, matched, unmatched}`.
 * @throws {ApiError} 400 for a missing name or weights that are not an Ultralytics model,
 *   409 for a name already registered.
 */
async function registerUploadedModel(upload) {
    const temporary = upload.file;

    try {
        const name = String(upload.name || '').trim();
        if (!name) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A model name is required.');
        if (name.length > 255) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'A model name is at most 255 characters.');

        const label = upload.version_label ? String(upload.version_label).trim().slice(0, 64) || null : null;
        const parent = upload.parent_model_id ? Number(upload.parent_model_id) : null;
        if (parent !== null && !Number.isInteger(parent)) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'parent_model_id must be a model id.');
        }

        let described;
        try {
            described = describeWeights(temporary);
        } catch (error) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, `That file is not a model MARP can read: ${error.message}.`);
        }
        if (described.engine !== 'ultralytics' || !described.class_names.length) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR,
                'That file is not an Ultralytics model with class names, which is what MARP can run.');
        }

        if (await db.ml_models.findOne({ where: { name } })) {
            throw new ApiError(409, ERROR_CODES.CONFLICT, `A model called "${name}" is already registered.`);
        }

        const sha256 = await modelArtifactService.fileSha256(temporary);
        const relative = `${MODEL_PATH_PREFIX}/${safeName(name)}/weights/${safeName(name)}.pt`;
        const destination = path.resolve(modelArtifactService.storageRoot(), relative);
        if (fs.existsSync(destination)) {
            throw new ApiError(409, ERROR_CODES.CONFLICT, `Weights are already stored at ${relative}; choose another name.`);
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(temporary, destination);

        try {
            return await db.sequelize.transaction(async (transaction) => {
                const model = await db.ml_models.create({
                    name,
                    model_type: described.task || 'detection',
                    architecture_version: described.architecture,
                    engine: described.engine,
                    file_format: described.file_format,
                    storage_path: relative,
                    artifact_sha256: sha256,
                    status: 'active',
                    version_label: label,
                    parent_model_id: parent,
                    notes: upload.notes ? String(upload.notes) : `Uploaded from the dashboard as ${upload.original_name || 'a .pt file'}.`,
                }, { transaction });

                const { matched, unmatched } = await matchSpecies(described.class_names, transaction);
                for (const one of matched) {
                    await db.sequelize.query(
                        `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
                         VALUES (:modelId, :speciesId, now(), now())`,
                        { replacements: { modelId: model.id, speciesId: one.species_id }, transaction, logging: false }
                    );
                }

                return { model: model.get({ plain: true }), class_names: described.class_names, matched, unmatched };
            });
        } catch (error) {
            // Nothing registered, so nothing may be left on disk under its name.
            fs.rmSync(destination, { force: true });
            throw error;
        }
    } finally {
        if (temporary && fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
}

module.exports = { registerUploadedModel, matchSpecies, safeName };
