/**
 * Tests for the per-batch samples a training run reports while it is running.
 *
 * **The live view of a run, which MARP had no record of at all.** An epoch row is written
 * when an epoch finishes, and a real epoch here takes minutes -- so a reader watching a
 * training run learned something every couple of minutes while the console that run is
 * printing to moved every batch. The worker now reports a sample about every 2.5 seconds
 * and this is where they are kept and served.
 *
 * Three things are asserted here that nothing else can see:
 *
 * - **A sample is not an epoch.** The two series arrive through the same call and their
 *   steps overlap numerically, so the routing is on the phase. `gpu-training-run-record`
 *   proves the epoch side; this proves the sample side, including that both happen for
 *   one event stream without either writing the other's rows.
 * - **The read is incremental and strided.** A poll asks for what is new; a first load of
 *   a long run is thinned rather than cut, and the newest sample survives the thinning.
 * - **A retry is a seam, not a jump.** A second attempt restarts the step counter, and a
 *   series that dropped it or merged it would mislead in opposite directions.
 *
 * Everything is seeded and removed by this file, as `tests/setup/corpus-guard.js`
 * requires.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Endpoint and ingest tests for training_batch_samples.
 * @author Isaac Travers
 * @module tests/training-batch-samples
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const { backfill } = require('../scripts/backfill-training-batch-samples');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { jobId: null, attemptIds: [], trainingRunId: null, modelId: null, workerId: null };

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });
}

/**
 * One per-batch sample, shaped exactly as worker 0.1.9 sends them.
 *
 * **Copied from a real two-epoch run rather than invented**, because a fixture that
 * agrees with the code instead of with the thing being modelled cannot catch a
 * disagreement between them -- which is how five epoch metrics stayed null for months.
 *
 * @param {number} seq - The event's sequence number.
 * @param {number} step - The worker's global batch counter.
 * @param {Object} [over] - Fields to replace in the metrics.
 * @param {string} [phase] - Which series this belongs to.
 * @returns {Object} The event.
 */
function sampleEvent(seq, step, over = {}, phase = 'training_batch') {
    return {
        seq,
        kind: 'metric',
        at: new Date(Date.UTC(2026, 9, 27, 18, 0, seq % 60)).toISOString(),
        payload: {
            step,
            phase,
            metrics: {
                epoch: 1,
                batch: step,
                batches_total: 3,
                epoch_eta_seconds: 0.3,
                gpu_memory_bytes: 734003200,
                imgsz: 32,
                iterations_per_second: 6.81,
                'train/loss': 0.47985,
                ...over,
            },
        },
    };
}

