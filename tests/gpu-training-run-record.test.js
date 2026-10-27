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
 * **The names here were wrong, and that is why the defect survived.** This sent
 * `train/box_loss`, the ingest looked for `train/box_loss`, and the test passed — while
 * the real worker sends `val/box_loss` and the column stayed null on every run MARP
 * had ever recorded. A fixture that agrees with the code rather than with the thing
 * being modelled cannot catch a disagreement between them. These names are now copied
 * from an actual metric event on the development database, and mAP50 and mAP50-95 are
 * here too because they were never mapped at all.
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
                'metrics/mAP50(B)': 0.6 + epoch / 100,
                'metrics/mAP50-95(B)': 0.3 + epoch / 100,
                'val/box_loss': 1.5 - epoch / 100,
                'val/cls_loss': 1.1 - epoch / 100,
                'val/dfl_loss': 0.9 - epoch / 100,
                /* The training-set losses, which Ultralytics reports as a separate
                   series and which now have columns of their own. Deliberately far
                   from the validation values above, so a mapping that confused the
                   two fails loudly rather than plausibly. */
                'train/box_loss': 9.9,
                'train/cls_loss': 8.8,
                'train/dfl_loss': 7.7,
                'duration_seconds': 27.5,
                /* Elapsed seconds since training began, not instants. The epoch
                   number scales them so consecutive epochs do not overlap. */
                'start_offset_s': 27.5 * (epoch - 1),
                'end_offset_s': 27.5 * epoch,
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
        `DELETE FROM inference_settings
          WHERE engine = 'marp_training'
            AND name IN ('lr0', 'optimizer', 'momentum',
                         'compute_device', 'compute_device_index', 'train_script_commit')`,
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

    /**
     * What the worker observed about the machine reaches the run.
     *
     * **Three things are under test here and only one of them is a column.**
     *
     * The first is that the report is accepted at all. `compute_device` arrives with
     * `source: 'worker'`, which is a fifth source and was not in `SETTING_SOURCES` --
     * so until it was added the service refused the request with a 400. **And a
     * settings report does not travel alone:** it shares an event batch with metrics,
     * and the batch is accepted or refused as one. So the settings event and the epoch
     * event go in a single POST below, deliberately, because that is the shape in which
     * the failure costs an epoch rather than a label.
     *
     * The second is that the card reaches `training_runs.compute_device`. The column
     * asks for hardware -- the example in its own comment is an RTX 6000 Ada -- and the
     * worker sent `cuda:0` until 2026-10-27. The fixture sends both the card and the
     * slot, with values that cannot be confused, so a promotion that took the slot
     * fails here instead of looking right.
     *
     * The third is that the slot is kept and is not promoted. It is diagnostic for a
     * multi-GPU machine with one bad card, and it is not comparable between machines,
     * which is what a column on `training_runs` would imply that it is.
     */
    test('a run records the card it trained on, and leaves the slot in the settings', async () => {
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
                        params: { epochs: 50, batch: 8 },
                    }),
                },
                type: db.Sequelize.QueryTypes.SELECT,
                logging: false,
            }
        );

        const [attempt] = await db.sequelize.query(
            `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
             VALUES (:jobId, :workerId, 2, 1, 'running', NOW() + INTERVAL '1 hour')
             RETURNING id`,
            { replacements: { jobId: job.id, workerId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        try {
            /* **One batch, both events.** Settings first, as the worker sends them --
               the report goes out at `on_train_start` and the first epoch follows. If
               the source were refused, this POST would be a 400 and the epoch inside
               it would be lost with it. */
            const posted = await global.api
                .post(`/api/v2/gpu/attempts/${attempt.id}/events`)
                .send({
                    worker_id: workerId,
                    lease_epoch: 1,
                    events: [
                        {
                            seq: 0,
                            kind: 'settings',
                            payload: {
                                engine: 'marp_training',
                                settings: {
                                    /* The card and the slot, chosen so that one standing
                                       in for the other cannot pass. */
                                    compute_device: {
                                        value: 'NVIDIA GeForce RTX 4080 SUPER', type: 'text', source: 'worker',
                                    },
                                    compute_device_index: {
                                        value: 'cuda:1', type: 'text', source: 'worker',
                                    },
                                    train_script_commit: {
                                        value: '1e53c5af5093862ddf5c0a28d0', type: 'text', source: 'worker',
                                    },
                                },
                                ignored: {},
                            },
                        },
                        epochEvent(1, 1, 0.37),
                    ],
                });

            /* The refusal this guards against is a 400 on the whole request, so the
               status is the assertion rather than a precondition for one. */
            expect(posted.status).toBe(200);
            expect(posted.body.accepted).toBe(2);

            const [run] = await db.sequelize.query(
                'SELECT * FROM training_runs WHERE job_id = :jobId',
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(run).toBeTruthy();

            /* The card, which is what the column asks for. */
            expect(run.compute_device).toBe('NVIDIA GeForce RTX 4080 SUPER');

            /* **Not the slot**, which is the whole reason the worker changed what it
               sends. Asserted negatively as well, because a promotion that read
               `compute_device_index` would otherwise produce a plausible-looking
               string in a column nobody could compare across two machines. */
            expect(run.compute_device).not.toMatch(/^cuda:/);

            expect(run.train_script_commit).toBe('1e53c5af5093862ddf5c0a28d0');

            /* And the epoch that shared the batch is there, which is what the refusal
               used to cost. */
            const epochs = await db.sequelize.query(
                'SELECT epoch_number FROM epochs WHERE training_run_id = :runId',
                { replacements: { runId: run.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(epochs).toHaveLength(1);

            /* The slot is kept where it was reported, and nowhere else. */
            const [slot] = await db.sequelize.query(
                `SELECT a.value_text, a.source
                   FROM gpu_attempt_settings a
                   JOIN inference_settings s ON s.id = a.setting_id
                  WHERE a.attempt_id = :attemptId AND s.name = 'compute_device_index'`,
                { replacements: { attemptId: attempt.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(slot).toBeTruthy();
            expect(slot.value_text).toBe('cuda:1');
            expect(slot.source).toBe('worker');
        } finally {
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

    /**
     * **Null rather than a guess, when no worker said.** An older worker reports no
     * device at all, and a run that died before `on_train_start` reports none either.
     * The job spec is not a fallback: it holds what was asked for, and what `auto`
     * resolved to against this machine is the only thing that is a fact about the
     * hardware.
     */
    test('a run whose worker reported no device leaves the column null', async () => {
        const [run] = await db.sequelize.query(
            'SELECT compute_device, train_script_commit FROM training_runs WHERE job_id = :jobId',
            { replacements: { jobId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        expect(run).toBeTruthy();
        expect(run.compute_device).toBeNull();
        expect(run.train_script_commit).toBeNull();
    });

    /**
     * A per-batch sample is not an epoch, and must not be able to take one's place.
     *
     * **The two series share a call and a number.** The worker reports finished epochs
     * and live batch samples through the same `report_metrics`, and a batch sample's
     * step is a global batch counter -- so on a short run both series produce step 1.
     * Routing on the magnitude of the step would work on every long run and corrupt the
     * short ones.
     *
     * **And the corruption is loss, not noise.** The epoch insert is first-write-wins on
     * `(training_run_id, epoch_number)`: a sample arriving as step 1 mid-epoch takes
     * `epoch_number = 1`, and the real epoch 1 -- which arrives seconds later, carrying
     * the measurements -- is then silently never written. So the assertion that matters
     * is not that the sample was ignored; it is that the real epoch afterwards still
     * landed, with its own values.
     */
    describe('a per-batch sample arriving before the epoch it is inside', () => {
        let job;
        let attempt;

        beforeAll(async () => {
            [job] = await db.sequelize.query(
                `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
                 VALUES ('training', :spec, 'leased', 1, 1)
                 RETURNING id`,
                {
                    replacements: {
                        spec: JSON.stringify({
                            engine: 'marp_training',
                            model: { ml_model_id: modelId, name: 'jest', sha256: 'a'.repeat(64) },
                            dataset: { dataset_id: datasetId },
                            params: { epochs: 2, batch: 8 },
                        }),
                    },
                    type: db.Sequelize.QueryTypes.SELECT,
                    logging: false,
                }
            );

            [attempt] = await db.sequelize.query(
                `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
                 VALUES (:jobId, :workerId, 3, 1, 'running', NOW() + INTERVAL '1 hour')
                 RETURNING id`,
                { replacements: { jobId: job.id, workerId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );
        });

        afterAll(async () => {
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
        });

        it('does not become an epoch, and does not stop the real one landing', async () => {
            const post = (events) => global.api
                .post(`/api/v2/gpu/attempts/${attempt.id}/events`)
                .send({ worker_id: workerId, lease_epoch: 1, events });

            /* The sample, shaped as the worker sends it: a global batch counter as the
               step, and a running mean loss rather than a measured one. Its step is 1,
               which is also the number the first real epoch will carry. */
            const sample = await post([{
                seq: 0,
                kind: 'metric',
                payload: {
                    step: 1,
                    phase: 'training_batch',
                    metrics: {
                        epoch: 1,
                        batch: 1,
                        batches_total: 3,
                        'train/box_loss': 9.99,
                        iterations_per_second: 6.81,
                    },
                },
            }]);

            expect(sample.status).toBe(200);

            /* Nothing yet: a sample does not open a run and does not write a row. */
            const [opened] = await db.sequelize.query(
                'SELECT id FROM training_runs WHERE job_id = :jobId',
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(opened).toBeUndefined();

            /* Now the epoch the sample was inside, with its own measurements. */
            const epoch = await post([epochEvent(1, 1, 0.44)]);

            expect(epoch.status).toBe(200);

            const rows = await db.sequelize.query(
                `SELECT e.* FROM epochs e
                   JOIN training_runs r ON r.id = e.training_run_id
                  WHERE r.job_id = :jobId
                  ORDER BY e.epoch_number`,
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            /* **One row, and it is the epoch.** Two rows would mean the sample became
               one; one row carrying 9.99 would mean the sample took epoch 1 and the
               real measurements were refused by the first-write-wins guard. */
            expect(rows).toHaveLength(1);
            expect(rows[0].epoch_number).toBe(1);
            expect(Number(rows[0].precision)).toBeCloseTo(0.44);
            expect(Number(rows[0].box_loss)).toBeCloseTo(1.49);
        });

        /**
         * **Kept, not lost.** The sample is written to no table yet, and the event stream
         * still holds every number in it -- which is what made the five mis-mapped metric
         * columns recoverable by backfill rather than gone.
         */
        it('is still on the event stream, with its numbers', async () => {
            const [event] = await db.sequelize.query(
                'SELECT payload FROM gpu_job_events WHERE attempt_id = :attemptId AND seq = 0',
                { replacements: { attemptId: attempt.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(event).toBeTruthy();
            expect(event.payload.phase).toBe('training_batch');
            expect(event.payload.metrics['train/box_loss']).toBeCloseTo(9.99);
            expect(event.payload.metrics.iterations_per_second).toBeCloseTo(6.81);
        });
    });

    /**
     * A classification epoch, in the columns a classifier has rather than a detector's.
     *
     * **The keys are copied from a real two-epoch classify run**, captured through the
     * worker's own `_epoch_metrics` and cross-checked against Ultralytics' `results.csv`
     * header. They are not what anybody would guess: the loss is `loss`, not `cls_loss`,
     * and there is no `(B)` suffix anywhere because that marks box versus mask and
     * classification is neither.
     *
     * **This fixture is the one that has to disagree with the code to be worth having.**
     * Five columns on this table were null on every row MARP held for months because the
     * ingest looked for `train/box_loss` where the worker sends `val/box_loss` -- and the
     * test fixture sent what the code expected, so it passed throughout.
     */
    describe('an epoch of a classification run', () => {
        let job;
        let attempt;

        beforeAll(async () => {
            [job] = await db.sequelize.query(
                `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
                 VALUES ('training', :spec, 'leased', 1, 1)
                 RETURNING id`,
                {
                    replacements: {
                        spec: JSON.stringify({
                            engine: 'marp_training',
                            model: { ml_model_id: modelId, name: 'jest', sha256: 'a'.repeat(64) },
                            dataset: { dataset_id: datasetId },
                            params: { epochs: 2, batch: 8 },
                        }),
                    },
                    type: db.Sequelize.QueryTypes.SELECT,
                    logging: false,
                }
            );

            [attempt] = await db.sequelize.query(
                `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
                 VALUES (:jobId, :workerId, 3, 1, 'running', NOW() + INTERVAL '1 hour')
                 RETURNING id`,
                { replacements: { jobId: job.id, workerId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            await global.api
                .post(`/api/v2/gpu/attempts/${attempt.id}/events`)
                .send({
                    worker_id: workerId,
                    lease_epoch: 1,
                    events: [{
                        seq: 0,
                        kind: 'metric',
                        at: new Date().toISOString(),
                        payload: {
                            step: 1,
                            phase: 'training',
                            metrics: {
                                'metrics/accuracy_top1': 0.5,
                                'metrics/accuracy_top5': 1.0,
                                'train/loss': 0.61144,
                                'val/loss': 0.6933,
                                duration_seconds: 0.408,
                                start_offset_s: 0.0,
                                end_offset_s: 0.408,
                            },
                        },
                    }],
                });
        });

        afterAll(async () => {
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
        });

        it('records both losses and both accuracies', async () => {
            const [row] = await db.sequelize.query(
                `SELECT e.* FROM epochs e
                   JOIN training_runs r ON r.id = e.training_run_id
                  WHERE r.job_id = :jobId`,
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(row).toBeTruthy();

            /* **Unprefixed is validation**, as everywhere else on this table: loss is
               val/loss and train_loss is train/loss. Deliberately different values, so a
               mapping that swapped them fails loudly rather than plausibly. */
            expect(Number(row.loss)).toBeCloseTo(0.6933);
            expect(Number(row.train_loss)).toBeCloseTo(0.61144);

            expect(Number(row.accuracy_top1)).toBeCloseTo(0.5);
            expect(Number(row.accuracy_top5)).toBeCloseTo(1.0);
        });

        /**
         * **A classifier measures none of a detector's quantities, so they stay null.**
         * Null here means "this task does not report that", consistently with the rest
         * of the table -- not a measurement of zero, which on a loss curve would read as
         * a model collapsing.
         */
        it('leaves the detector columns null rather than zero', async () => {
            const [row] = await db.sequelize.query(
                `SELECT e.* FROM epochs e
                   JOIN training_runs r ON r.id = e.training_run_id
                  WHERE r.job_id = :jobId`,
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            for (const column of ['box_loss', 'cls_loss', 'dfl_loss', 'map50', 'map5095']) {
                expect(row[column]).toBeNull();
            }
        });

        /**
         * **The worker's own three come through identically**, which is worth asserting
         * because they are the worker's rather than Ultralytics' and could have been
         * task-specific without anybody noticing.
         */
        it('still carries the duration and the offsets', async () => {
            const [row] = await db.sequelize.query(
                `SELECT e.* FROM epochs e
                   JOIN training_runs r ON r.id = e.training_run_id
                  WHERE r.job_id = :jobId`,
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            expect(Number(row.duration_seconds)).toBeCloseTo(0.408);
            expect(Number(row.start_offset_s)).toBeCloseTo(0);
            expect(Number(row.end_offset_s)).toBeCloseTo(0.408);
        });

        /**
         * **Present, not merely non-null.** An absent key reads as "this MARP does not
         * have the column" rather than "this epoch has no value", and a chart cannot
         * tell a gap in the data from a gap in the API. This is the assertion that would
         * have caught the model never declaring the training-loss columns.
         */
        it('names all four columns on the endpoint that serves them', async () => {
            const [run] = await db.sequelize.query(
                'SELECT id FROM training_runs WHERE job_id = :jobId',
                { replacements: { jobId: job.id }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
            );

            const res = await global.api.get(`/api/v2/training_run/${run.id}/epochs`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);

            for (const column of ['loss', 'train_loss', 'accuracy_top1', 'accuracy_top5']) {
                expect(res.body[0]).toHaveProperty(column);
            }

            expect(res.body[0].accuracy_top1).toBeCloseTo(0.5);
        });
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

        /* The two that were never mapped. Until `db/epoch-metrics.js` they were null
           on every epoch row MARP held, with the values sitting in the events. */
        expect(Number(rows[1].map50)).toBeCloseTo(0.62);
        expect(Number(rows[1].map5095)).toBeCloseTo(0.32);

        /* **Both series, in their own columns.** The gap between them is the
           overfitting signal, and it only exists if the two never share a column. */
        expect(Number(rows[1].box_loss)).toBeCloseTo(1.48);
        expect(Number(rows[1].train_box_loss)).toBeCloseTo(9.9);
        expect(Number(rows[1].train_cls_loss)).toBeCloseTo(8.8);
        expect(Number(rows[1].train_dfl_loss)).toBeCloseTo(7.7);

        /* A column that has existed since the table did and that nothing ever wrote. */
        expect(Number(rows[1].duration_seconds)).toBeCloseTo(27.5);

        /* **Where the epoch sat in the run, in elapsed seconds.** `start_time` and
           `end_time` are timestamps and stay null: an offset is not a time, and the
           column type would have let that lie through. */
        expect(Number(rows[1].start_offset_s)).toBeCloseTo(27.5);
        expect(Number(rows[1].end_offset_s)).toBeCloseTo(55);
        expect(rows[1].start_time).toBeNull();
        expect(rows[1].end_time).toBeNull();

        // Exactly, because it is the trainer's arithmetic rather than ours.
        expect(Number(rows[1].end_offset_s) - Number(rows[1].start_offset_s))
            .toBeCloseTo(Number(rows[1].duration_seconds));
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
