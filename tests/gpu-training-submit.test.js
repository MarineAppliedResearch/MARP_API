/**
 * Tests for queueing a training job.
 *
 * Submission is where the two job shapes are told apart, and it is the only
 * place that can refuse a bad one cheaply. Everything after it is expensive: a
 * training job that leases and then cannot fetch its dataset burns an attempt,
 * waits out a lease, and retries twice before anybody looks at it.
 *
 * The composition matters as much as the refusals. A submitter names a dataset
 * by id; MARP fills in the locator and the hash from the row, exactly as it
 * resolves a video, which is what keeps the worker unable to name where its data
 * comes from (A8) and what lets the file server in #120 take over later.
 *
 * Rows are seeded and removed by this file, as `tests/setup/corpus-guard.js`
 * requires.
 *
 * @fileoverview Tests for POST /api/v2/gpu/jobs with kind=training.
 * @author Isaac Travers
 * @module tests/gpu-training-submit
 */

const db = require('../model');

/** Unique per run, so two runs cannot collide on a dataset name. */
const runId = Date.now();

/** A sha256-shaped value for the packaged dataset's archive. */
const ARCHIVE_SHA = 'a'.repeat(64);

/** Rows this file created. */
let packagedDatasetId;
let unpackagedDatasetId;
let modelId;
const createdJobIds = [];

/**
 * A training spec naming one of this file's datasets.
 *
 * @param {number} datasetId - Which dataset to train on.
 * @returns {Object} A submission body.
 */
function trainingSubmission(datasetId) {
    return {
        kind: 'training',
        spec: {
            engine: 'marp_training',
            model: {
                name: 'yolo11m.pt',
                sha256: 'b'.repeat(64),
                url: '/api/v2/model/91/artifact',
                // Required for a training job: the run is recorded against
                // the model it started from, and that column is NOT NULL.
                ml_model_id: modelId,
            },
            dataset: { dataset_id: datasetId },
            params: { epochs: 3, imgsz: 640 },
        },
    };
}

beforeAll(async () => {
    const [model] = await db.sequelize.query(
        `INSERT INTO ml_models (name, model_type, architecture_version, status, created_at, updated_at)
         VALUES (:name, 'detection', 'yolo11m', 'ready', now(), now())
         RETURNING id`,
        { replacements: { name: `jest-trainsubmit-model-${runId}` }, type: db.Sequelize.QueryTypes.INSERT, logging: false }
    );
    modelId = model[0].id;

    const [packaged] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'test', 10, 2, 'test', 'ready', :path, :sha, 1024, now(), now())
         RETURNING id`,
        {
            replacements: {
                name: `jest-training-packaged-${runId}`,
                path: `datasets/${ARCHIVE_SHA}.tar`,
                sha: ARCHIVE_SHA,
            },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    packagedDatasetId = packaged[0].id;

    const [unpackaged] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status, created_at, updated_at)
         VALUES (:name, 'test', 10, 2, 'test', 'ready', now(), now())
         RETURNING id`,
        {
            replacements: { name: `jest-training-unpackaged-${runId}` },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    unpackagedDatasetId = unpackaged[0].id;
});

afterAll(async () => {
    if (createdJobIds.length) {
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: createdJobIds },
            logging: false,
        });
    }
    await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', {
        replacements: { ids: [packagedDatasetId, unpackagedDatasetId].filter(Boolean) },
        logging: false,
    });
    await db.sequelize.query('DELETE FROM ml_models WHERE id = :modelId', {
        replacements: { modelId }, logging: false,
    });
});

describe('POST /api/v2/gpu/jobs with kind=training', () => {

    test('queues one job, with the dataset locator and hash composed by MARP', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send(trainingSubmission(packagedDatasetId));

        expect(response.status).toBe(200);
        expect(response.body.jobs).toHaveLength(1);

        const job = response.body.jobs[0];
        createdJobIds.push(job.id);

        expect(job.kind).toBe('training');

        // One job, never a batch: a training run is not divisible the way a
        // video is, and splitting it would produce several models rather than one.
        expect(response.body.batch_id).toBeNull();

        // Composed from the row, not taken from the submitter.
        expect(job.spec.dataset.url).toBe(`/api/v2/gpu/datasets/${packagedDatasetId}/archive`);
        expect(job.spec.dataset.sha256).toBe(ARCHIVE_SHA);
        expect(job.spec.dataset.dataset_id).toBe(packagedDatasetId);

        // And it carries neither half of the inference shape.
        expect(job.spec.video).toBeUndefined();
        expect(job.spec.range).toBeUndefined();

        // The submitter's own training settings survive.
        expect(job.spec.params.epochs).toBe(3);
    });

    test('refuses a dataset nobody has packaged, and says what to do', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send(trainingSubmission(unpackagedDatasetId));

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toMatch(/package-dataset/);
    });

    test('refuses a dataset that does not exist', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send(trainingSubmission(99999999));

        expect(response.status).toBe(400);
    });

    test('refuses a job that is both shapes at once', async () => {
        const submission = trainingSubmission(packagedDatasetId);
        submission.spec.video = { url: 'http://media.invalid/v.mp4', source_name: 'v.mp4' };
        submission.spec.range = { start_frame: 0, end_frame: 100 };

        const response = await global.api.post('/api/v2/gpu/jobs').send(submission);

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toMatch(/dataset/i);
    });

    test('refuses a training job with no dataset at all', async () => {
        const submission = trainingSubmission(packagedDatasetId);
        delete submission.spec.dataset;

        const response = await global.api.post('/api/v2/gpu/jobs').send(submission);

        expect(response.status).toBe(400);
    });

    test('refuses a training job whose model MARP does not know', async () => {
        const submission = trainingSubmission(packagedDatasetId);
        delete submission.spec.model.ml_model_id;

        const response = await global.api.post('/api/v2/gpu/jobs').send(submission);

        // Caught at submit, where it is one clear message. At the first epoch it
        // would fail an event batch instead, and a failed event batch takes the
        // whole running job down with it.
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toMatch(/ml_model_id/);
    });

    test('still queues an inference job exactly as before', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                spec: {
                    engine: 'marp_tracking',
                    model: { name: 'm.pt', sha256: 'c'.repeat(64), url: '/api/v2/model/91/artifact' },
                    video: { url: 'http://media.invalid/v.mp4', source_name: 'v.mp4' },
                    range: { start_frame: 0, end_frame: 100 },
                    reduction: { name: 'v3_dirpad', version: 1 },
                },
            });

        expect(response.status).toBe(200);
        expect(response.body.jobs).toHaveLength(1);
        createdJobIds.push(response.body.jobs[0].id);
        expect(response.body.jobs[0].spec.range.end_frame).toBe(100);
    });
});
