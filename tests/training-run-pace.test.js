/**
 * The per-epoch metrics a training run records, and the pace behind them.
 *
 * **Two defects and one gap, found by reading what run 203 had actually stored.**
 *
 * The defects: `epochs` has seven metric columns and the ingest wrote two. `map50` and
 * `map5095` were never mapped at all, and the three losses were looked up as
 * `train/box_loss` and friends while the worker sends `val/`. So every epoch row MARP had
 * ever written carried a precision, a recall and five nulls — while the values sat in the
 * `gpu_job_events` row the ingest keeps "so nothing it was not expecting is lost". That
 * comment was written about metrics nobody had columns for and turned out to be insurance
 * against this.
 *
 * The gap: nothing served `gpu_attempt_progress` for one run, so a screen could draw what
 * each epoch measured but not how fast they were arriving — and not that a run was alive
 * at all during the minutes before epoch 1, while the dataset downloads.
 *
 * **Seeded, never read off a live run.** Run 203 was in flight while this was written and
 * its worker is the old build, so its losses are null for a reason that has nothing to do
 * with the code under test. Everything here is inserted by the test and removed again.
 *
 * @fileoverview Endpoint tests for a training run's epochs and pace.
 * @author Isaac Travers
 * @module tests/training-run-pace
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const { epochMetrics } = require('../db/epoch-metrics');
const { wasMisMapped } = require('../scripts/backfill-epoch-metrics');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { jobId: null, attemptId: null, workerId: null, trainingRunId: null, modelId: null };

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

beforeAll(async () => {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, slot_count, worker_version, capabilities, state, enrolled_at, last_seen_at)
         VALUES (:localId, :name, 1, '0.0.1-jest', '{}'::jsonb, 'online', NOW(), NOW())
         RETURNING id`,
        { localId: `jest-pace-${runId}`, name: `jest-pace-worker-${runId}` }
    );

    made.workerId = worker.id;

    const [model] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, NOW(), NOW())
         RETURNING id`,
        { name: `jest-pace-model-${runId}` }
    );

    made.modelId = model.id;

    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
         VALUES ('training', :spec, 'leased', 1, 1)
         RETURNING id`,
        { spec: JSON.stringify({ jest: `training-run-pace-${runId}` }) }
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
         VALUES (:jobId, :modelId, 10, NOW(), NOW(), NOW())
         RETURNING id`,
        { jobId: job.id, modelId: made.modelId }
    );

    made.trainingRunId = run.id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.trainingRunId) {
        await drop('DELETE FROM epochs WHERE training_run_id = :id', { id: made.trainingRunId });
        await drop('DELETE FROM training_runs WHERE id = :id', { id: made.trainingRunId });
    }
    if (made.attemptId) {
        await drop('DELETE FROM gpu_attempt_progress WHERE attempt_id = :id', { id: made.attemptId });
        await drop('DELETE FROM gpu_job_attempts WHERE id = :id', { id: made.attemptId });
    }
    if (made.jobId) await drop('DELETE FROM gpu_jobs WHERE id = :id', { id: made.jobId });
    if (made.workerId) await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
    if (made.modelId) await drop('DELETE FROM ml_models WHERE id = :id', { id: made.modelId });
});

/**
 * The mapping is the contract, and it is the thing that was wrong.
 *
 * A pure test, because the names are the defect: five columns were empty for months
 * because two were never looked up and three were looked up under the wrong prefix.
 */
