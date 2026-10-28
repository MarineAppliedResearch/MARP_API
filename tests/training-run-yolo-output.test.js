/**
 * What a training run measured, from the artifact on disk to the endpoint.
 *
 * **Written before they could be run, and three fixture faults showed up the moment
 * they were.** This workspace had no loadable database at the time: every database
 * `marp db up` creates carries production's name, and the danger-gate refuses any
 * command naming it -- rightly, since only the host tells the two apart. The way
 * through was a database of this worktree's own, not a rephrasing of the refused
 * command. What the first execution then caught, all three in the fixture rather than
 * in the code under test: `species.taxserial` is NOT NULL with no default and there is
 * no `is_active` column; `model_species` needs its timestamps; and a PNG stub recorded
 * as `application/json` made the byte-serving test try to parse it -- which was the
 * route correctly serving what the hand-off had recorded. Kept as a reminder that a
 * test nobody has run is a draft.
 *
 * **Where the fixtures come from, because that is the thing that has gone wrong twice
 * here.** The `metric` event payload is copied from `gpu_job_events` on the development
 * database, including the `child_kind` field that appears in no document. The
 * `final_metrics` and `metrics_curves` artifacts are **not** from traffic -- no run has
 * ever produced one, because the worker half is agreed and unbuilt -- so they are built
 * from what the worker session read out of Ultralytics 8.4.145: `metrics.py:400` being
 * `matrix[predicted][true]`, background at index `nc`, `ap_class_index` holding only
 * classes that appeared in validation, and `mean_results()` returning four values with
 * no F1 among them. That is a contract, not an observation, and it is the weakest
 * evidence in this work.
 *
 * Everything here is inserted by the test and removed again; `corpus-guard` enforces it.
 *
 * @fileoverview Endpoint and ingest tests for a training run's YOLO output.
 * @author Isaac Travers
 * @module tests/training-run-yolo-output
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { QueryTypes } = require('sequelize');

const db = require('../model');
const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');
const { FINAL_METRICS_ROLE, METRICS_CURVES_ROLE } = require('../db/final-metrics');
const trainingMetricsService = require('../service/training-metrics.service');

/**
 * What each stem is, as the hand-off would have recorded it.
 *
 * Anything not named here is an image, which is what a run directory is mostly full of.
 *
 * @constant
 * @type {Object<string, string>}
 */
const CONTENT_TYPES = {
    [FINAL_METRICS_ROLE]: 'application/json',
    [METRICS_CURVES_ROLE]: 'application/json',
    results: 'text/csv',
};

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = {
    jobId: null, attemptId: null, workerId: null,
    trainingRunId: null, modelId: null, speciesId: null,
    files: [],
};

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Put bytes where a staged artifact's would be, and record a row naming them.
 *
 * The hand-off is content-addressed, so the file's name IS its hash; writing the bytes
 * and taking their digest is what the upload route does, done directly.
 *
 * @async
 * @param {string} role - The artifact_type, which is the filename stem.
 * @param {string} body - The file's contents.
 * @returns {Promise<string>} The sha256.
 */
async function stageArtifact(role, body) {
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const file = path.join(ARTIFACT_DIRECTORY, sha256);

    fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
    fs.writeFileSync(file, body);
    made.files.push(file);

    await db.sequelize.query(
        `INSERT INTO artifacts (job_id, artifact_type, path, size_mb, hash, metadata, created_at, updated_at)
         VALUES (:jobId, :role, :path, :sizeMb, :hash, :metadata, NOW(), NOW())`,
        {
            replacements: {
                jobId: made.jobId,
                role,
                path: `gpu-artifacts/${sha256}`,
                sizeMb: Buffer.byteLength(body) / (1024 * 1024),
                hash: sha256,
                metadata: JSON.stringify({
                    sha256, role, attempt_id: made.attemptId,
                    /* The real hand-off records whatever the worker uploaded, and a
                       run directory is mostly images with a CSV among them. Labelling
                       a PNG stub as JSON here made supertest try to parse it, which is
                       the route correctly serving what was recorded. */
                    content_type: CONTENT_TYPES[role] || 'image/png',
                }),
            },
        }
    );

    return sha256;
}

/**
 * The job shape the ingest is handed, with this attempt's artifacts attached.
 *
 * @async
 * @returns {Promise<Object>} `{id, kind, artifacts}`.
 */
