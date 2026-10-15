/**
 * The GPU reading that is worth having, and the two series drawn from it (#104).
 *
 * MARP has stored GPU telemetry since the orchestrator was built, and it has been useless
 * for the one thing anybody wants it for. The worker reports NVML on every poll, and the
 * coordinator keeps that reading against the attempt the poll opens -- the instant *before*
 * the machine starts. Measured over this database's own history: 6,789 attempts carry a
 * real reading, and on the days that ran two thousand jobs their average GPU utilization is
 * half a percent. A chart drawn from those numbers shows a farm that is permanently idle.
 *
 * So the reading now comes from the heartbeat, which is the only thing that happens while
 * work runs. These tests cover that it arrives, that it is kept at one row per machine per
 * minute rather than one per heartbeat, that the pool view prefers it over the poll's
 * snapshot and says which it gave you, and that the two series read back.
 *
 * Over HTTP, because the heartbeat is a worker-facing route and the thing that could be
 * wrong is the body it accepts.
 *
 * @fileoverview Route tests for heartbeat telemetry and the chart series.
 * @author Isaac Travers
 * @module tests/gpu-telemetry-series
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run. @type {string} */
const marker = `telemetry-series-${Date.now()}`;

/** @type {Array<number>} */
const createdJobIds = [];

/** @type {Array<number>} */
const createdWorkerIds = [];

/** @type {{workerId: number, attemptId: number, leaseEpoch: number}} */
let lease;

/**
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * One GPU reading, in the worker's own field names.
 *
 * @param {number} utilization - `gpu_utilization_percent`.
 * @returns {Object} A `telemetry` body.
 */
const reading = (utilization) => ({
    devices: [{
        device_index: 0,
        name: 'NVIDIA GeForce RTX 4080 SUPER',
        gpu_utilization_percent: utilization,
        memory_utilization_percent: 61,
        memory_used_bytes: 14763950080,
        memory_total_bytes: 17171480576,
        memory_percent_used: 86,
        temperature_c: 71,
        power_usage_watts: 312.4,
        power_limit_watts: 320,
    }],
});

beforeAll(async () => {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, state, slot_count, enrolled_at, last_seen_at)
         VALUES (:localId, :name, 'online', 1, NOW(), NOW()) RETURNING id`,
        { localId: `${marker}-local`, name: `${marker}-worker` }
    );

    createdWorkerIds.push(worker.id);

    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, priority, attempts_made, max_attempts, created_at, updated_at)
         VALUES ('inference', :spec, 'leased', 0, 1, 3, NOW(), NOW()) RETURNING id`,
        { spec: JSON.stringify({ engine: 'test', video: { source_name: marker }, range: { start_frame: 0, end_frame: 10 } }) }
    );

    createdJobIds.push(job.id);

    const [attempt] = await query(
        `INSERT INTO gpu_job_attempts
                (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at)
         VALUES (:jobId, :workerId, 0, 1, 'running', NOW(), NOW() + INTERVAL '1 hour')
         RETURNING id`,
        { jobId: job.id, workerId: worker.id }
    );

    lease = { workerId: worker.id, attemptId: attempt.id, leaseEpoch: 1 };
});

afterAll(async () => {
    if (createdWorkerIds.length) {
        await db.sequelize.query('DELETE FROM gpu_worker_samples WHERE worker_id IN (:ids)', {
            replacements: { ids: createdWorkerIds },
        });
    }

    if (createdJobIds.length) {
        await db.sequelize.query(
            `DELETE FROM gpu_job_events
              WHERE attempt_id IN (SELECT id FROM gpu_job_attempts WHERE job_id IN (:ids))`,
            { replacements: { ids: createdJobIds } }
        );
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', {
            replacements: { ids: createdJobIds },
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: createdJobIds },
        });
    }

    if (createdWorkerIds.length) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id IN (:ids)', {
            replacements: { ids: createdWorkerIds },
        });
    }
});

/**
 * Send one heartbeat.
 *
 * @param {?Object} telemetry - The reading, or null to omit the field entirely.
 * @returns {Promise<Object>} The supertest response.
 */
function heartbeat(telemetry) {
    const body = {
        worker_id: lease.workerId,
        lease_epoch: lease.leaseEpoch,
        state: 'running',
        progress: { done: 1, total: 10, unit: 'frames' },
    };

    if (telemetry !== null) body.telemetry = telemetry;

    return global.api.post(`/api/v2/gpu/attempts/${lease.attemptId}/heartbeat`).send(body);
}