describe('The metric names an epoch is read from', () => {

    /**
     * A payload as the worker sends one.
     *
     * The `metrics/` and `val/` keys are copied from a real event on the development
     * database. The `train/` ones and `duration_seconds` are from the worker contract
     * for `268-training-params-and-provenance`, which is built and not yet installed —
     * so this is the one part of the fixture that is read from a document rather than
     * from traffic, and it is the part to re-check against a real event once that
     * build is on the GPU.
     */
    const PAYLOAD = {
        'val/box_loss': 1.36701,
        'val/cls_loss': 1.51008,
        'val/dfl_loss': 0.81572,
        'train/box_loss': 1.25,
        'train/cls_loss': 0.8,
        'train/dfl_loss': 0.95,
        'duration_seconds': 27.123,
        'start_offset_s': 12.5,
        'end_offset_s': 39.623,
        'metrics/mAP50(B)': 0.67946,
        'metrics/recall(B)': 0.69565,
        'metrics/mAP50-95(B)': 0.41664,
        'metrics/precision(B)': 0.70568,
    };

    it('fills every column the table has, from what the worker actually sends', () => {
        expect(epochMetrics(PAYLOAD)).toEqual({
            precision: 0.70568,
            recall: 0.69565,
            map50: 0.67946,
            map5095: 0.41664,
            box_loss: 1.36701,
            cls_loss: 1.51008,
            dfl_loss: 0.81572,
            train_box_loss: 1.25,
            train_cls_loss: 0.8,
            train_dfl_loss: 0.95,
            duration_seconds: 27.123,
            start_offset_s: 12.5,
            end_offset_s: 39.623,

            /* **A detection payload leaves the classification columns null**, and that is
               the assertion rather than an omission: null here means this task does not
               report that quantity. A detector has no single total loss and no accuracy,
               and summing or deriving one would be arithmetic dressed as a measurement. */
            loss: null,
            train_loss: null,
            accuracy_top1: null,
            accuracy_top5: null,
        });
    });

    /**
     * **The offsets are elapsed seconds, not instants, and that is Isaac's decision:**
     * *"Treat start_time and end_time as ordering and duration only — valid within a
     * run, never compared across machines."* A volunteer box with a drifting clock
     * cannot put a wrong wall-clock time into the record this way.
     *
     * **The exactness is the worker's and cannot be re-asserted here**, which is worth
     * knowing rather than assuming. The trainer computes end - start == duration in its
     * own floats; MARP receives three decimals and subtracting two of them reintroduces
     * representation error -- 39.623 - 12.5 is 27.122999999999998, not 27.123. So what
     * this checks is that the three survive the mapping together and still agree to
     * within floating point, not that MARP can verify an exact equality it never saw.
     */
    it('keeps the interval as long as the duration says', () => {
        const read = epochMetrics(PAYLOAD);

        expect(read.end_offset_s - read.start_offset_s).toBeCloseTo(read.duration_seconds, 9);
    });

    /**
     * **Half an interval is not a measurement.** The worker omits the two together,
     * so one arriving alone means something was lost on the way rather than that
     * half of it was measured — and a start with no end reads as an epoch that never
     * finished, which is a claim rather than a gap.
     */
    it('drops a lone offset rather than storing half an interval', () => {
        expect(epochMetrics({ start_offset_s: 12.5 })).toMatchObject({
            start_offset_s: null,
            end_offset_s: null,
        });

        expect(epochMetrics({ end_offset_s: 39.6 })).toMatchObject({
            start_offset_s: null,
            end_offset_s: null,
        });
    });

    /**
     * **The first epoch starts at zero, and zero is a measurement.**
     *
     * Every run has exactly one of these, and it is not an edge case: Ultralytics
     * sets the origin at `_do_train` entry, after setup has built the dataloaders and
     * the optimizer, so epoch 1 begins at roughly 0.000 however long setup took.
     * Setup time is the gap between the attempt's first event and the
     * `on_train_start` report, and is deliberately not inside these numbers.
     *
     * So this is the `Number(null)` trap from the other direction: a guard treating
     * falsy as absent would throw away the one offset certain to occur in every run,
     * and the pair rule would then discard its end as well — leaving the first epoch
     * of every run with no position in it.
     */
    it('keeps an offset of zero, which every run has exactly one of', () => {
        const first = epochMetrics({ start_offset_s: 0, end_offset_s: 27.123 });

        expect(first.start_offset_s).toBe(0);
        expect(first.end_offset_s).toBe(27.123);
    });

    /**
     * **The two loss series are two facts and neither stands in for the other.** The
     * gap between them is the overfitting signal, so a reader has to be able to tell
     * a training loss of 1.25 from a validation loss of 1.37 — which is only possible
     * if they land in different columns.
     */
    it('keeps the training and validation losses apart', () => {
        const read = epochMetrics(PAYLOAD);

        expect(read.box_loss).toBe(1.36701);
        expect(read.train_box_loss).toBe(1.25);

        // And a payload with only one of the two leaves the other unmeasured.
        expect(epochMetrics({ 'val/box_loss': 1.1 }).train_box_loss).toBeNull();
        expect(epochMetrics({ 'train/box_loss': 9.9 }).box_loss).toBeNull();
    });

    /**
     * **Zero is a measurement; absent is not.** `tloss` is None through a NaN-recovery
     * epoch and `epoch_time` is unset before the first one finishes, so an absent key
     * means the number did not exist — but a loss that really was zero is sent as zero
     * and has to survive. The worker has a named test on each side of this, and so
     * does MARP, because the conversion is where the two look alike.
     */
    it('tells a loss of zero from a loss that was not reported', () => {
        const measured = epochMetrics({ 'train/cls_loss': 0, 'duration_seconds': 0 });

        expect(measured.train_cls_loss).toBe(0);
        expect(measured.duration_seconds).toBe(0);

        const absent = epochMetrics({});

        expect(absent.train_cls_loss).toBeNull();
        expect(absent.duration_seconds).toBeNull();
    });

    /**
     * **`train/` is not accepted, deliberately.** Ultralytics reports training and
     * validation losses as separate series and the worker sends the validation set. One
     * column holding training loss on some rows and validation loss on others could not
     * be read at all, so the gap between them needs its own columns rather than a shared
     * one — which is a decision for Isaac, not something to paper over here.
     */
    it('does not take a training loss as though it were the validation one', () => {
        const read = epochMetrics({ 'train/box_loss': 9.9, 'val/box_loss': 1.1 });

        expect(read.box_loss).toBe(1.1);

        expect(epochMetrics({ 'train/box_loss': 9.9 }).box_loss).toBeNull();
    });

    /** A metric Ultralytics reports as `nan` is not a measurement of zero. */
    it('reads anything that is not a finite number as not measured', () => {
        const read = epochMetrics({ 'metrics/mAP50(B)': 'nan', 'metrics/recall(B)': null });

        expect(read.map50).toBeNull();
        expect(read.recall).toBeNull();
    });
});

