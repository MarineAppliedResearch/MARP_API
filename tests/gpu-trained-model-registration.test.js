/**
 * Tests that a finished training job leaves a model somebody can run.
 *
 * Before this, the pool could train a model and not use one: the weights were published,
 * recorded as an artifact against the job, and there was no `ml_models` row to name in an
 * inference job spec. The thing you had just trained was a file nobody could reach.
 *
 * Driven through the real endpoints — submit, lease, publish — because the registration
 * happens inside the publish transaction, and a test that called it directly would prove
 * only that the function runs.
 *
 * Everything is seeded and removed by this file, as `tests/setup/corpus-guard.js` requires.
 *
 * @fileoverview Tests that publishing a training job registers its model.
 * @author Isaac Travers
 * @module tests/gpu-trained-model-registration
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');
const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');
const { storageRoot } = require('../service/model-artifact.service');

/** Unique per run. */
const runId = Date.now();

/** The weights the worker "published", and their hash. */
const WEIGHTS = Buffer.from(`fake-weights-${runId}`, 'utf8');
const WEIGHTS_SHA = require('crypto').createHash('sha256').update(WEIGHTS).digest('hex');

/** Two class names that resolve to exactly one species each. */
const CLASS_NAMES = ['Lingcod', 'Vermilion Rockfish'];

let datasetId;
let parentModelId;
let workerId;
let jobId;
let attemptId;
let leaseEpoch;
let registeredModelId;
let artifactFile;
let copiedWeights;

beforeAll(async () => {
    const [dataset] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes,
                               created_at, updated_at)
         VALUES (:name, 'test', 10, 2, 'test', 'ready', :p, :s, 1024, now(), now())
         RETURNING id`,
        {
            replacements: {
                name: `jest-register-dataset-${runId}`,
                p: `datasets/${'a'.repeat(64)}.tar`,
                s: 'a'.repeat(64),
            },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    datasetId = dataset[0].id;

    /* The vocabulary is `dataset_classes` now, not a `class_names` array: an index means
       a species, and the name is how it is printed (#268). Seeded against the real
       catalogue, which is what registration joins to. */
    for (let index = 0; index < CLASS_NAMES.length; index++) {
        await db.sequelize.query(
            `INSERT INTO dataset_classes (dataset_id, species_id, class_index, created_at, updated_at)
             SELECT :datasetId, id, :index, now(), now()
               FROM species WHERE comname = :name ORDER BY id LIMIT 1`,
            {
                replacements: { datasetId, index, name: CLASS_NAMES[index] },
                logging: false,
            }
        );
    }

    const [parent] = await db.sequelize.query(
        `INSERT INTO ml_models (name, model_type, architecture_version, status, created_at, updated_at)
         VALUES (:name, 'detection', 'yolo11m', 'active', now(), now())
         RETURNING id`,
        { replacements: { name: `jest-register-parent-${runId}` }, type: db.Sequelize.QueryTypes.INSERT, logging: false }
    );
    parentModelId = parent[0].id;

    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-register-local-${runId}`,
            name: `jest-register-worker-${runId}`,
            slot_count: 4,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [{ name: 'jest-gpu', vram_mb: 1024 }], engines: ['marp_training'] },
        });
    workerId = enrolled.body.worker_id;

    const submitted = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'training',
            priority: 9100,
            spec: {
                engine: 'marp_training',
                model: { name: 'yolo11m.pt', sha256: 'b'.repeat(64), url: '/api/v2/model/1/artifact', ml_model_id: parentModelId },
                dataset: { dataset_id: datasetId },
                params: { epochs: 2 },
            },
        });
    jobId = submitted.body.jobs[0].id;

    const leased = await global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0, capabilities: { gpus: [] } });
    attemptId = leased.body.attempt_id;
    leaseEpoch = leased.body.lease_epoch;

    // Where the upload below will put them, kept so afterAll can clean up.
    artifactFile = path.join(ARTIFACT_DIRECTORY, WEIGHTS_SHA);
});

afterAll(async () => {
    if (registeredModelId) {
        await db.sequelize.query('DELETE FROM model_species WHERE model_id = :id', { replacements: { id: registeredModelId }, logging: false });
        await db.sequelize.query('DELETE FROM ml_models WHERE id = :id', { replacements: { id: registeredModelId }, logging: false });
    }
    await db.sequelize.query('DELETE FROM artifacts WHERE job_id = :jobId', { replacements: { jobId }, logging: false });
    // The hand-off stages the bytes before the result names them, so the staging row
    // is this file's to remove as much as the artifact row is.
    await db.sequelize.query('DELETE FROM gpu_artifacts_staging WHERE sha256 = :sha', { replacements: { sha: WEIGHTS_SHA }, logging: false });
    await db.sequelize.query('DELETE FROM epochs WHERE training_run_id IN (SELECT id FROM training_runs WHERE job_id = :jobId)', { replacements: { jobId }, logging: false });
    await db.sequelize.query('DELETE FROM training_runs WHERE job_id = :jobId', { replacements: { jobId }, logging: false });
    await db.sequelize.query('DELETE FROM gpu_job_events WHERE attempt_id = :attemptId', { replacements: { attemptId }, logging: false });
    await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id = :jobId', { replacements: { jobId }, logging: false });
    await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :jobId', { replacements: { jobId }, logging: false });
    await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :workerId', { replacements: { workerId }, logging: false });
    await db.sequelize.query('DELETE FROM ml_models WHERE id = :id', { replacements: { id: parentModelId }, logging: false });
    await db.sequelize.query('DELETE FROM datasets WHERE id = :id', { replacements: { id: datasetId }, logging: false });

    if (artifactFile && fs.existsSync(artifactFile)) fs.rmSync(artifactFile);
    if (copiedWeights && fs.existsSync(copiedWeights)) fs.rmSync(path.dirname(path.dirname(copiedWeights)), { recursive: true, force: true });
});