beforeAll(async () => {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, slot_count, worker_version, capabilities, state, enrolled_at, last_seen_at)
         VALUES (:localId, :name, 2, '0.1.9-jest', '{}'::jsonb, 'online', NOW(), NOW())
         RETURNING id`,
        { localId: `jest-samples-${runId}`, name: `jest-samples-worker-${runId}` }
    );

    made.workerId = worker.id;

    const [model] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, NOW(), NOW())
         RETURNING id`,
        { name: `jest-samples-model-${runId}` }
    );

    made.modelId = model.id;

    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
         VALUES ('training', :spec, 'leased', 1, 3)
         RETURNING id`,
        {
            spec: JSON.stringify({
                engine: 'marp_training',
                model: { ml_model_id: model.id, name: 'jest', sha256: 'a'.repeat(64) },
                params: { epochs: 2, batch: 8 },
            }),
        }
    );

    made.jobId = job.id;

    for (const slot of [0, 1]) {
        const [attempt] = await query(
            `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
             VALUES (:jobId, :workerId, :slot, :epoch, 'running', NOW() + INTERVAL '1 hour')
             RETURNING id`,
            { jobId: job.id, workerId: made.workerId, slot, epoch: slot + 1 }
        );

        made.attemptIds.push(attempt.id);
    }

    /* The run exists already here, because this file is about the samples rather than
       about when a run is opened -- that is `gpu-training-run-record`'s subject. */
    const [run] = await query(
        `INSERT INTO training_runs (job_id, model_id, total_epochs, start_time, created_at, updated_at)
         VALUES (:jobId, :modelId, 2, NOW(), NOW(), NOW())
         RETURNING id`,
        { jobId: job.id, modelId: model.id }
    );

    made.trainingRunId = run.id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.trainingRunId) {
        await drop('DELETE FROM epochs WHERE training_run_id = :id', { id: made.trainingRunId });
        await drop('DELETE FROM training_runs WHERE id = :id', { id: made.trainingRunId });
    }

    for (const id of made.attemptIds) {
        await drop('DELETE FROM training_batch_samples WHERE attempt_id = :id', { id });
        await drop('DELETE FROM gpu_job_events WHERE attempt_id = :id', { id });
        await drop('DELETE FROM gpu_job_attempts WHERE id = :id', { id });
    }

    if (made.jobId) await drop('DELETE FROM gpu_jobs WHERE id = :id', { id: made.jobId });
    if (made.workerId) await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
    if (made.modelId) await drop('DELETE FROM ml_models WHERE id = :id', { id: made.modelId });
});

/**
 * Post events as the worker does, against one attempt.
 *
 * @param {number} attemptId - Which attempt.
 * @param {number} leaseEpoch - Its lease epoch.
 * @param {Array<Object>} events - The events.
 * @returns {Promise<Object>} The response.
 */
function post(attemptId, leaseEpoch, events) {
    return global.api
        .post(`/api/v2/gpu/attempts/${attemptId}/events`)
        .send({ worker_id: made.workerId, lease_epoch: leaseEpoch, events });
}

describe('Taking per-batch samples onto the record', () => {

    it('keeps every sample, rather than only the latest', async () => {
        const response = await post(made.attemptIds[0], 1, [
            sampleEvent(0, 1),
            sampleEvent(1, 2, { 'train/loss': 0.4 }),
            sampleEvent(2, 3, { 'train/loss': 0.33 }),
        ]);

        expect(response.status).toBe(200);
        expect(response.body.accepted).toBe(3);

        const rows = await query(
            'SELECT step, phase, epoch, batch, batches_total FROM training_batch_samples WHERE attempt_id = :id ORDER BY step',
            { id: made.attemptIds[0] }
        );

        /* **Three, not one.** A progress snapshot answers "where is it now" and is
           overwritten; this is a series and cannot be, which is the whole distinction
           between the two channels. */
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => row.step)).toEqual([1, 2, 3]);
        expect(rows[0].phase).toBe('training_batch');
        expect(rows[0].batches_total).toBe(3);
    });

    /**
     * **Stored as sent.** A detector reports three losses by name and a classifier one, so
     * nothing here maps or renames. A worker that starts reporting a new number is
     * recorded the day it does rather than the day MARP learns about it.
     */
    it('stores the measurements under the names the trainer used', async () => {
        const [row] = await query(
            'SELECT metrics FROM training_batch_samples WHERE attempt_id = :id AND step = 1',
            { id: made.attemptIds[0] }
        );

        expect(row.metrics['train/loss']).toBeCloseTo(0.47985);
        expect(row.metrics.iterations_per_second).toBeCloseTo(6.81);
        expect(row.metrics.imgsz).toBe(32);

        /* **Bytes, not gigabytes.** 700 MB at gigabyte precision rounds to 0.0, which
           reads as no memory in use when it means less than half a gigabyte. */
        expect(row.metrics.gpu_memory_bytes).toBe(734003200);
    });

    /**
     * **A sample is not an epoch, and the guard is in one place.** Both writers read the
     * same metric events; the phase decides which acts. This asserts the other side of
     * `gpu-training-run-record`'s test: the samples wrote no epoch row.
     */
    it('writes no epoch row, whatever its step says', async () => {
        const epochs = await query(
            'SELECT id FROM epochs WHERE training_run_id = :id',
            { id: made.trainingRunId }
        );

        expect(epochs).toHaveLength(0);
    });

    /** A validation-pass sample is its own series and says so. */
    it('keeps validating_batch apart from training_batch', async () => {
        await post(made.attemptIds[0], 1, [sampleEvent(3, 1, {}, 'validating_batch')]);

        const rows = await query(
            `SELECT phase, step FROM training_batch_samples
              WHERE attempt_id = :id AND step = 1 ORDER BY phase`,
            { id: made.attemptIds[0] }
        );

        /* The unique index is (attempt, step, phase), so the same step in two phases is
           two samples rather than one overwriting the other. */
        expect(rows.map((row) => row.phase)).toEqual(['training_batch', 'validating_batch']);
    });
});

/**
 * Several different events at one step, which is the shape that broke this table.
 *
 * **The first key was `(attempt_id, step, phase)` and it threw most of the series**
 * **away.** Job 21801 sent 14 `training_batch` metric events and MARP stored 4. The
 * worker reports phase markers -- `validating`, `validated`, `saving` -- through the
 * same phase as the batch samples, with no `batch`, at the same step as the *next*
 * epoch's batch 0. `ON CONFLICT DO NOTHING` kept whichever arrived first, so the row
 * stored at step 144 was the validating marker and the measurement behind it, the
 * opening batch of epoch 2, was discarded. Every epoch after the first lost its first
 * sample and kept a marker instead.
 *
 * **The sequence below is job 21801's, read off `gpu_job_events` rather than imagined**
 * -- including the detail that makes the obvious fix wrong. Step 432 carries two
 * `validating` markers and two `validated` markers, one pair for epoch 3 and one for
 * epoch 4, so a key of `(attempt_id, step, phase, phase_entered)` still collides twice
 * on this very job.
 */
/**
 * Job 21801's events, by seq, step, phase marker, batch and epoch.
 *
 * **Read off `gpu_job_events` rather than imagined**, which is what makes it worth
 * driving two different tests from. Its shape is the defect: four or five distinct
 * events share a step, and step 432 carries two `validating` markers and two `validated`
 * markers -- one pair for epoch 3 and one for epoch 4.
 *
 * @constant
 */
const REAL_SEQUENCE = [
    [12, 0, null, 0, 1],
    [61, 144, 'validating', null, 1],
    [63, 144, 'validated', null, 1],
    [64, 144, 'saving', null, 1],
    [69, 144, null, 0, 2],
    [118, 288, 'validating', null, 2],
    [120, 288, 'validated', null, 2],
    [121, 288, 'saving', null, 2],
    [124, 288, null, 0, 3],
    [173, 432, 'validating', null, 3],
    [175, 432, 'validated', null, 3],
    [176, 432, 'saving', null, 3],
    [179, 432, 'validating', null, 4],
    [181, 432, 'validated', null, 4],
];

/**
 * That sequence as events the worker would post.
 *
 * @returns {Array<Object>} The events, in seq order.
 */
function realEvents() {
    return REAL_SEQUENCE.map(([seq, step, entered, batch, epoch]) => ({
        seq,
        kind: 'metric',
        at: new Date(Date.UTC(2026, 9, 28, 1, 0, seq % 60)).toISOString(),
        payload: {
            step,
            phase: 'training_batch',
            metrics: {
                epoch,
                ...(entered ? { phase_entered: entered } : {}),
                ...(batch === null ? {} : { batch, batches_total: 144 }),
                'train/box_loss': 1 - (seq / 1000),
            },
        },
    }));
}

describe('Several events at one step', () => {
    const REAL = REAL_SEQUENCE;

    beforeAll(async () => {
        const response = await post(made.attemptIds[1], 2, realEvents());

        expect(response.status).toBe(200);
        expect(response.body.accepted).toBe(REAL.length);
    });

    afterAll(async () => {
        await db.sequelize.query(
            'DELETE FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12',
            { replacements: { id: made.attemptIds[1] }, logging: false }
        );
        await db.sequelize.query(
            'DELETE FROM gpu_job_events WHERE attempt_id = :id AND seq >= 12',
            { replacements: { id: made.attemptIds[1] }, logging: false }
        );
    });

    /**
     * **14 in, 14 out.** The count is the assertion, because the defect was arithmetic:
     * MARP received every event and stored a third of them.
     */
    it('keeps every event, not one per step', async () => {
        const rows = await query(
            'SELECT seq FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12 ORDER BY seq',
            { id: made.attemptIds[1] }
        );

        expect(rows).toHaveLength(REAL.length);
        expect(rows.map((row) => row.seq)).toEqual(REAL.map(([seq]) => seq));
    });

    /**
     * **The measurement that used to be lost.** At step 144 the marker arrived first and
     * took the row; the opening batch of epoch 2 behind it was discarded. That sample is
     * the one a chart needs -- a marker carries no loss at all.
     */
    it('keeps the next epoch\'s first batch, which the old key discarded', async () => {
        const rows = await query(
            `SELECT seq, epoch, batch, metrics FROM training_batch_samples
              WHERE attempt_id = :id AND step = 144 ORDER BY seq`,
            { id: made.attemptIds[1] }
        );

        expect(rows).toHaveLength(4);

        const opening = rows.find((row) => row.seq === 69);

        expect(opening).toBeTruthy();
        expect(opening.epoch).toBe(2);
        expect(opening.batch).toBe(0);
        expect(opening.metrics['train/box_loss']).toBeCloseTo(0.931);
    });

    /**
     * **The fix that would not have worked, asserted so nobody tries it later.** Step 432
     * holds two `validating` markers and two `validated` markers -- epoch 3 and epoch 4 --
     * so keying on `(attempt_id, step, phase, phase_entered)` would still have dropped
     * two of these five rows.
     */
    it('keeps both of the two identically-labelled markers at one step', async () => {
        const rows = await query(
            `SELECT seq, epoch, metrics->>'phase_entered' AS entered
               FROM training_batch_samples
              WHERE attempt_id = :id AND step = 432 ORDER BY seq`,
            { id: made.attemptIds[1] }
        );

        expect(rows).toHaveLength(5);

        const validating = rows.filter((row) => row.entered === 'validating');

        expect(validating).toHaveLength(2);
        expect(validating.map((row) => row.epoch)).toEqual([3, 4]);
    });

    /**
     * **And a resend still dedupes, which is what the key was for.** The event stream
     * refuses a replayed seq before this is reached, so the index is the second line of
     * defence rather than the first -- but it has to hold, or a retried batch would
     * double every point on the chart and read as a stall.
     */
    it('still refuses the same event twice', async () => {
        const before = await query(
            'SELECT count(*)::int AS n FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12',
            { id: made.attemptIds[1] }
        );

        await db.sequelize.query(
            `INSERT INTO training_batch_samples
                 (attempt_id, seq, step, phase, epoch, batch, batches_total, at, metrics, created_at)
             VALUES (:id, 69, 144, 'training_batch', 2, 0, 144, NOW(), '{}'::jsonb, NOW())
             ON CONFLICT (attempt_id, seq) DO NOTHING`,
            { replacements: { id: made.attemptIds[1] }, logging: false }
        );

        const after = await query(
            'SELECT count(*)::int AS n FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12',
            { id: made.attemptIds[1] }
        );

        expect(after[0].n).toBe(before[0].n);
    });
});

/**
 * Recovering the samples the old key discarded.
 *
 * **Nothing was lost, only not stored.** Every discarded sample is still in
 * `gpu_job_events`, which is why that table keeps whole payloads rather than the parts
 * MARP knew how to read at the time -- the same property that recovered five epoch
 * metric columns after a mapping bug.
 *
 * This drives `scripts/backfill-training-batch-samples.js` itself rather than a copy of
 * its logic, because a recovery script that is tested by a reimplementation of it is
 * tested against the wrong thing.
 */
describe('Recovering samples from the events', () => {
    /** What the attempt held before anything was deleted. */
    let before;

    /**
     * Its own copy of the sequence, on its own attempt.
     *
     * **Not the one the describe above posts.** That block removes its events and samples
     * in `afterAll`, so reading them here made this depend on the order two sibling
     * describes happen to run in -- which it did, and three of these failed finding one
     * row where fourteen were expected. A fixture another test tidies away is not a
     * fixture.
     */
    /* **Read inside `beforeAll`, not at describe time.** A describe body runs while Jest
       is collecting tests, before any hook has fired, so `made.attemptIds` is still empty
       there -- and a `const` taken from it is `undefined`, which posts to
       `/attempts/undefined/events` and answers 400. */
    let attemptId;

    beforeAll(async () => {
        attemptId = made.attemptIds[0];

        const posted = await post(attemptId, 1, realEvents());

        expect(posted.status).toBe(200);

        before = await query(
            'SELECT seq FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12 ORDER BY seq',
            { id: attemptId }
        );

        /* Delete exactly the ones the old key would have dropped: everything but the
           first of each step. That leaves the table in the state job 21801 is actually
           in on the development database -- four rows out of fourteen. */
        await db.sequelize.query(
            `DELETE FROM training_batch_samples s
              WHERE s.attempt_id = :id AND s.seq >= 12
                AND EXISTS (SELECT 1 FROM training_batch_samples o
                             WHERE o.attempt_id = s.attempt_id AND o.step = s.step
                               AND o.phase = s.phase AND o.seq < s.seq)`,
            { replacements: { id: attemptId }, logging: false }
        );
    });

    afterAll(async () => {
        await db.sequelize.query(
            'DELETE FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12',
            { replacements: { id: attemptId }, logging: false }
        );
        await db.sequelize.query(
            'DELETE FROM gpu_job_events WHERE attempt_id = :id AND seq >= 12',
            { replacements: { id: attemptId }, logging: false }
        );
    });

    it('leaves the table in the state the old key produced', async () => {
        const left = await query(
            'SELECT seq FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12 ORDER BY seq',
            { id: attemptId }
        );

        /* The four seqs job 21801 actually has stored: the first event of each step. */
        expect(left.map((row) => row.seq)).toEqual([12, 61, 118, 173]);
    });

    it('reports what is missing without writing anything', async () => {
        const dry = await backfill({ apply: false, attemptId: attemptId });

        expect(dry.missing).toBe(10);
        expect(dry.written).toBe(0);

        const still = await query(
            'SELECT count(*)::int AS n FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12',
            { id: attemptId }
        );

        expect(still[0].n).toBe(4);
    });

    it('puts every one of them back, from the events', async () => {
        const applied = await backfill({ apply: true, attemptId: attemptId });

        expect(applied.written).toBe(10);

        const after = await query(
            'SELECT seq FROM training_batch_samples WHERE attempt_id = :id AND seq >= 12 ORDER BY seq',
            { id: attemptId }
        );

        expect(after.map((row) => row.seq)).toEqual(before.map((row) => row.seq));
    });

    /**
     * **A recovered row is the row the ingest would have written**, not an approximation
     * of it. If it were not, a chart would show a seam at the point of recovery and
     * nothing would say why.
     */
    it('recovers the columns, not just the rows', async () => {
        const [opening] = await query(
            `SELECT seq, step, phase, epoch, batch, batches_total, metrics
               FROM training_batch_samples WHERE attempt_id = :id AND seq = 69`,
            { id: attemptId }
        );

        expect(opening).toBeTruthy();
        expect(opening.step).toBe(144);
        expect(opening.phase).toBe('training_batch');
        expect(opening.epoch).toBe(2);
        expect(opening.batch).toBe(0);
        expect(opening.batches_total).toBe(144);
        expect(opening.metrics['train/box_loss']).toBeCloseTo(0.931);
    });

    /** Idempotent, because the table is keyed by the event the row came from. */
    it('changes nothing on a second run', async () => {
        const again = await backfill({ apply: true, attemptId: attemptId });

        expect(again.missing).toBe(0);
        expect(again.written).toBe(0);
    });
});

describe('Reading the series back', () => {

    it('serves them oldest first, with what the worker measured', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/samples`);

        expect(res.status).toBe(200);
        expect(res.body.samples.length).toBeGreaterThanOrEqual(4);
        expect(res.body.strided).toBe(false);
        expect(res.body.matched).toBe(res.body.returned);

        const first = res.body.samples[0];

        expect(first.attempt_id).toBe(made.attemptIds[0]);
        expect(first.step).toBe(1);
        expect(first.metrics['train/loss']).toBeCloseTo(0.47985);
    });

    /**
     * **The point of the endpoint: a poll carries what is new, not the run again.** At one
     * sample every 2.5 seconds and a poll every few seconds, the alternative is refetching
     * a growing series for ever.
     */
    it('returns only what is past the step the caller already has', async () => {
        const res = await global.api
            .get(`/api/v2/training_run/${made.trainingRunId}/samples`)
            .query({ after_step: 2 });

        expect(res.status).toBe(200);
        expect(res.body.samples.length).toBeGreaterThan(0);

        for (const sample of res.body.samples) {
            expect(sample.step).toBeGreaterThan(2);
        }
    });

    /** A run nobody has reported on is an empty series, not an error. */
    it('answers an empty series for a run that has reported nothing', async () => {
        const [bare] = await query(
            `INSERT INTO training_runs (job_id, model_id, total_epochs, start_time, created_at, updated_at)
             VALUES (NULL, :modelId, 1, NOW(), NOW(), NOW()) RETURNING id`,
            { modelId: made.modelId }
        );

        try {
            const res = await global.api.get(`/api/v2/training_run/${bare.id}/samples`);

            expect(res.status).toBe(200);
            expect(res.body.samples).toEqual([]);
            expect(res.body.matched).toBe(0);
        } finally {
            await db.sequelize.query('DELETE FROM training_runs WHERE id = :id', {
                replacements: { id: bare.id }, logging: false,
            });
        }
    });

    /**
     * **A mistyped id and a silent run are different answers**, and a chart cannot tell
     * them apart from an empty array.
     */
    it('is a 404 for a run that does not exist', async () => {
        const res = await global.api.get('/api/v2/training_run/2000000000/samples');

        expect(res.status).toBe(404);
    });
});