/**
 * The rule that decides whether a recorded epoch gets overwritten.
 *
 * **A row written by the old mapping is not missing a value, it holds the wrong one**, so
 * the fill path refuses it and a repair has to be able to say which rows are wrong. The
 * API process that served the old mapping for five days after it was fixed on disk wrote
 * ten such rows: train losses sitting in the validation columns.
 *
 * **The discriminator is what the column holds, not what is missing.** A mis-mapped row
 * carries exactly what the previous mapping produced. That is sharper than "the train
 * columns are null", which only says a row is incomplete -- and it is why a row matching
 * neither mapping is reported rather than rewritten on a guess.
 *
 * This is the one rule in the repair that can destroy a measurement, which is why it is
 * tested apart from the script that runs it.
 */
describe('Deciding whether an epoch row came from the old mapping', () => {
    const VAL = 1.56838;
    const TRAIN = 2.01598;

    it('recognises a row holding the training loss in the validation column', () => {
        expect(wasMisMapped(TRAIN, VAL, TRAIN)).toBe(true);
    });

    it('leaves a correctly mapped row alone', () => {
        expect(wasMisMapped(VAL, VAL, TRAIN)).toBe(false);
    });

    /* An empty column is the fill path's business, not the repair's. */
    it('says nothing about a column that is simply empty', () => {
        expect(wasMisMapped(null, VAL, TRAIN)).toBe(false);
        expect(wasMisMapped(undefined, VAL, TRAIN)).toBe(false);
    });

    /**
     * **The important refusal.** A value matching neither mapping got there some way this
     * does not model -- a hand edit, a third mapping, a different worker. Overwriting it
     * would destroy the only evidence of whatever happened.
     */
    it('refuses a value that matches neither mapping', () => {
        expect(wasMisMapped(9.9, VAL, TRAIN)).toBe(false);
    });

    /* An event with no train loss cannot have produced a mis-mapped row, so there is
       nothing to recognise and nothing to rewrite. */
    it('refuses when the event carries no previous value to compare against', () => {
        expect(wasMisMapped(TRAIN, VAL, undefined)).toBe(false);
    });
});

/**
 * Every column the table holds reaches the endpoint that serves it.
 *
 * **A column can exist, be written, hold the right value, and still be invisible.** The
 * training losses were added by migration, written by the ingest in raw SQL, verified in
 * the database and repaired on an earlier run — and `GET /training_run/:id/epochs`
 * returned them nowhere, because `getEpochsForRun` is a Sequelize `findAll` and the model
 * never declared them. Not null in the response: **absent**. So the dashboard drew its
 * empty state, correctly, over data that was sitting right there.
 *
 * The migration is not the contract; the model is what the read can see. This test is the
 * one that would have caught it, and it asserts presence rather than value — a null is a
 * fine answer, an absent key is not.
 */
