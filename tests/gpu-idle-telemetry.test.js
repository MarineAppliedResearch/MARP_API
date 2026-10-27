/**
 * The GPU reading a polling worker sends, kept whether or not it got work.
 *
 * **The readings were already arriving and being thrown away.** Every poll carries
 * `capabilities`, and MARP read them only when a lease was granted, as the attempt's
 * `capabilities_snapshot`. A poll that got nothing — which is most polls, most of the
 * time — discarded a perfectly good reading of an idle machine. So `gpu_worker_samples`
 * held only the minutes a worker happened to be holding a lease: 48 rows across three
 * days on the development database, and both activity charts drew nothing for a pool that
 * was sitting there reporting itself.
 *
 * Nothing new is plumbed from the worker for this. The same field, written down.
 *
 * **The hazard this file exists for is the overwrite.** One row per machine per minute is
 * the schema's rule, so a worker that heartbeats mid-job and polls for its next one
 * inside the same minute writes twice to the same row — and the idle write does not know
 * what was running. Letting it win would turn attributed training compute into
 * unattributed idle, which is a worse number than no number: the chart would show
 * training utilisation dropping for a reason that never happened.
 *
 * @fileoverview Endpoint tests for sampling an idle worker's telemetry.
 * @author Isaac Travers
 * @module tests/gpu-idle-telemetry
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { workerId: null, jobId: null, attemptId: null };

/** One GPU reading, shaped as the worker's snapshot holds them. */
const device = (utilisation) => ({
    name: 'NVIDIA GeForce RTX 4080 SUPER',
    uuid: `GPU-jest-${runId}`,
    device_index: 0,
    temperature_c: 40,
    memory_total_bytes: 17171480576,
    memory_percent_used: 12.5,
    power_usage_watts: 30,
    gpu_utilization_percent: utilisation,
});

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
 * This worker's samples for the current minute.
 *
 * @returns {Promise<Array<Object>>} `{attempt_id, job_kind, devices}`.
 */
function samples() {
    return query(
        `SELECT attempt_id, job_kind, devices
           FROM gpu_worker_samples
          WHERE worker_id = :workerId
          ORDER BY at`,
        { workerId: made.workerId }
    );
}

beforeAll(async () => {
    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-idle-local-${runId}`,
            name: `jest-idle-worker-${runId}`,
            slot_count: 1,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [], engines: ['marp_training'] },
        });

    made.workerId = enrolled.body.worker_id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.workerId) {
        await drop('DELETE FROM gpu_worker_samples WHERE worker_id = :id', { id: made.workerId });
    }
    if (made.attemptId) {
        await drop('DELETE FROM gpu_job_attempts WHERE id = :id', { id: made.attemptId });
    }
    if (made.jobId) await drop('DELETE FROM gpu_jobs WHERE id = :id', { id: made.jobId });
    if (made.workerId) await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
});

describe('A worker that polls and is given nothing', () => {

    it('still leaves its GPU reading behind', async () => {
        const res = await global.api
            .post('/api/v2/gpu/poll')
            .send({
                worker_id: made.workerId,
                wait_seconds: 0,
                capabilities: { resources: { nvidia: { devices: [device(3)] } } },
            });

        /* **204, which is the case that used to record nothing at all.** The route
           answers no-content rather than an empty body so a worker tells "no work" from
           "work" by status -- and that is the answer for most polls, most of the time. */
        expect(res.status).toBe(204);

        const kept = await samples();

        expect(kept).toHaveLength(1);
        expect(kept[0].devices[0].gpu_utilization_percent).toBe(3);

        /* Null on both, deliberately: this machine is not working, and the charts filter
           on exactly that to tell training compute from inference compute from neither. */
        expect(kept[0].attempt_id).toBeNull();
        expect(kept[0].job_kind).toBeNull();
    });

    it('leaves one row a minute however often it polls', async () => {
        for (const utilisation of [5, 7]) {
            await global.api
                .post('/api/v2/gpu/poll')
                .send({
                    worker_id: made.workerId,
                    wait_seconds: 0,
                    capabilities: { resources: { nvidia: { devices: [device(utilisation)] } } },
                });
        }

        const kept = await samples();

        /* The schema's rule rather than a timer somebody has to remember: `date_trunc`
           plus the unique index on (worker_id, at). The last reading in the minute wins. */
        expect(kept).toHaveLength(1);
        expect(kept[0].devices[0].gpu_utilization_percent).toBe(7);
    });

    it('records nothing when the poll carries no reading', async () => {
        const before = await samples();

        await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: made.workerId, wait_seconds: 0, capabilities: { engines: [] } });

        /* A worker with no NVIDIA devices to report is not a reading of zero. An empty
           row would put a 0% machine into the pool average. */
        expect(await samples()).toEqual(before);
    });
});

describe('A worker that is working and polls in the same minute', () => {

    it('keeps the reading that knows what was running', async () => {
        const [job] = await query(
            `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
             VALUES ('training', :spec, 'leased', 1, 1)
             RETURNING id`,
            { spec: JSON.stringify({ jest: `idle-telemetry-${runId}` }) }
        );

        made.jobId = job.id;

        const [attempt] = await query(
            `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
             VALUES (:jobId, :workerId, 0, 1, 'running', NOW() + INTERVAL '1 hour')
             RETURNING id`,
            { jobId: job.id, workerId: made.workerId }
        );

        made.attemptId = attempt.id;

        /* A heartbeat first, as a machine mid-job sends: it knows its attempt and its
           kind, so the chart can attribute this utilisation to training. */
        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${attempt.id}/heartbeat`)
            .send({
                worker_id: made.workerId,
                lease_epoch: 1,
                state: 'running',
                telemetry: { devices: [device(98)] },
            });

        expect(beat.status).toBe(200);

        const working = await samples();

        expect(working).toHaveLength(1);
        expect(working[0].job_kind).toBe('training');
        expect(working[0].devices[0].gpu_utilization_percent).toBe(98);

        /* Then a poll for the next job, inside the same minute. Both write to the one row
           the schema allows, and the idle one does not know what was running. */
        await global.api
            .post('/api/v2/gpu/poll')
            .send({
                worker_id: made.workerId,
                wait_seconds: 0,
                capabilities: { resources: { nvidia: { devices: [device(4)] } } },
            });

        const after = await samples();

        expect(after).toHaveLength(1);

        /* **The working reading survives.** Letting the idle one win would turn attributed
           training compute into unattributed idle -- the chart would show training
           utilisation dropping for a reason that never happened, which is worse than a
           gap because it reads as a measurement. */
        expect(after[0].job_kind).toBe('training');
        expect(after[0].attempt_id).toBe(attempt.id);
        expect(after[0].devices[0].gpu_utilization_percent).toBe(98);
    });
});
