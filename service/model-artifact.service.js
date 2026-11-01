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

module.exports = { resolveArtifact, storageRoot, weightsOf, weightsPath, fileSha256 };
