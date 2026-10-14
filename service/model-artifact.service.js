/**
 * Resolves registered model artifacts beneath API-owned local storage.
 *
 * @fileoverview Safe filesystem boundary for registered ML model weights.
 * @author Isaac Travers
 * @module service/model-artifact
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');
const datasetRepository = require('../repository/dataset.repository');

function storageRoot() {
    return path.resolve(process.env.MODEL_STORAGE_ROOT || path.join('.marp', 'local'));
}

async function resolveArtifact(modelId) {
    const model = await datasetRepository.getModelById(modelId);
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

    try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) return null;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }

    return { model: model.get ? model.get({ plain: true }) : model, path: candidate };
}

module.exports = { resolveArtifact, storageRoot };