describe('publishing a training job registers its model', () => {

    test('the fixture leased its own training job', () => {
        expect({ jobId, attemptId, leaseEpoch, workerId }).toEqual({
            jobId, attemptId: expect.any(Number), leaseEpoch: expect.any(Number), workerId,
        });
    });

    test('an epoch, the weights handed over, and a successful publish', async () => {
        const events = await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/events`)
            .send({
                worker_id: workerId,
                lease_epoch: leaseEpoch,
                events: [{
                    seq: 0,
                    kind: 'metric',
                    at: new Date().toISOString(),
                    payload: { step: 1, phase: 'training', metrics: { 'metrics/precision(B)': 0.8 } },
                }],
            });
        expect(events.status).toBe(200);

        // The hand-off, as a worker does it: offer by hash, then send the bytes.
        // Reporting a result that names weights nobody uploaded is refused with a 409,
        // which is the right place for it -- the worker still holds the file.
        const offered = await global.api
            .post('/api/v2/gpu/artifacts/check')
            .send({ worker_id: workerId, sha256: WEIGHTS_SHA, size_bytes: WEIGHTS.length });
        expect(offered.status).toBe(200);

        if (!offered.body.already_have) {
            const uploaded = await global.api
                .post(`${offered.body.upload_url}?attempt_id=${attemptId}`)
                .set('Content-Type', 'application/octet-stream')
                .send(WEIGHTS);
            expect(uploaded.status).toBe(200);
        }

        const published = await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: leaseEpoch,
                outcome: 'succeeded',
                artifacts: [{ role: 'weights', sha256: WEIGHTS_SHA, size_bytes: WEIGHTS.length }],
            });

        expect(published.status).toBe(200);
    });

    test('a model exists, named for its dataset, parented to what it started from', async () => {
        const [model] = await db.sequelize.query(
            `SELECT * FROM ml_models WHERE notes LIKE :marker ORDER BY id DESC LIMIT 1`,
            { replacements: { marker: `%GPU job ${jobId}.%` }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(model).toBeTruthy();
        registeredModelId = model.id;

        expect(model.name).toMatch(new RegExp(`^jest-register-dataset-${runId}-\\d{4}-\\d{2}-\\d{2}`));
        expect(model.parent_model_id).toBe(parentModelId);
        expect(model.status).toBe('active');

        // Usable at once, but not the default: promoting a model nobody has looked at
        // would change what the next inference job runs.
        expect(model.preferred).toBe(false);
    });

    test('its weights are where the model route serves from', async () => {
        const [model] = await db.sequelize.query(
            'SELECT storage_path FROM ml_models WHERE id = :id',
            { replacements: { id: registeredModelId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        copiedWeights = path.resolve(storageRoot(), model.storage_path);

        expect(fs.existsSync(copiedWeights)).toBe(true);
        expect(fs.readFileSync(copiedWeights).equals(WEIGHTS)).toBe(true);

        // And reachable through the route a worker would actually use.
        const served = await global.api
            .get(`/api/v2/model/${registeredModelId}/artifact`)
            .responseType('blob');

        expect(served.status).toBe(200);
        expect(Buffer.from(served.body).equals(WEIGHTS)).toBe(true);
    });

    test('it says which species it knows', async () => {
        const rows = await db.sequelize.query(
            `SELECT s.comname FROM model_species ms
               JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :id
              ORDER BY s.comname`,
            { replacements: { id: registeredModelId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        // Without these the tracking engine refuses the weights, so a model registered
        // with no species is a model no inference job can run.
        expect(rows.map((r) => r.comname)).toEqual([...CLASS_NAMES].sort());
    });

    test('re-reporting the same job does not register a second model', async () => {
        await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/result`)
            .send({ worker_id: workerId, lease_epoch: leaseEpoch, outcome: 'succeeded', artifacts: [] });

        const [{ count }] = await db.sequelize.query(
            'SELECT COUNT(*)::int AS count FROM ml_models WHERE notes LIKE :marker',
            { replacements: { marker: `%GPU job ${jobId}.%` }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(count).toBe(1);
    });
});
