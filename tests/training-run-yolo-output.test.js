/**
 * What a training run measured, from the artifact on disk to the endpoint.
 *
 * **These tests have never been executed.** They were written against a workspace whose
 * database could not be loaded: `marp db up` names every database it creates `mare_v1`,
 * on any port, and the danger-gate refuses any command containing that string -- rightly,
 * since production carries the same name and only the host tells them apart. So the
 * schema was never loaded on 5447 and no Jest suite in this branch has run. Whoever runs
 * these first should expect to fix something, and should treat a green run as the first
 * real evidence rather than a confirmation.
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
                    content_type: role === 'results' ? 'text/csv' : 'application/json',
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
        classes: [`jest-known-${runId}`, `jest-unknown-${runId}`],
        confusion_matrix: {
            orientation: 'rows_predicted_cols_true',
            background_index: 2,
            matrix: [[10, 3, 5], [1, 20, 7], [2, 4, 0]],
        },
        metrics: [{
            family: 'box',
            overall: { precision: 0.81, recall: 0.74, map50: 0.79, map5095: 0.52, fitness: 0.52 },
            per_class: [
                { class: `jest-known-${runId}`, precision: 0.9, recall: 0.8, f1: 0.85, ap50: 0.88, ap5095: 0.61 },
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
        `INSERT INTO species (comname, species_list, is_active, created_at, updated_at)
         VALUES (:comname, :list, true, NOW(), NOW())
         RETURNING id`,
        { comname: `jest-known-${runId}`, list: `jest-list-${runId}` }
    );

    made.speciesId = species.id;

    await db.sequelize.query(
        'INSERT INTO model_species (model_id, species_id) VALUES (:modelId, :speciesId)',
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
