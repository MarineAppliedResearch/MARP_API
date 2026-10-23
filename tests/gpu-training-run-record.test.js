/**
 * Tests that a training job writes the scientific record, not only an event stream.
 *
 * `training_runs`, `epochs` and the rest were written for the legacy desktop
 * script and nothing in the job path has ever filled them in. An event stream is
 * enough to watch a job and not enough to answer "what did this model learn, and
 * when" -- which is what the ML Dashboard asks, and what anybody comparing two
 * models asks.
 *
 * This drives the real cycle: queue a training job, lease it as a worker, report
 * epochs the way the worker reports them, and publish a result. Nothing is
 * mocked below the HTTP boundary, because the thing under test is a projection
 * that happens inside the same transaction as the event insert, and a test that
 * called the projection directly would prove only that the projection runs.
 *
 * Everything is seeded and removed by this file, as `tests/setup/corpus-guard.js`
 * requires.
 *
 * @fileoverview Tests that metric events become training_runs and epochs rows.
 * @author Isaac Travers
 * @module tests/gpu-training-run-record
 */

const db = require('../model');

/** Unique per run, so two runs cannot collide on a worker or dataset name. */
const runId = Date.now();

/** A sha256-shaped value for the packaged dataset. */
const ARCHIVE_SHA = 'd'.repeat(64);

let datasetId;
let modelId;
let workerId;
let jobId;
let attemptId;
let leaseEpoch;

/**
 * One metric event, shaped exactly as the worker sends them.
 *
 * The worker's child emits `metrics`; `coordinator_event` rewrites that to
 * `metric` and moves everything that is not envelope into the payload. So an
 * epoch arrives as `{step, phase, metrics: {...}}`.
 *
 * @param {number} seq - The event's sequence number.
 * @param {number} epoch - Which epoch this is.
 * @param {number} precision - A recognisable precision value.
 * @returns {Object} The event.
 */
function epochEvent(seq, epoch, precision) {
    return {
        seq,
        kind: 'metric',
        at: new Date().toISOString(),
        payload: {
            step: epoch,
            phase: 'training',
            metrics: {
                'metrics/precision(B)': precision,
                'metrics/recall(B)': 0.5 + epoch / 100,
                'train/box_loss': 1.5 - epoch / 100,
                'train/cls_loss': 1.1 - epoch / 100,
                'train/dfl_loss': 0.9 - epoch / 100,
                // Deliberately unmapped: it must survive on the event and not
                // break the projection.
                'lr/pg0': 0.00123,
            },
        },
    };
}