async function jobWithArtifacts() {
    const artifacts = await query(
        'SELECT id, artifact_type, hash, metadata FROM artifacts WHERE job_id = :jobId',
        { jobId: made.jobId }
    );

    return { id: made.jobId, kind: 'training', artifacts };
}

/**
 * A report as the worker will send one.
 *
 * Two classes, so the matrix is 3x3 with background; asymmetric numbers, so a transpose
 * cannot pass by accident.
 *
 * @param {Object} [overrides] - Fields to replace.
 * @returns {Object} The report.
 */
function finalMetricsReport(overrides = {}) {
    return {
        schema: 1,
        task: 'detect',
        split: 'val',
        confusion_matrix: {
            orientation: 'rows_predicted_cols_true',
            classes: [`jest-known-${runId}`, `jest-unknown-${runId}`],
            background_index: 2,
            matrix: [[10, 3, 5], [1, 20, 7], [2, 4, 0]],
        },
        metrics: [{
            family: 'box',
            overall: { precision: 0.81, recall: 0.74, map50: 0.79, map5095: 0.52, fitness: 0.52 },
            per_class: [
                {
                    class: `jest-known-${runId}`, precision: 0.9, recall: 0.8,
                    f1: 0.85, ap50: 0.88, ap5095: 0.61, support: 142, images: 37,
                },
                { class: `jest-unknown-${runId}`, precision: 0.7, recall: 0.6, f1: 0.65, ap50: 0.68, ap5095: 0.41 },
            ],
        }],
        ...overrides,
    };
}

