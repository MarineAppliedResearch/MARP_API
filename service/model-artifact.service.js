/**
 * Resolves registered model artifacts beneath API-owned local storage.
 *
 * @fileoverview Safe filesystem boundary for registered ML model weights.
 * @author Isaac Travers
 * @module service/model-artifact
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const { createReadStream } = require('fs');
const path = require('path');
const datasetRepository = require('../repository/dataset.repository');
const db = require('../model');
const { describeWeights } = require('./model-weights.service');

function storageRoot() {
    return path.resolve(process.env.MODEL_STORAGE_ROOT || path.join('.marp', 'local'));
}

/**
 * Where a model's weights are on disk, if its `storage_path` stays inside the store.
 *
 * @param {Object} model - An `ml_models` row.
 * @returns {?string} Absolute path, or null for no path or one that climbs out.
 */
function weightsPath(model) {
    if (!model || !model.storage_path) return null;

    const root = storageRoot();
    const candidate = path.resolve(root, model.storage_path);
    const relative = path.relative(root, candidate);
    if (path.isAbsolute(model.storage_path)
        || relative === '..'
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)) {
        return null;
    }

    return candidate;
}

/**
 * Whether a model's weights are on disk, and how big they are (#321).
 *
 * Read when asked rather than stored: whether a file is there is a fact about this
 * machine now, and a stored copy is wrong the moment somebody moves one.
 *
 * @async
 * @param {Object} model - An `ml_models` row.
 * @returns {Promise<{present: boolean, bytes: ?number}>} What is on disk.
 */
async function weightsOf(model) {
    const candidate = weightsPath(model);
    if (!candidate) return { present: false, bytes: null };

    try {
        const stat = await fs.stat(candidate);
        return stat.isFile() ? { present: true, bytes: stat.size } : { present: false, bytes: null };
    } catch (error) {
        if (error.code === 'ENOENT') return { present: false, bytes: null };
        throw error;
    }
}

/** Hashes already computed, by path, size and modification time, so a file is hashed once. */
const hashed = new Map();

/**
 * The sha256 of a file, computed once per version of it.
 *
 * @async
 * @param {string} file - Absolute path.
 * @returns {Promise<string>} Lowercase hex digest.
 */
async function fileSha256(file) {
    const stat = await fs.stat(file);
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    if (hashed.has(key)) return hashed.get(key);

    const digest = await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject)
            .on('end', () => resolve(hash.digest('hex')));
    });
    hashed.set(key, digest);
    return digest;
}

/** Weights that could not be read, by version of the file, so one is not re-read on every listing. */
const unreadable = new Set();

/** A bare generation the migration wrote for an older YOLOv8 row, which the weights can refine. */
const BARE_GENERATION = /^yolo(v?\d+)$/i;

/**
 * Record what a model's weights say it is, when nothing has yet (#321).
 *
 * **The API keeps this itself rather than a script somebody has to run** (Isaac,
 * 2026-11-03). `engine`, `architecture_version` and `file_format` are facts inside the
 * `.pt`, so whenever MARP meets a model with weights on disk and no format recorded -- at
 * startup, listing the registry, opening one model, leasing a job -- it reads the file
 * (about 5 ms) and saves what it says. That covers models that predate #321 and any
 * placed in the store by hand later, with no step to remember on any machine.
 *
 * Only fills what is missing: an architecture somebody recorded is kept, except the bare
 * `yolov8` the migration gave older rows, which the weights make exact (`yolov8x`).
 *
 * @async
 * @param {Object} model - A plain `ml_models` row.
 * @returns {Promise<Object>} The row, with whatever was filled.
 */
async function describeIfUnrecorded(model) {
    if (!model || model.file_format) return model;

    const file = weightsPath(model);
    if (!file) return model;

    let stat;
    try {
        stat = await fs.stat(file);
    } catch {
        return model;
    }
    if (!stat.isFile()) return model;

    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    if (unreadable.has(key)) return model;

    let described;
    try {
        described = describeWeights(file);
    } catch {
        unreadable.add(key);
        return model;
    }
    if (!described.engine) {
        unreadable.add(key);
        return model;
    }

    const fields = { engine: described.engine, file_format: described.file_format };
    if (described.architecture && (!model.architecture_version || BARE_GENERATION.test(model.architecture_version))) {
        fields.architecture_version = described.architecture;
    }

    await db.ml_models.update(fields, { where: { id: model.id, file_format: null } });

    return { ...model, ...fields };
}

/**
 * The same, for one model by id: the lease path has an id, not a row.
 *
 * @async
 * @param {number} modelId - `ml_models.id`.
 * @returns {Promise<void>}
 */
async function describeIfUnrecordedById(modelId) {
    const model = await datasetRepository.getModelById(modelId);
    if (model) await describeIfUnrecorded(model.get ? model.get({ plain: true }) : model);
}

/**
 * Every model with no format recorded, read from its weights. Run at startup (#321).
 *
 * @async
 * @returns {Promise<{checked: number, filled: number}>} How many were looked at and filled.
 */
async function describeAllUnrecorded() {
    const models = await db.ml_models.findAll({ where: { file_format: null } });
    let filled = 0;

    for (const model of models) {
        const after = await describeIfUnrecorded(model.get({ plain: true }));
        if (after.file_format) filled += 1;
    }

    return { checked: models.length, filled };
}

async function resolveArtifact(modelId) {
    const model = await datasetRepository.getModelById(modelId);
    const candidate = weightsPath(model);
    if (!candidate) return null;

    try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) return null;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }

    return { model: model.get ? model.get({ plain: true }) : model, path: candidate };
}

module.exports = {
    resolveArtifact,
    storageRoot,
    weightsOf,
    weightsPath,
    fileSha256,
    describeIfUnrecorded,
    describeIfUnrecordedById,
    describeAllUnrecorded,
};
