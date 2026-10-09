/**
 * Copy weights into API-owned storage for an existing ml_models registration.
 * Dry-run by default; pass --apply to copy. Safe to run repeatedly.
 *
 * Usage: node scripts/stage-model-artifact.js --model-id <id> --source <file> [--apply]
 *
 * @fileoverview Repeatable local model artifact staging command.
 * @author Isaac Travers
 * @module scripts/stage-model-artifact
 */

'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const db = require('../model');
const modelArtifactService = require('../service/model-artifact.service');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

async function sha256(filePath) {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) digest.update(chunk);
    return digest.digest('hex');
}

async function main() {
    const modelId = argument('--model-id');
    const source = argument('--source');
    const apply = process.argv.includes('--apply');
    if (!modelId || !source) {
        throw new Error('Usage: node scripts/stage-model-artifact.js --model-id <id> --source <file> [--apply]');
    }

    const sourcePath = path.resolve(source);
    const sourceStat = await fsp.stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error('The source is not a file.');

    const model = await db.ml_models.findByPk(modelId);
    if (!model || !model.storage_path) throw new Error('The registered model or its storage_path was not found.');

    const root = modelArtifactService.storageRoot();
    const destination = path.resolve(root, model.storage_path);
    const relative = path.relative(root, destination);
    if (path.isAbsolute(model.storage_path) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error('The registered storage_path must remain beneath MODEL_STORAGE_ROOT.');
    }

    const digest = await sha256(sourcePath);
    console.log(`${apply ? 'Staging' : 'Would stage'} model ${model.id} (${model.name})`);
    console.log(`storage_path: ${model.storage_path}`);
    console.log(`sha256: ${digest}`);

    if (apply) {
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        if (sourcePath !== destination) await fsp.copyFile(sourcePath, destination);
        console.log('Staged.');
    } else {
        console.log('Dry run only. Pass --apply to copy.');
    }
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => db.sequelize.close());
