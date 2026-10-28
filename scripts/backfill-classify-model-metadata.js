#!/usr/bin/env node

/**
 * Repair what the first classification run recorded wrongly.
 *
 * Two defects, both found by running one: job 21800, training run 209, the first
 * classification training MARP has done. Neither is reachable by re-ingesting, because
 * both were written correctly-shaped and wrong.
 *
 * **1. Confusion matrix axes labelled with dataset folder handles.** Ultralytics takes a
 * classify vocabulary from the subfolder names and keeps no other list, and MARP's folders
 * are handles -- `145_blue-deacon-rockfish` -- because `comname` is not a filesystem-safe
 * string. For a classification run the matrix is the *only* per-class output there is, so
 * untranslated it leaves nothing readable about the model at all.
 *
 * **2. A trained model registered under the wrong kind.** Registration wrote the literal
 * `'detection'` for every run, which was true of all of them until this one: model 441 is
 * a classifier trained from `yolo11m-cls`, filed as a detector, with nothing downstream
 * able to tell.
 *
 * **A script rather than a migration, and rather than SQL typed into a terminal.** The
 * label resolution has three readings in a deliberate order -- the dataset's recorded
 * folder mapping, then the species id on the front of the handle, then the name -- and a
 * second copy of that in SQL would drift from the one in
 * `service/training-metrics.service.js` the first time either moved. Rows typed by hand
 * exist on exactly one computer and are gone the next time that database is rebuilt.
 *
 * **Dry run by default**, like `seed-inference-context.js`: it says what it would change
 * and changes nothing until `--apply`. Idempotent -- a matrix whose handles are already
 * recorded is left alone, and a model whose type already agrees is not rewritten.
 *
 * **Reversible, which is why the handles are kept.** `class_handles` holds what the model
 * reported, so putting the original labels back is a column copy rather than an
 * archaeology exercise.
 *
 * ```bash
 * node scripts/backfill-classify-model-metadata.js            # say what would change
 * node scripts/backfill-classify-model-metadata.js --apply    # change it
 * ```
 *
 * @fileoverview Backfill for run 209's matrix labels and model 441's type.
 * @author Isaac Travers
 * @module scripts/backfill-classify-model-metadata
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const trainingMetricsService = require('../service/training-metrics.service');

const APPLY = process.argv.includes('--apply');

/**
 * Every stored matrix whose labels have not been translated yet.
 *
 * `class_handles IS NULL` is the whole test: a translated row records what the model
 * said, so one that records nothing has not been through this.
 *
 * @async
 * @returns {Promise<Array<Object>>} The rows, with their run's model and dataset.
 */
async function untranslatedMatrices() {
    return db.sequelize.query(
        `SELECT m.id, m.training_run_id, m.dataset_split, m.class_names,
                r.model_id, r.dataset_id
           FROM training_run_confusion_matrices m
           JOIN training_runs r ON r.id = m.training_run_id
          WHERE m.class_handles IS NULL
          ORDER BY m.id`,
        { type: QueryTypes.SELECT }
    );
}

/**
 * Models registered by a training run whose type disagrees with their checkpoint.
 *
 * Only models that came from a run are considered: a base model's type is what somebody
 * registered it as and is not this script's business.
 *
 * @async
 * @returns {Promise<Array<Object>>} `{id, name, model_type, parent_type, dataset_task}`.
 */
async function mistypedModels() {
    return db.sequelize.query(
        `SELECT m.id, m.name, m.model_type,
                parent.model_type AS parent_type,
                d.task            AS dataset_task
           FROM ml_models m
           LEFT JOIN ml_models parent ON parent.id = m.parent_model_id
           LEFT JOIN training_runs r  ON r.id = m.training_run_id
           LEFT JOIN datasets d       ON d.id = r.dataset_id
          WHERE m.training_run_id IS NOT NULL
            AND COALESCE(parent.model_type, d.task) IS NOT NULL
            AND m.model_type IS DISTINCT FROM COALESCE(parent.model_type, d.task)
          ORDER BY m.id`,
        { type: QueryTypes.SELECT }
    );
}

/**
 * Work out and optionally write both repairs.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    console.log(APPLY ? 'Applying.' : 'Dry run. Nothing will be written without --apply.');

    const matrices = await untranslatedMatrices();
    let relabelled = 0;

    for (const row of matrices) {
        const classes = Array.isArray(row.class_names) ? row.class_names : [];

        if (classes.length === 0) continue;

        /* The service's own resolution, so this cannot drift from what the ingest does
           to a matrix arriving today. */
        const { names, handles, translated } = await trainingMetricsService.resolveMatrixLabels(
            classes,
            { model_id: row.model_id, dataset_id: row.dataset_id }
        );

        if (translated === 0) continue;

        console.log(`  matrix ${row.id} (run ${row.training_run_id}, ${row.dataset_split}): `
            + `${translated} of ${classes.length} labels`);
        console.log(`    ${handles[0]} -> ${names[0]}`
            + (classes.length > 1 ? `  … ${handles[classes.length - 1]} -> ${names[classes.length - 1]}` : ''));

        if (APPLY) {
            await db.sequelize.query(
                `UPDATE training_run_confusion_matrices
                    SET class_names = :names, class_handles = :handles, updated_at = NOW()
                  WHERE id = :id`,
                {
                    replacements: { id: row.id, names: JSON.stringify(names), handles: JSON.stringify(handles) },
                    logging: false,
                }
            );
        }

        relabelled += 1;
    }

    const models = await mistypedModels();

    for (const model of models) {
        const correct = model.parent_type || model.dataset_task;

        console.log(`  model ${model.id} (${model.name}): ${model.model_type} -> ${correct}`
            + `  [${model.parent_type ? 'from its checkpoint' : 'from its dataset'}]`);

        if (APPLY) {
            await db.sequelize.query(
                'UPDATE ml_models SET model_type = :type, updated_at = NOW() WHERE id = :id',
                { replacements: { id: model.id, type: correct }, logging: false }
            );
        }
    }

    console.log(`${APPLY ? 'Relabelled' : 'Would relabel'} ${relabelled} matrix row(s) `
        + `and ${APPLY ? 'corrected' : 'would correct'} ${models.length} model(s).`);

    if (!APPLY && (relabelled || models.length)) {
        console.log('Re-run with --apply to write these.');
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exitCode = 1;
    });