beforeAll(async () => {
    const [dataset] = await db.sequelize.query(
        `INSERT INTO datasets (name, location, num_samples, num_classes, source, status,
                               archive_path, archive_sha256, archive_bytes, created_at, updated_at)
         VALUES (:name, 'test', 10, 2, 'test', 'ready', :path, :sha, 1024, now(), now())
         RETURNING id`,
        {
            replacements: {
                name: `jest-trainrec-dataset-${runId}`,
                path: `datasets/${ARCHIVE_SHA}.tar`,
                sha: ARCHIVE_SHA,
            },
            type: db.Sequelize.QueryTypes.INSERT,
            logging: false,
        }
    );
    datasetId = dataset[0].id;

    // A run is recorded against the model it started from, and
    // `training_runs.model_id` is NOT NULL, so the starting model has to be a
    // real row rather than a name.
    const [model] = await db.sequelize.query(
        `INSERT INTO ml_models (name, model_type, architecture_version, status, created_at, updated_at)
         VALUES (:name, 'detection', 'yolo11m', 'ready', now(), now())
         RETURNING id`,
        { replacements: { name: `jest-trainrec-model-${runId}` }, type: db.Sequelize.QueryTypes.INSERT, logging: false }
    );
    modelId = model[0].id;

    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-trainrec-local-${runId}`,
            name: `jest-trainrec-worker-${runId}`,
            slot_count: 4,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [{ name: 'jest-gpu', vram_mb: 1024 }], engines: ['marp_training'] },
        });
    workerId = enrolled.body.worker_id;

    const submitted = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'training',
            // High, so this file's poll leases its own job rather than whatever
            // else happens to be queued.
            priority: 9000,
            spec: {
                engine: 'marp_training',
                model: {
                    name: 'yolo11m.pt',
                    sha256: 'e'.repeat(64),
                    url: '/api/v2/model/91/artifact',
                    ml_model_id: modelId,
                },
                dataset: { dataset_id: datasetId },
                params: { epochs: 50, batch: 16, lr0: 0.01, optimizer: 'SGD' },
            },
        });
    jobId = submitted.body.jobs[0].id;

    const leased = await global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0, capabilities: { gpus: [] } });

    attemptId = leased.body.attempt_id;
    leaseEpoch = leased.body.lease_epoch;
});

afterAll(async () => {
    await db.sequelize.query('DELETE FROM epochs WHERE training_run_id IN (SELECT id FROM training_runs WHERE job_id = :jobId)', {
        replacements: { jobId }, logging: false,
    });
    await db.sequelize.query('DELETE FROM training_runs WHERE job_id = :jobId', {
        replacements: { jobId }, logging: false,
    });
    await db.sequelize.query('DELETE FROM gpu_job_events WHERE attempt_id = :attemptId', {
        replacements: { attemptId }, logging: false,
    });
    /* The catalogue outlives the attempt its rows came from: `gpu_attempt_settings`
       cascades, `inference_settings` does not. Left behind, these are rows this file
       added to a database it does not own. */
    await db.sequelize.query(
        "DELETE FROM inference_settings WHERE engine = 'marp_training' AND name IN ('lr0', 'optimizer', 'momentum')",
        { logging: false }
    );
    await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id = :jobId', {
        replacements: { jobId }, logging: false,
    });
    await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :jobId', {
        replacements: { jobId }, logging: false,
    });
    await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :workerId', {
        replacements: { workerId }, logging: false,
    });
    await db.sequelize.query('DELETE FROM datasets WHERE id = :datasetId', {
        replacements: { datasetId }, logging: false,
    });
    await db.sequelize.query('DELETE FROM ml_models WHERE id = :modelId', {
        replacements: { modelId }, logging: false,
    });
});

describe('a training job writes training_runs and epochs', () => {

    test('the job leased as a training job in the first place', () => {
        expect(attemptId).toBeTruthy();
        expect(leaseEpoch).toBeTruthy();
    });

    test('the first epoch opens a run, carrying what it was asked to train with', async () => {
        const response = await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/events`)
            .send({ worker_id: workerId, lease_epoch: leaseEpoch, events: [epochEvent(0, 1, 0.41)] });

        expect(response.status).toBe(200);

        const [run] = await db.sequelize.query(
            'SELECT * FROM training_runs WHERE job_id = :jobId',
            { replacements: { jobId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(run).toBeTruthy();
        expect(run.dataset_id).toBe(datasetId);
        expect(run.model_id).toBe(modelId);
        expect(Number(run.batch_size)).toBe(16);

        /* **Null, because nothing resolved them.** The spec asked for `lr0: 0.01` and
           `optimizer: SGD`, and this run reported no resolved settings -- it is a run
           that never reached `on_train_start`, or an older worker. The request is still
           in `gpu_jobs.spec`; what is not known is what the engine actually used, and a
           column that is sometimes the request and sometimes the truth cannot be read.

           This used to assert 0.01 and SGD, copied straight from the spec. Ultralytics
           resolves `optimizer: auto` into its own optimizer, learning rate and momentum
           and logs that it is discarding the submitted ones, so that column was the
           request wearing the name of the result. */
        expect(run.learning_rate).toBeNull();
        expect(run.optimizer).toBeNull();

        // Open, because the job has not reported a result yet.
        expect(run.end_time).toBeNull();
    });

    /**
     * What the engine resolved reaches the run, and it is not what was asked for.
     *
     * The spec says `lr0: 0.01` and `optimizer: SGD`; the engine reports `AdamW` at
     * `0.002`. Those are deliberately different so a run reading the spec fails here
     * rather than passing on a coincidence. The second report arrives before the first
     * epoch, which is where `on_train_start` sits.
     */
    test('a run records the optimizer and rate the engine resolved, not the ones asked for', async () => {
        const [job] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
             VALUES ('training', :spec, 'leased', 1, 1)
             RETURNING id`,
            {
                replacements: {
                    spec: JSON.stringify({
                        engine: 'marp_training',
                        model: { ml_model_id: modelId, name: 'jest', sha256: 'a'.repeat(64) },
                        dataset: { dataset_id: datasetId },
                        params: { epochs: 50, batch: 8, lr0: 0.01, optimizer: 'SGD' },
                    }),
                },
                type: db.Sequelize.QueryTypes.SELECT,
                logging: false,
            }
        );

        const [attempt] = await db.sequelize.query(
            `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
             VALUES (:jobId, :workerId, 1, 1, 'running', NOW() + INTERVAL '1 hour')
             RETURNING id`,
            { replacements: { jobId: job.id, workerId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        const post = (events) => global.api
            .post(`/api/v2/gpu/attempts/${attempt.id}/events`)
            .send({ worker_id: workerId, lease_epoch: 1, events });

        try {
            const settings = await post([{
                seq: 0,
                kind: 'settings',
                payload: {
                    engine: 'marp_training',
                    settings: {
                        optimizer: { value: 'AdamW', type: 'text', source: 'resolved' },
                        lr0: { value: 0.002, type: 'real', source: 'resolved' },
                    },
                    ignored: {},
                },
            }]);

            expect(settings.status).toBe(200);

            const first = await post([epochEvent(1, 1, 0.33)]);

            expect(first.status).toBe(200);

            const [run] = await db.sequelize.query(
                'SELECT * FROM training_runs WHERE job_id = :jobId',
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(run).toBeTruthy();
            expect(Number(run.learning_rate)).toBeCloseTo(0.002);
            expect(run.optimizer).toBe('AdamW');

            // And the request is untouched where it belongs.
            const [kept] = await db.sequelize.query(
                'SELECT spec FROM gpu_jobs WHERE id = :jobId',
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(kept.spec.params.optimizer).toBe('SGD');
            expect(kept.spec.params.lr0).toBe(0.01);
        } finally {
            /* Created here, so removed here, whatever the assertions did. */
            await db.sequelize.query(
                'DELETE FROM epochs WHERE training_run_id IN (SELECT id FROM training_runs WHERE job_id = :jobId)',
                { replacements: { jobId: job.id }, logging: false }
            );
            await db.sequelize.query('DELETE FROM training_runs WHERE job_id = :jobId', {
                replacements: { jobId: job.id }, logging: false,
            });
            await db.sequelize.query('DELETE FROM gpu_job_events WHERE attempt_id = :attemptId', {
                replacements: { attemptId: attempt.id }, logging: false,
            });
            await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE id = :attemptId', {
                replacements: { attemptId: attempt.id }, logging: false,
            });
            await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :jobId', {
                replacements: { jobId: job.id }, logging: false,
            });
        }
    });

    test('each epoch becomes a row, with the metrics mapped to their columns', async () => {
        await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/events`)
            .send({ worker_id: workerId, lease_epoch: leaseEpoch, events: [epochEvent(1, 2, 0.52)] });

        const rows = await db.sequelize.query(
            `SELECT e.* FROM epochs e
               JOIN training_runs r ON r.id = e.training_run_id
              WHERE r.job_id = :jobId
              ORDER BY e.epoch_number`,
            { replacements: { jobId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.epoch_number)).toEqual([1, 2]);
        expect(Number(rows[0].precision)).toBeCloseTo(0.41);
        expect(Number(rows[1].precision)).toBeCloseTo(0.52);
        expect(Number(rows[1].box_loss)).toBeCloseTo(1.48);
        expect(Number(rows[1].dfl_loss)).toBeCloseTo(0.88);
    });

    test('a replayed batch does not write the same epoch twice', async () => {
        // Same seq as the first batch. A worker retrying after a network failure
        // resends exactly this, and the event is deduplicated on (attempt, seq) --
        // the epoch must be too, or a flaky connection inflates the record.
        await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/events`)
            .send({ worker_id: workerId, lease_epoch: leaseEpoch, events: [epochEvent(0, 1, 0.41)] });

        const [{ count }] = await db.sequelize.query(
            `SELECT COUNT(*)::int AS count FROM epochs e
               JOIN training_runs r ON r.id = e.training_run_id
              WHERE r.job_id = :jobId`,
            { replacements: { jobId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(count).toBe(2);
    });

    test('publishing the result closes the run and records what it actually did', async () => {
        const response = await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: leaseEpoch,
                outcome: 'succeeded',
                artifacts: [],
            });

        expect(response.status).toBe(200);

        const [run] = await db.sequelize.query(
            'SELECT * FROM training_runs WHERE job_id = :jobId',
            { replacements: { jobId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(run.end_time).not.toBeNull();

        // Two, not the fifty it was asked for. A run that stopped early on
        // `patience`, or was stopped by the operator, did fewer epochs than it
        // was asked for, and this column is read as how long it actually trained.
        expect(Number(run.total_epochs)).toBe(2);
    });
});
