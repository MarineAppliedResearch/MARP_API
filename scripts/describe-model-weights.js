/**
 * Fill each registered model's engine, architecture and file format from its weights.
 *
 * #321. `ml_models` never recorded what a model is: `architecture_version` held the
 * starting checkpoint's name or a training phase, and nothing held the engine. The weights
 * themselves say -- an Ultralytics `.pt` carries its model class and the YAML it was built
 * from -- and `service/model-weights.service.js` reads that without Python or torch, and
 * without executing anything in the file.
 *
 * For every model whose weights are on this machine:
 * - `engine`, `architecture_version` and `file_format` are set to what the weights say;
 * - `model_type` is set to the weights' task where it disagrees, and the value it replaces
 *   is appended to `notes`, as the migration does.
 *
 * A model whose weights are not here is left alone and listed. Run it wherever the model
 * store is: that is the only place the answer can be read.
 *
 * Idempotent and dry-run by default, like its neighbours.
 *
 * Usage:
 *   node scripts/describe-model-weights.js
 *   node scripts/describe-model-weights.js --apply
 *
 * @fileoverview Repeatable fill of ml_models' engine and architecture from the weights.
 * @author Isaac Travers
 * @module scripts/describe-model-weights
 */

'use strict';

require('dotenv').config();

const db = require('../model');
const modelArtifactService = require('../service/model-artifact.service');
const { describeWeights } = require('../service/model-weights.service');

/**
 * Read every model's weights and set what they say.
 *
 * @async
 * @param {boolean} apply - Write, rather than only report.
 * @returns {Promise<void>}
 */
async function main(apply) {
    const models = await db.ml_models.findAll({ order: [['id', 'ASC']] });
    let changed = 0;

    for (const model of models) {
        const file = modelArtifactService.weightsPath(model);
        const weights = await modelArtifactService.weightsOf(model);

        if (!file || !weights.present) {
            console.log(`  ${model.id} ${model.name}: no weights on this machine, left alone`);
            continue;
        }

        let described;
        try {
            described = describeWeights(file);
        } catch (error) {
            console.log(`  ${model.id} ${model.name}: weights could not be read (${error.message}), left alone`);
            continue;
        }

        const next = {
            engine: described.engine,
            architecture_version: described.architecture,
            file_format: described.file_format,
        };
        if (described.task && described.task !== model.model_type) {
            next.model_type = described.task;
            next.notes = [model.notes, `Before #321: model_type was '${model.model_type}'; the weights are ${described.task}.`]
                .filter(Boolean).join('\n');
        }

        const differs = Object.keys(next).filter((key) => key !== 'notes' && (next[key] ?? null) !== (model[key] ?? null));
        if (!differs.length) continue;

        changed += 1;
        console.log(`  ${model.id} ${model.name}: ${differs.map((key) => `${key} ${model[key] ?? 'null'} -> ${next[key] ?? 'null'}`).join(', ')}`);
        if (apply) await model.update(next);
    }

    console.log(`${changed} model(s) ${apply ? 'updated' : 'would be updated; --apply to write'}.`);
}

main(process.argv.includes('--apply'))
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error);
        await db.sequelize.close();
        process.exitCode = 1;
    });