describe('a heartbeat may carry the machine\'s GPU reading', () => {
    test('a heartbeat without telemetry is accepted, as it always was', async () => {
        const response = await heartbeat(null);

        expect(response.status).toBeLessThan(400);

        const samples = await query(
            'SELECT count(*)::int AS n FROM gpu_worker_samples WHERE worker_id = :id',
            { id: lease.workerId }
        );

        /* An older worker that has never heard of this field must not be
           turned away, and must not leave a row behind either. */
        expect(samples[0].n).toBe(0);
    });

    test('a heartbeat with telemetry records a reading', async () => {
        const response = await heartbeat(reading(91));

        expect(response.status).toBeLessThan(400);

        const [sample] = await query(
            'SELECT worker_id, attempt_id, devices FROM gpu_worker_samples WHERE worker_id = :id',
            { id: lease.workerId }
        );

        expect(sample.worker_id).toBe(lease.workerId);
        expect(sample.attempt_id).toBe(lease.attemptId);
        expect(sample.devices[0].gpu_utilization_percent).toBe(91);

        /* The worker's own names, stored as they arrived. */
        expect(sample.devices[0].power_usage_watts).toBe(312.4);
    });

    test('ten heartbeats in a minute leave one row, not ten', async () => {
        for (const utilization of [10, 20, 30, 40, 99]) {
            await heartbeat(reading(utilization));
        }

        const rows = await query(
            'SELECT devices FROM gpu_worker_samples WHERE worker_id = :id',
            { id: lease.workerId }
        );

        /* The rate limit is the unique index on (worker_id, minute), not
           something a caller has to remember. A heartbeat every ten seconds
           would otherwise be six rows a minute per busy machine. */
        expect(rows).toHaveLength(1);

        // And the last one in the minute is the one that stays.
        expect(rows[0].devices[0].gpu_utilization_percent).toBe(99);
    });

    test('telemetry that is not shaped like a reading is a 400', async () => {
        const response = await heartbeat({ devices: 'all of them' });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/devices must be an array/);
    });

    test('a device missing a field is still accepted', async () => {
        /* Lenient on purpose. A passive card reports no fan speed and a laptop
           GPU no power draw; refusing those would cost a running job its lease
           over a number nobody was going to draw. */
        const response = await heartbeat({ devices: [{ device_index: 0, gpu_utilization_percent: 50 }] });

        expect(response.status).toBeLessThan(400);
    });
});

describe('the pool view prefers the live reading', () => {
    test('it serves the heartbeat\'s reading and says it is live', async () => {
        const response = await global.api.get('/api/v2/gpu/workers');
        const worker = response.body.find((entry) => entry.worker_id === lease.workerId);

        expect(worker.attempts).toHaveLength(1);

        const { telemetry } = worker.attempts[0];

        expect(telemetry.live).toBe(true);
        expect(telemetry.gpus[0].gpu_utilization_percent).toBe(50);

        /* The distinction the screen has to draw. A lease-time snapshot and a
           reading from ten seconds ago are both "telemetry" and mean quite
           different things. */
        expect(telemetry.as_of).toBeTruthy();
    });
});

describe('the series read back', () => {
    test('utilization comes back bucketed, with an average and a maximum', async () => {
        const response = await global.api
            .get('/api/v2/gpu/telemetry/series')
            .query({ bucket: 'minute' });

        expect(response.status).toBe(200);
        expect(response.body.bucket).toBe('minute');

        const mine = response.body.points.filter((point) => point.machines > 0);

        expect(mine.length).toBeGreaterThan(0);
        expect(typeof mine[0].avg_utilization_percent).toBe('number');
        expect(typeof mine[0].max_utilization_percent).toBe('number');
    });

    test('throughput answers without anything having been sampled', async () => {
        const response = await global.api
            .get('/api/v2/gpu/jobs/series')
            .query({ bucket: 'day' });

        expect(response.status).toBe(200);
        expect(response.body.points.length).toBeGreaterThan(0);

        /* Derived from gpu_jobs alone, which is the point: this needed no new
           recording, only the `finished_at` column gap 24 added. */
        for (const point of response.body.points) {
            expect(typeof point.finished).toBe('number');
            expect(typeof point.waiting).toBe('number');
        }
    });

    test('a backwards window is a 400', async () => {
        const response = await global.api.get('/api/v2/gpu/jobs/series').query({
            since: '2026-10-15T00:00:00Z',
            until: '2026-10-14T00:00:00Z',
        });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/since must be before until/);
    });

    test('an unknown bucket is a 400, because it reaches the statement', async () => {
        const response = await global.api
            .get('/api/v2/gpu/telemetry/series')
            .query({ bucket: 'fortnight' });

        /* `date_trunc` takes a literal, so this value is interpolated rather
           than bound. The whitelist is what keeps that safe, and this is the
           test that says the whitelist is still there. */
        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/bucket must be one of/);
    });

    test('a bucket that is a SQL injection attempt is refused, not executed', async () => {
        const response = await global.api
            .get('/api/v2/gpu/telemetry/series')
            .query({ bucket: "hour'); DROP TABLE gpu_worker_samples; --" });

        expect(response.status).toBe(400);

        const [table] = await query(
            "SELECT to_regclass('public.gpu_worker_samples') IS NOT NULL AS present"
        );

        expect(table.present).toBe(true);
    });
});