describe('A retried run', () => {

    /**
     * **A second attempt restarts the step counter**, so a series that merged the two
     * would show the chart jumping backwards, and one that dropped the earlier attempt
     * would lose the part of the run that failed -- which is usually the interesting part.
     */
    it('is two series with a seam, not one that jumps backwards', async () => {
        await post(made.attemptIds[1], 2, [sampleEvent(0, 1, { 'train/loss': 0.9 })]);

        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/samples`);

        expect(res.status).toBe(200);

        const attempts = [...new Set(res.body.samples.map((sample) => sample.attempt_id))];

        expect(attempts).toEqual(made.attemptIds);

        /* Step 1 exists twice, once per attempt, and each says which. Without
           `attempt_id` the two would be indistinguishable and the chart would be wrong
           in a way nothing could detect. */
        const firstSteps = res.body.samples.filter((sample) => sample.step === 1);

        expect(firstSteps.length).toBeGreaterThanOrEqual(2);
        expect(new Set(firstSteps.map((sample) => sample.attempt_id)).size).toBe(2);
    });

    /**
     * **`after_step` is applied per attempt**, because the counters are per attempt. A
     * filter applied across the whole series would hide a retry's early samples behind
     * the first attempt's higher numbers, which is exactly when a reader wants them.
     */
    it('is not hidden behind the first attempt\'s higher step numbers', async () => {
        await post(made.attemptIds[1], 2, [sampleEvent(1, 2, { 'train/loss': 0.8 })]);

        const res = await global.api
            .get(`/api/v2/training_run/${made.trainingRunId}/samples`)
            .query({ after_step: 1 });

        const second = res.body.samples.filter((sample) => sample.attempt_id === made.attemptIds[1]);

        expect(second.length).toBeGreaterThan(0);
    });
});

describe('A run with more samples than a chart can draw', () => {
    let many;

    beforeAll(async () => {
        /* 500 samples against a cap of 20, which is enough to stride hard without
           making the suite slow. Inserted directly: what is under test is the read. */
        const values = [];
        const replacements = { attemptId: made.attemptIds[0] };

        for (let at = 0; at < 500; at += 1) {
            const step = 1000 + at;

            /* **Each row carries its own seq**, because a sample is keyed by the event it
               was projected from. Numbered from 5000 so they cannot collide with the seqs
               the posted events above used on this attempt. */
            values.push(`(:attemptId, ${5000 + at}, ${step}, 'training_batch', 2, ${at}, 500, NOW(), '{"train/loss": ${1 - (at / 1000)}}'::jsonb, NOW())`);
        }

        await db.sequelize.query(
            `INSERT INTO training_batch_samples
                 (attempt_id, seq, step, phase, epoch, batch, batches_total, at, metrics, created_at)
             VALUES ${values.join(', ')}`,
            { replacements, logging: false }
        );

        many = await global.api
            .get(`/api/v2/training_run/${made.trainingRunId}/samples`)
            .query({ after_step: 999, limit: 20 });
    });

    afterAll(async () => {
        await db.sequelize.query(
            'DELETE FROM training_batch_samples WHERE attempt_id = :id AND step >= 1000',
            { replacements: { id: made.attemptIds[0] }, logging: false }
        );
    });

    it('thins the series rather than cutting it off', () => {
        expect(many.status).toBe(200);
        expect(many.body.matched).toBe(500);
        expect(many.body.strided).toBe(true);

        /* At most the cap, plus the always-included final sample. */
        expect(many.body.returned).toBeLessThanOrEqual(21);
        expect(many.body.returned).toBeGreaterThan(1);
    });

    /**
     * **Truncating either end would be a lie about the run.** Taking the first n shows a
     * beginning and claims it is the whole; taking the last n silently drops the start.
     * Striding keeps the shape, which is the thing being read.
     */
    it('spans the whole range rather than one end of it', () => {
        const steps = many.body.samples.map((sample) => sample.step);

        expect(Math.min(...steps)).toBe(1000);
        expect(Math.max(...steps)).toBe(1499);
    });

    /**
     * **The newest sample is always there.** A chart whose last point is forty samples
     * behind the run looks stalled, which is the opposite of what a live view is for.
     */
    it('always includes the most recent sample', () => {
        const last = many.body.samples[many.body.samples.length - 1];

        expect(last.step).toBe(1499);
    });

    /** And a caller can tell a thinned series from a complete one. */
    it('says plainly that it thinned', () => {
        expect(many.body.strided).toBe(true);
        expect(many.body.returned).toBeLessThan(many.body.matched);
    });
});