describe('The columns GET /api/v2/training_run/:id/epochs serves', () => {
    let epochId;

    beforeAll(async () => {
        const [epoch] = await query(
            `INSERT INTO epochs (training_run_id, epoch_number, precision, recall,
                                 map50, map5095, box_loss, cls_loss, dfl_loss,
                                 train_box_loss, train_cls_loss, train_dfl_loss,
                                 duration_seconds, start_offset_s, end_offset_s,
                                 timestamp, created_at, updated_at)
             VALUES (:runId, 1, 0.7, 0.69, 0.68, 0.42,
                     1.36, 1.51, 0.81, 0.98, 0.43, 0.78,
                     27.123, 12.5, 39.623, NOW(), NOW(), NOW())
             RETURNING id`,
            { runId: made.trainingRunId }
        );

        epochId = epoch.id;
    });

    afterAll(async () => {
        if (epochId) {
            await db.sequelize.query('DELETE FROM epochs WHERE id = :id', {
                replacements: { id: epochId }, logging: false,
            });
        }
    });

    it('includes both loss series, so the overfitting gap can be drawn', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/epochs`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);

        const epoch = res.body[0];

        /* The validation set, which has always come through. */
        expect(epoch.box_loss).toBeCloseTo(1.36);

        /* And the training set, which did not — the whole point of the columns. */
        expect(epoch.train_box_loss).toBeCloseTo(0.98);
        expect(epoch.train_cls_loss).toBeCloseTo(0.43);
        expect(epoch.train_dfl_loss).toBeCloseTo(0.78);
    });

    /**
     * **Present, not merely non-null.** The failure was an absent key, which reads as
     * "this MARP does not have the column" rather than "this epoch has no value" — so a
     * chart cannot tell a gap in the data from a gap in the API. `toHaveProperty` is the
     * assertion that distinguishes them; `toBeNull` would pass on neither.
     */
    it('names every column it holds, even where the value is null', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/epochs`);
        const epoch = res.body[0];

        for (const column of [
            'train_box_loss', 'train_cls_loss', 'train_dfl_loss',
            'start_offset_s', 'end_offset_s', 'duration_seconds',
            'map50', 'map5095', 'precision', 'recall',
            'box_loss', 'cls_loss', 'dfl_loss', 'start_time', 'end_time',
        ]) {
            expect(epoch).toHaveProperty(column);
        }

        /* The two that stay null until a worker sends them, which is a value rather
           than an omission. */
        expect(epoch.start_time).toBeNull();
        expect(epoch.end_time).toBeNull();
    });

    it('carries the offsets, for when a build that sends them lands', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/epochs`);
        const epoch = res.body[0];

        expect(epoch.start_offset_s).toBeCloseTo(12.5);
        expect(epoch.end_offset_s).toBeCloseTo(39.623);
    });
});

/**
 * The best mAP a training job reached, on the list that shows it.
 *
 * **Derived on read, and only when the caller asked for training jobs.** The Training
 * screen shows the column; the Jobs screen does not, and all but eight of the 9,574 jobs
 * on the development database are inference. Measured over a page of fifty: the lateral
 * costs +22ms unfiltered and +0.2ms filtered, so it is left out of the statement
 * entirely when nothing will read it.
 *
 * **Not stored, which is the opposite of the call made for dataset image counts and
 * model checksums.** Those are expensive and immutable. This is an aggregate over tens of
 * indexed rows, and epochs change — ten were rewritten repairing a mis-mapped run, and a
 * stored best would have gone stale at that moment with nothing to say so.
 */
describe('Best mAP on the training job list', () => {
    let epochIds = [];

    beforeAll(async () => {
        /* Three epochs with the best in the middle, so a query taking the first or the
           last one passes by luck and this does not. */
        for (const [number, map50] of [[1, 0.41], [2, 0.68], [3, 0.52]]) {
            const [epoch] = await query(
                `INSERT INTO epochs (training_run_id, epoch_number, map50, timestamp, created_at, updated_at)
                 VALUES (:runId, :number, :map50, NOW(), NOW(), NOW())
                 RETURNING id`,
                { runId: made.trainingRunId, number, map50 }
            );

            epochIds.push(epoch.id);
        }
    });

    afterAll(async () => {
        for (const id of epochIds) {
            await db.sequelize.query('DELETE FROM epochs WHERE id = :id', {
                replacements: { id }, logging: false,
            });
        }

        epochIds = [];
    });

    it('is the best epoch of the run, not the first or the last', async () => {
        const res = await global.api.get('/api/v2/gpu/jobs').query({ kind: 'training', limit: 200 });

        expect(res.status).toBe(200);

        const mine = res.body.jobs.find((job) => job.id === made.jobId);

        expect(mine).toBeTruthy();
        expect(Number(mine.best_map50)).toBeCloseTo(0.68);
    });

    /**
     * **Absent, not null, and the difference is load-bearing.** Null means this training
     * job reached no epoch; absent means this response shape does not carry the field.
     * Selecting NULL for it when unfiltered would collapse those into one value and
     * quietly answer "no mAP" for every inference job on the Jobs screen.
     */
    it('is not in an unfiltered page at all', async () => {
        const res = await global.api.get('/api/v2/gpu/jobs').query({ limit: 5 });

        expect(res.status).toBe(200);
        expect(res.body.jobs.length).toBeGreaterThan(0);

        for (const job of res.body.jobs) {
            expect(job).not.toHaveProperty('best_map50');
        }
    });
});

describe('GET /api/v2/training_run/:id/pace', () => {

    it('answers 404 for a run that does not exist', async () => {
        const res = await global.api.get('/api/v2/training_run/2147483600/pace');

        expect(res.status).toBe(404);
    });

    /**
     * **Empty, not 404.** A run whose attempt has not sent a heartbeat yet exists and has
     * reported nothing, and a screen watching one would otherwise treat the normal first
     * few seconds as an error.
     */
    it('answers an empty array for a run that has reported no heartbeat', async () => {
        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/pace`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('returns the samples oldest first, as numbers rather than strings', async () => {
        /* Out of order on purpose, so an endpoint that returned insert order fails. The
           counts cross ten so a lexical sort would put 10 before 2. */
        for (const [minutes, done] of [[3, 10], [1, 2], [2, 9]]) {
            await db.sequelize.query(
                `INSERT INTO gpu_attempt_progress (attempt_id, at, progress_done, progress_total, progress_unit, job_kind)
                 VALUES (:attemptId, NOW() + (:minutes || ' minutes')::interval, :done, 10, 'epochs', 'training')`,
                { replacements: { attemptId: made.attemptId, minutes, done }, logging: false }
            );
        }

        const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/pace`);

        expect(res.status).toBe(200);
        expect(res.body.map((row) => row.done)).toEqual([2, 9, 10]);

        /* `progress_done` is BIGINT, which the driver hands back as a string -- a chart
           plotting those gets a lexical axis where 10 sorts before 2. */
        expect(typeof res.body[0].done).toBe('number');
        expect(typeof res.body[0].total).toBe('number');
        expect(res.body[0].unit).toBe('epochs');
        expect(res.body[0].attempt_id).toBe(made.attemptId);
    });

    /**
     * A retried job has a second attempt counting from zero again. Dropping it would
     * leave a step down in the series that nothing explains, so both are returned and
     * each sample says which attempt it came from.
     */
    it('carries every attempt of the job, saying which', async () => {
        const [second] = await query(
            `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
             VALUES (:jobId, :workerId, 0, 2, 'running', NOW() + INTERVAL '1 hour')
             RETURNING id`,
            { jobId: made.jobId, workerId: made.workerId }
        );

        try {
            await db.sequelize.query(
                `INSERT INTO gpu_attempt_progress (attempt_id, at, progress_done, progress_total, progress_unit, job_kind)
                 VALUES (:attemptId, NOW() + INTERVAL '4 minutes', 1, 10, 'epochs', 'training')`,
                { replacements: { attemptId: second.id }, logging: false }
            );

            const res = await global.api.get(`/api/v2/training_run/${made.trainingRunId}/pace`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(4);

            const last = res.body[res.body.length - 1];

            expect(last.attempt_id).toBe(second.id);
            expect(last.done).toBe(1);
        } finally {
            await db.sequelize.query('DELETE FROM gpu_attempt_progress WHERE attempt_id = :id', {
                replacements: { id: second.id }, logging: false,
            });
            await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE id = :id', {
                replacements: { id: second.id }, logging: false,
            });
        }
    });

    it('refuses a request carrying no principal', async () => {
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get(`/api/v2/training_run/${made.trainingRunId}/pace`);

        expect(res.status).toBe(401);
    });
});