beforeAll(async () => {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, slot_count, worker_version, capabilities, state, enrolled_at, last_seen_at)
         VALUES (:localId, :name, 1, '0.0.1-jest', '{}'::jsonb, 'online', NOW(), NOW())
         RETURNING id`,
        { localId: `jest-yolo-${runId}`, name: `jest-yolo-worker-${runId}` }
    );

    made.workerId = worker.id;

    const [model] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, NOW(), NOW())
         RETURNING id`,
        { name: `jest-yolo-model-${runId}` }
    );

    made.modelId = model.id;

    /* One class resolves to a species and one does not. The unresolvable one is the
       point: it must be kept under the model's own name rather than dropped. */
    const [species] = await query(
        `INSERT INTO species (taxserial, comname, species_list, created_at, updated_at)
         VALUES (:taxserial, :comname, :list, NOW(), NOW())
         RETURNING id`,
        /* `taxserial` is NOT NULL with no default. Derived from the run id so two
           concurrent runs of this file cannot collide on it. */
        { taxserial: 900000000 + (runId % 90000000), comname: `jest-known-${runId}`, list: `jest-list-${runId}` }
    );

    made.speciesId = species.id;

    await db.sequelize.query(
        `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
         VALUES (:modelId, :speciesId, NOW(), NOW())`,
        { replacements: { modelId: made.modelId, speciesId: made.speciesId } }
    );

    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
         VALUES ('training', :spec, 'leased', 1, 1)
         RETURNING id`,
        { spec: JSON.stringify({ jest: `yolo-output-${runId}` }) }
    );

    made.jobId = job.id;

    const [attempt] = await query(
        `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
         VALUES (:jobId, :workerId, 0, 1, 'running', NOW() + INTERVAL '1 hour')
         RETURNING id`,
        { jobId: job.id, workerId: made.workerId }
    );

    made.attemptId = attempt.id;

    const [run] = await query(
        `INSERT INTO training_runs (job_id, model_id, total_epochs, start_time, created_at, updated_at)
         VALUES (:jobId, :modelId, 1, NOW(), NOW(), NOW())
         RETURNING id`,
        { jobId: job.id, modelId: made.modelId }
    );

    made.trainingRunId = run.id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.trainingRunId) {
        await drop(
            `DELETE FROM metrics_curves WHERE metrics_summary_id IN
                 (SELECT id FROM metrics_summary WHERE training_run_id = :id)`,
            { id: made.trainingRunId }
        );
        await drop('DELETE FROM metrics_summary WHERE training_run_id = :id', { id: made.trainingRunId });
        await drop('DELETE FROM training_run_confusion_matrices WHERE training_run_id = :id', { id: made.trainingRunId });
        await drop('DELETE FROM training_runs WHERE id = :id', { id: made.trainingRunId });
    }
    if (made.jobId) await drop('DELETE FROM artifacts WHERE job_id = :id', { id: made.jobId });
    if (made.attemptId) await drop('DELETE FROM gpu_job_attempts WHERE id = :id', { id: made.attemptId });
    if (made.jobId) await drop('DELETE FROM gpu_jobs WHERE id = :id', { id: made.jobId });
    if (made.workerId) await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
    if (made.modelId) {
        await drop('DELETE FROM model_species WHERE model_id = :id', { id: made.modelId });
        await drop('DELETE FROM ml_models WHERE id = :id', { id: made.modelId });
    }
    if (made.speciesId) await drop('DELETE FROM species WHERE id = :id', { id: made.speciesId });

    // The bytes are this file's too, and the artifact directory is a real one.
    for (const file of made.files) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
});

/**
 * Reading a classification model's class names back into species.
 *
 * **A classify model's classes are folder names, and MARP's folders are handles.**
 * Ultralytics takes a classification vocabulary from the subfolder names of the
 * dataset and keeps no other list, so a model trained on a MARP archive reports
 * `145_blue-deacon-rockfish` -- and that string is in the published `.pt`, which is why
 * MARP stores what the model said *and* what MARP made of it rather than replacing one
 * with the other.
 *
 * The archive names classes that way because `species.comname` cannot be a directory:
 * 37 of 1,404 names contain a path separator, and `Fish` and `fish` are two species
 * rows and one directory on Windows.
 */
describe('A classification run\'s class handles', () => {
    let datasetId;

    /** A species id that exists in no catalogue row, for the unresolvable case. */
    const absentSpecies = 2000000000;

    /**
     * A report whose per-class entries are named the way a classify model names them.
     *
     * @param {Array<string>} classes - The handles.
     * @returns {Object} The report.
     */
    const handleReport = (classes) => finalMetricsReport({
        confusion_matrix: {
            orientation: 'rows_predicted_cols_true',
            classes,
            background_index: classes.length,
            matrix: classes.concat([null]).map(() => classes.concat([null]).map(() => 1)),
        },
        metrics: [{
            family: 'classify',
            overall: { accuracy_top1: 0.87, accuracy_top5: 0.99 },
            per_class: classes.map((name, at) => ({
                class: name, precision: 0.9 - (at / 100), recall: 0.8, f1: 0.85,
            })),
        }],
    });

    beforeAll(async () => {
        const [dataset] = await query(
            `INSERT INTO datasets (name, status, source, task, crop_source, created_at, updated_at)
             VALUES (:name, 'ready', 'jest', 'classification', 'mosaic_thumbnail', NOW(), NOW())
             RETURNING id`,
            { name: `jest-classify-dataset-${runId}` }
        );

        datasetId = dataset.id;

        /* The mapping the build writes: this folder means this species. Only the first
           class is recorded, so the second has to fall back to the id on its front and
           the third to nothing -- three readings, one report. */
        await query(
            `INSERT INTO dataset_classes (dataset_id, species_id, class_index, folder, created_at, updated_at)
             VALUES (:datasetId, :speciesId, 0, :folder, NOW(), NOW())`,
            /* **The id in the handle is deliberately NOT this species.** If the folder
               carried its own species id, the mapping and the id-prefix fallback would
               give the same answer and this test would pass with the mapping removed --
               proving nothing. 2000000000 names no row, so only the recorded mapping can
               resolve it. */
            { datasetId, speciesId: made.speciesId, folder: `${absentSpecies}_recorded-${runId}` }
        );

        await query(
            'UPDATE training_runs SET dataset_id = :datasetId WHERE id = :id',
            { datasetId, id: made.trainingRunId }
        );
    });

    /* **One report per test, because the job accumulates artifacts.** `stageArtifact`
       adds a row and `jobWithArtifacts` hands the ingest every artifact the job has, so
       a second staged report does not replace the first -- it joins it, and the ingest
       reads whichever it finds. Without this, the first test's classes answered all four
       and three of them failed looking for rows that were never written. */
    beforeEach(async () => {
        await db.sequelize.query(
            `DELETE FROM metrics_curves WHERE metrics_summary_id IN
                 (SELECT id FROM metrics_summary WHERE training_run_id = :id)`,
            { replacements: { id: made.trainingRunId }, logging: false }
        );
        await db.sequelize.query(
            'DELETE FROM metrics_summary WHERE training_run_id = :id',
            { replacements: { id: made.trainingRunId }, logging: false }
        );
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id = :id', {
            replacements: { id: made.jobId }, logging: false,
        });
    });

    afterAll(async () => {
        await db.sequelize.query(
            'UPDATE training_runs SET dataset_id = NULL WHERE id = :id',
            { replacements: { id: made.trainingRunId }, logging: false }
        );
        await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id = :id', {
            replacements: { id: datasetId }, logging: false,
        });
        await db.sequelize.query('DELETE FROM datasets WHERE id = :id', {
            replacements: { id: datasetId }, logging: false,
        });
    });

    /**
     * **The dataset's own record, which is exact.** The build generated the folder name
     * and wrote down what it meant at the same moment. Matching on it is a join;
     * anything else here is a search or a parse.
     */
    /**
     * **For a classification run the matrix is the only per-class output there is.**
     *
     * Run 209 is the worked example: a classify report carries one overall row --
     * `accuracy_top1` 0.638, `accuracy_top5` 0.913, `fitness` 0.776 -- and no per-class
     * metrics at all, so the resolution the tests above exercise reaches nothing. Its
     * matrix arrived labelled `126_vermilion-rockfish … 26_kelp-greenling`, which left
     * the one per-class thing MARP can show about a classifier unreadable.
     */
    it('the matrix axis is labelled with species, not with folder handles', async () => {
        const recorded = `${absentSpecies}_recorded-${runId}`;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport([recorded])));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            `SELECT class_names, class_handles, matrix FROM training_run_confusion_matrices
              WHERE training_run_id = :id`,
            { id: made.trainingRunId }
        );

        expect(row).toBeTruthy();

        const [species] = await query('SELECT comname FROM species WHERE id = :id',
            { id: made.speciesId });

        // The axis says what it is...
        expect(row.class_names[0]).toBe(species.comname);

        // ...and keeps what the model called it, which is the only way back to the
        // directory in the archive and is what the .pt itself contains.
        expect(row.class_handles[0]).toBe(recorded);
    });

    it('keeps the axis the same length as the matrix, whatever resolved', async () => {
        /* **The labels index the axes.** A dropped or reordered entry silently relabels
           every cell after it, which is how a count is read as the wrong species -- so
           a handle nothing can resolve keeps the handle rather than becoming null or
           going missing. Three classes, one resolvable and two not. */
        const recorded = `${absentSpecies}_recorded-${runId}`;
        const classes = [recorded, `jest-nothing-${runId}`, `${absentSpecies}_also-nothing-${runId}`];

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport(classes)));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            `SELECT class_names, class_handles, matrix, background_index
               FROM training_run_confusion_matrices WHERE training_run_id = :id`,
            { id: made.trainingRunId }
        );

        expect(row.class_names).toHaveLength(classes.length);
        expect(row.class_handles).toEqual(classes);
        // The report's matrix carries a background row, so it is one wider than the axis.
        expect(row.matrix).toHaveLength(classes.length + 1);
        expect(row.background_index).toBe(classes.length);

        // The two that resolved to nothing are shown as the model named them.
        expect(row.class_names[1]).toBe(classes[1]);
        expect(row.class_names[2]).toBe(classes[2]);
    });

    it('records no handles when the model already named species', async () => {
        /* Every detection run is this: the class names *are* comnames, so a handles
           column repeating them would say nothing and still have to be read. */
        const [species] = await query('SELECT comname FROM species WHERE id = :id',
            { id: made.speciesId });

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport([species.comname])));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            `SELECT class_names, class_handles FROM training_run_confusion_matrices
              WHERE training_run_id = :id`,
            { id: made.trainingRunId }
        );

        expect(row.class_names[0]).toBe(species.comname);
        expect(row.class_handles).toBeNull();
    });

    it('resolves a handle the dataset recorded, by the mapping rather than the name', async () => {
        const folder = `${absentSpecies}_recorded-${runId}`;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport([folder])));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            'SELECT class_name, species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: folder }
        );

        expect(row).toBeTruthy();

        /* **Only the recorded mapping can produce this.** The id on the front of the
           handle names no species at all, so a resolution that reached the fallback
           would be null here. */
        expect(row.species_id).toBe(made.speciesId);

        /* **Both are kept.** The handle is what the checkpoint will say for ever, and
           the species is MARP's reading of it. Replacing the one with the other would
           make the row disagree with an artifact that is still sitting there. */
        expect(row.class_name).toBe(folder);
    });

    /**
     * **The id on the front, for a handle the dataset does not record** -- a model
     * trained from an archive whose dataset row is gone, or one built elsewhere by the
     * same convention. Validated against `species` rather than trusted: an id naming no
     * row is not a resolution.
     */
    it('falls back to the species id in front of a handle it has no mapping for', async () => {
        const unmapped = `${made.speciesId}_not-in-the-dataset-${runId}`;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport([unmapped])));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            'SELECT species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: unmapped }
        );

        expect(row.species_id).toBe(made.speciesId);
    });

    /**
     * **An id that names nothing resolves to null, not to itself.** Writing the integer
     * straight into `species_id` would attach a measurement to whatever row happens to
     * hold that number, or to a row that does not exist -- permanently, and invisibly.
     */
    it('does not invent a species from an id the catalogue does not hold', async () => {
        const absent = `${absentSpecies}_no-such-species-${runId}`;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport([absent])));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            'SELECT class_name, species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: absent }
        );

        /* Kept under the name the model used, which is what a reader needs to see to
           know the vocabularies disagree. */
        expect(row).toBeTruthy();
        expect(row.species_id).toBeNull();
    });

    /**
     * **A name that merely begins with digits is not a handle.** A species genuinely
     * called `2024 survey marker` must not be read as species 2024, which is why the
     * pattern requires the underscore and why the id is checked rather than assumed.
     */
    it('does not read a leading number as an id when nothing separates it', async () => {
        const notAHandle = `2024 survey marker ${runId}`;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(handleReport([notAHandle])));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [row] = await query(
            'SELECT species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: notAHandle }
        );

        expect(row).toBeTruthy();
        expect(row.species_id).toBeNull();
    });
});

/**
 * A detection run, which has a dataset like any other and no class folders in it.
 *
 * **This is the regression test that matters, and my first attempt at it was weaker
 * than it looked.** That one set `training_runs.dataset_id` to NULL and asserted names
 * still resolved -- but a real detection run *has* a dataset id: the job spec carries
 * `dataset.dataset_id` and the ingest writes it. So the test exercised a run MARP does
 * not produce, and the thing actually protecting detection -- `folder IS NOT NULL` in
 * `classFoldersFor` -- was never reached.
 *
 * Caught by the session that wrote this ingest. It is the same shape as the fixture I
 * caught in my own folder test an hour earlier: an assertion that passes for a reason
 * other than the one it claims.
 *
 * So this run has a dataset, that dataset has class rows, and those rows have no
 * `folder` -- which is exactly what every dataset built before classification existed
 * looks like, and what every detection dataset built since looks like too.
 */
describe('A detection run whose dataset has class rows but no folders', () => {
    let datasetId;

    beforeEach(async () => {
        await db.sequelize.query(
            `DELETE FROM metrics_curves WHERE metrics_summary_id IN
                 (SELECT id FROM metrics_summary WHERE training_run_id = :id)`,
            { replacements: { id: made.trainingRunId }, logging: false }
        );
        await db.sequelize.query(
            'DELETE FROM metrics_summary WHERE training_run_id = :id',
            { replacements: { id: made.trainingRunId }, logging: false }
        );
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id = :id', {
            replacements: { id: made.jobId }, logging: false,
        });
    });

    beforeAll(async () => {
        const [dataset] = await query(
            `INSERT INTO datasets (name, status, source, task, created_at, updated_at)
             VALUES (:name, 'ready', 'jest', 'detection', NOW(), NOW())
             RETURNING id`,
            { name: `jest-detection-dataset-${runId}` }
        );

        datasetId = dataset.id;

        /* **A class row with no folder, which is what a detection dataset records.**
           Its archive names classes by index in `data.yaml`; there are no directories
           to name. */
        await query(
            `INSERT INTO dataset_classes (dataset_id, species_id, class_index, folder, created_at, updated_at)
             VALUES (:datasetId, :speciesId, 0, NULL, NOW(), NOW())`,
            { datasetId, speciesId: made.speciesId }
        );

        await query(
            'UPDATE training_runs SET dataset_id = :datasetId WHERE id = :id',
            { datasetId, id: made.trainingRunId }
        );
    });

    afterAll(async () => {
        await db.sequelize.query(
            'UPDATE training_runs SET dataset_id = NULL WHERE id = :id',
            { replacements: { id: made.trainingRunId }, logging: false }
        );
        await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id = :id', {
            replacements: { id: datasetId }, logging: false,
        });
        await db.sequelize.query('DELETE FROM datasets WHERE id = :id', {
            replacements: { id: datasetId }, logging: false,
        });
    });

    /**
     * **Plain common names, resolved the way they always were.** Nothing about adding a
     * folder mapping may change what a detection run records -- its classes are species
     * names and the model's own trained species are what narrow them.
     */
    it('still resolves its classes by name', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [resolved] = await query(
            'SELECT species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: `jest-known-${runId}` }
        );

        expect(resolved).toBeTruthy();
        expect(resolved.species_id).toBe(made.speciesId);
    });

    /**
     * **And one it cannot place is still kept unresolved**, rather than being caught by
     * a folder mapping that happens to hold a null key.
     */
    it('still keeps an unknown class under the name the model used', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));
        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [unresolved] = await query(
            'SELECT class_name, species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: `jest-unknown-${runId}` }
        );

        expect(unresolved).toBeTruthy();
        expect(unresolved.species_id).toBeNull();
    });
});

describe('Taking a final report into the record', () => {
    beforeEach(async () => {
        await db.sequelize.query(
            `DELETE FROM metrics_curves WHERE metrics_summary_id IN
                 (SELECT id FROM metrics_summary WHERE training_run_id = :id)`,
            { replacements: { id: made.trainingRunId } }
        );
        await db.sequelize.query(
            'DELETE FROM metrics_summary WHERE training_run_id = :id',
            { replacements: { id: made.trainingRunId } }
        );
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id = :id',
            { replacements: { id: made.jobId } });
    });

    it('writes an aggregate row and one row per evaluated class', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.stored).toBeTruthy();

        // Asserted against the rows rather than the service's own answer: a service that
        // reports what it meant to write is how five epoch columns were empty for months.
        const rows = await query(
            `SELECT class_name, species_id, metric_family, "precision", map50, f1_score, fitness
               FROM metrics_summary WHERE training_run_id = :id ORDER BY class_name NULLS FIRST`,
            { id: made.trainingRunId }
        );

        expect(rows).toHaveLength(3);
        expect(rows[0].class_name).toBeNull();
        expect(rows[0].map50).toBeCloseTo(0.79);
        expect(rows.every((row) => row.metric_family === 'box')).toBe(true);
    });

    it('stores the counts a class\'s metrics rest on, and nulls the ones not reported', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [counted] = await query(
            'SELECT support, image_count FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: `jest-known-${runId}` }
        );

        expect(counted.support).toBe(142);
        expect(counted.image_count).toBe(37);

        // "No instances" and "not counted" are different facts about a species.
        const [uncounted] = await query(
            'SELECT support FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: `jest-unknown-${runId}` }
        );

        expect(uncounted.support).toBeNull();
    });

    it('takes a report with no metrics block as empty, not malformed', async () => {
        // The producer omits it only when nothing was scored, and a confusion matrix can
        // be real beside it. Worth pinning as a contract rather than leaving accidental:
        // the emitting side separately found that a swallowed crash produced exactly
        // this shape, so "empty" and "broken" must stay distinguishable by agreement.
        const nothingScored = finalMetricsReport();
        delete nothingScored.metrics;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(nothingScored));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.failed).toBeUndefined();
        expect(result.stored.metrics_rows).toBe(0);

        // The matrix still lands, because it was still measured.
        expect(result.stored.confusion_matrix).toBe(true);
    });

    it('names an unrecognised family rather than refusing it or swallowing it', async () => {
        // `mask` was the wrong guess for `seg` before both sides agreed. A typo like
        // that otherwise lands silently as a table nobody is looking for. Reported, and
        // still stored -- Ultralytics has `pose` and `obb`, and an allow-list would
        // reject a whole run's metrics the first time somebody trained one.
        const mistyped = finalMetricsReport();
        mistyped.metrics[0].family = 'mask';

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(mistyped));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.stored.unknown_families).toEqual(['mask']);

        // Stored, not dropped.
        const [{ count }] = await query(
            `SELECT COUNT(*)::int AS count FROM metrics_summary
              WHERE training_run_id = :id AND metric_family = 'mask'`,
            { id: made.trainingRunId }
        );

        expect(count).toBe(3);
    });

    it('says nothing when every family is one it knows', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.stored.unknown_families).toEqual([]);
    });

    it('keeps a class it cannot resolve, under the name the model used', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [unresolved] = await query(
            'SELECT class_name, species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: `jest-unknown-${runId}` }
        );

        // Dropping it would hide a class the model is actively predicting.
        expect(unresolved).toBeTruthy();
        expect(unresolved.species_id).toBeNull();

        const [resolved] = await query(
            'SELECT species_id FROM metrics_summary WHERE training_run_id = :id AND class_name = :name',
            { id: made.trainingRunId, name: `jest-known-${runId}` }
        );

        expect(resolved.species_id).toBe(made.speciesId);
    });

    it('leaves the aggregate f1_score null, because the trainer reports none', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [aggregate] = await query(
            'SELECT f1_score, map5095, fitness FROM metrics_summary WHERE training_run_id = :id AND class_name IS NULL',
            { id: made.trainingRunId }
        );

        expect(aggregate.f1_score).toBeNull();
        // fitness is map5095 exactly under 8.4.145's weights; both are stored.
        expect(aggregate.fitness).toBeCloseTo(aggregate.map5095);
    });

    it('stores the matrix in the trainer\'s orientation, unrotated', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        const [stored] = await query(
            'SELECT orientation, background_index, matrix FROM training_run_confusion_matrices WHERE training_run_id = :id',
            { id: made.trainingRunId }
        );

        expect(stored.orientation).toBe('rows_predicted_cols_true');
        expect(stored.background_index).toBe(2);
        expect(stored.matrix[0]).toEqual([10, 3, 5]);
    });

    it('does not double the rows when one attempt reports twice', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));

        const job = await jobWithArtifacts();

        await trainingMetricsService.ingestFinalMetrics(job);
        await trainingMetricsService.ingestFinalMetrics(job);

        const [{ count }] = await query(
            'SELECT COUNT(*)::int AS count FROM metrics_summary WHERE training_run_id = :id',
            { id: made.trainingRunId }
        );

        expect(count).toBe(3);
    });

    it('reports a malformed report as failed without writing anything', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, 'this is not json');

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.failed).toBeTruthy();

        const [{ count }] = await query(
            'SELECT COUNT(*)::int AS count FROM metrics_summary WHERE training_run_id = :id',
            { id: made.trainingRunId }
        );

        expect(count).toBe(0);
    });

    it('skips an attempt that handed over no report, which is not an error', async () => {
        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.skipped).toBeTruthy();
        expect(result.failed).toBeUndefined();
    });

    it('refuses a report that does not say which split it evaluated', async () => {
        const noSplit = finalMetricsReport();
        delete noSplit.split;

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(noSplit));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.failed).toBeTruthy();
    });
});

describe('The per-threshold curves', () => {
    /**
     * A curves artifact over three thresholds.
     *
     * @param {Object} [overrides] - Fields to replace.
     * @returns {Object} The artifact.
     */
    const curvesReport = (overrides = {}) => ({
        schema: 1,
        split: 'val',
        family: 'box',
        classes: [`jest-known-${runId}`, `jest-unknown-${runId}`],
        confidence: [0.0, 0.5, 1.0],
        curves: {
            precision: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
            recall: [[0.9, 0.8, 0.7], [0.6, 0.5, 0.4]],
            f1: [[0.2, 0.3, 0.4], [0.5, 0.6, 0.7]],
        },
        ...overrides,
    });

    beforeEach(async () => {
        await db.sequelize.query(
            `DELETE FROM metrics_curves WHERE metrics_summary_id IN
                 (SELECT id FROM metrics_summary WHERE training_run_id = :id)`,
            { replacements: { id: made.trainingRunId } }
        );
        await db.sequelize.query('DELETE FROM metrics_summary WHERE training_run_id = :id',
            { replacements: { id: made.trainingRunId } });
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id = :id',
            { replacements: { id: made.jobId } });
    });

    it('writes one row per class per threshold, holding all three measurements', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));
        await stageArtifact(METRICS_CURVES_ROLE, JSON.stringify(curvesReport()));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        // Two classes, three thresholds. Not three rows per threshold: the curves share
        // one x axis, so one row holds precision, recall and F1 together.
        expect(result.stored.curve_points).toBe(6);

        const rows = await query(
            `SELECT c.confidence_threshold, c."precision", c.recall, c.f1_score, c.support
               FROM metrics_curves c
               JOIN metrics_summary m ON m.id = c.metrics_summary_id
              WHERE m.training_run_id = :id AND m.class_name = :name
              ORDER BY c.confidence_threshold`,
            { id: made.trainingRunId, name: `jest-unknown-${runId}` }
        );

        expect(rows).toHaveLength(3);
        expect(rows[1].precision).toBeCloseTo(0.5);
        expect(rows[1].recall).toBeCloseTo(0.5);
        expect(rows[1].f1_score).toBeCloseTo(0.6);

        // A per-class count has no meaning per threshold and is never invented.
        expect(rows[1].support).toBeNull();
    });

    it('stores no curve when one is shorter than the confidence axis', async () => {
        const short = curvesReport();
        short.curves.recall = [[0.9, 0.8], [0.6, 0.5]];

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));
        await stageArtifact(METRICS_CURVES_ROLE, JSON.stringify(short));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        // A shifted curve attributes a precision to the wrong threshold -- subtly wrong
        // rather than visibly broken, so the family is refused whole.
        expect(result.stored.curve_points).toBe(0);
    });

    it('ignores curves measuring a split the report did not', async () => {
        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));
        await stageArtifact(METRICS_CURVES_ROLE, JSON.stringify(curvesReport({ split: 'test' })));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        expect(result.stored.curve_points).toBe(0);
    });

    it('stores nothing for a class with no metrics row', async () => {
        const sparse = finalMetricsReport();
        sparse.metrics[0].per_class = [sparse.metrics[0].per_class[0]];

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(sparse));
        await stageArtifact(METRICS_CURVES_ROLE, JSON.stringify(curvesReport()));

        const result = await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());

        // Structural: metrics_summary_id is NOT NULL, so a class the validator never
        // evaluated has no row and therefore can have no curve.
        expect(result.stored.curve_points).toBe(3);
    });
});

describe('Reading it back', () => {
    beforeAll(async () => {
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id = :id',
            { replacements: { id: made.jobId } });

        await stageArtifact(FINAL_METRICS_ROLE, JSON.stringify(finalMetricsReport()));
        await stageArtifact('confusion_matrix', 'not-really-a-png');
        await stageArtifact('a_plot_nobody_has_seen', 'also-not-a-png');

        await trainingMetricsService.ingestFinalMetrics(await jobWithArtifacts());
    });

    it('serves the matrix rows-as-true, which is the transpose of how it is stored', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/metrics`);

        expect(res.status).toBe(200);

        const [matrix] = res.body.confusion_matrices;

        expect(matrix.orientation).toBe('rows_true_cols_predicted');
        // Stored matrix[0] is [10, 3, 5]; served row 0 is the stored column 0.
        expect(matrix.rows[0]).toEqual([10, 1, 2]);
        expect(matrix.labels[2]).toBe('background');
    });

    it('answers 200 with empty arrays for a run that measured nothing', async () => {
        const [other] = await query(
            `INSERT INTO training_runs (job_id, model_id, total_epochs, start_time, created_at, updated_at)
             VALUES (NULL, :modelId, 1, NOW(), NOW(), NOW()) RETURNING id`,
            { modelId: made.modelId }
        );

        try {
            const res = await global.api.get(`/api/v2/training_run/${other.id}/metrics`);

            // Not a 404: the run exists either way, and a screen watching one in
            // progress would otherwise treat "nothing yet" as an error.
            expect(res.status).toBe(200);
            expect(res.body.metrics).toEqual([]);
            expect(res.body.confusion_matrices).toEqual([]);
        } finally {
            await db.sequelize.query('DELETE FROM training_runs WHERE id = :id',
                { replacements: { id: other.id } });
        }
    });

    it('404s a run that does not exist', async () => {
        const res = await global.api.get('/api/v2/training_run/2147483600/metrics');

        expect(res.status).toBe(404);
    });

    it('lists a plot whose stem this code has never seen', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/artifacts`);

        expect(res.status).toBe(200);

        const names = res.body.map((row) => row.name);

        // The acceptance criterion for the open set. A test using only known stems
        // could not see this fail.
        expect(names).toContain('a_plot_nobody_has_seen');
        expect(names).toContain('confusion_matrix');
    });

    it('serves an artifact\'s bytes, and refuses a hash belonging to another run', async () => {
        const list = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/artifacts`);
        const plot = list.body.find((row) => row.name === 'confusion_matrix');

        const served = await global.api.get(
            `/api/v2/training_run/${made.trainingRunId}/artifacts/${plot.sha256}`
        );

        expect(served.status).toBe(200);

        const strangerHash = crypto.createHash('sha256').update(`stranger-${runId}`).digest('hex');
        const refused = await global.api.get(
            `/api/v2/training_run/${made.trainingRunId}/artifacts/${strangerHash}`
        );

        expect(refused.status).toBe(404);
    });

    it('nulls are served as nulls, never as zeros', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/metrics`);

        const aggregate = res.body.metrics.find((row) => row.class_name === null);

        // Asserted on a null specifically. A snapshot would pass with zeros in it, and
        // a zero on a quality metric reads as a model that detects nothing.
        expect(aggregate.f1_score).toBeNull();
    });
});
