/**
 * A worker's idle GPU power, and the pool's power over time.
 *
 * #214. The cost of the work is what a card draws above idle, not what it draws. Settled
 * with Isaac on 2026-10-30: idle is the median of a worker's readings with no job over the
 * last 7 days, summed across its cards; the figures are GPU power only.
 *
 * @fileoverview Idle power baseline and pool power series.
 * @author Isaac Travers
 * @module tests/gpu-worker-power
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

const runId = Date.now();

let workerId;

function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/** A reading of two cards drawing `a` and `b` watts. */
const devices = (a, b) => JSON.stringify([
    { device_index: 0, name: 'Jest GPU 0', power_usage_watts: a, power_limit_watts: 320 },
    { device_index: 1, name: 'Jest GPU 1', power_usage_watts: b, power_limit_watts: 320 },
]);

async function sample(at, a, b, jobKind = null) {
    await query(
        `INSERT INTO gpu_worker_samples (worker_id, at, devices, system, job_kind)
         VALUES (:workerId, ${at}, :devices, '{}'::jsonb, :jobKind) RETURNING worker_id`,
        { workerId, devices: devices(a, b), jobKind }
    );
}

beforeAll(async () => {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, state, slot_count, enrolled_at, last_seen_at)
         VALUES (:localId, :name, 'online', 1, NOW(), NOW()) RETURNING id`,
        { localId: `jest-power-local-${runId}`, name: `jest-power-${runId}` }
    );

    workerId = worker.id;

    /* Idle this week: 6, 8 and 50 W across the two cards (3+3, 4+4, 25+25), so the median
       is 8 W -- the one busy-desktop reading does not drag it. A reading with a job is not
       idle, however low. */
    await sample("NOW() - interval '3 hours'", 3, 3);
    await sample("NOW() - interval '2 hours'", 4, 4);
    await sample("NOW() - interval '1 hour'", 25, 25);
    await sample("NOW() - interval '30 minutes'", 1, 1, 'training');

    /* And an hour of history 25 days ago: inside the 30 days readings are kept, and before
       anything real in any database this runs against. */
    await sample("date_trunc('hour', NOW() - interval '25 days') + interval '5 minutes'", 100, 50, 'training');
    await sample("date_trunc('hour', NOW() - interval '25 days') + interval '35 minutes'", 120, 30, 'training');
});

afterAll(async () => {
    await db.sequelize.query('DELETE FROM gpu_worker_samples WHERE worker_id = :workerId', { replacements: { workerId }, logging: false });
    await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :workerId', { replacements: { workerId }, logging: false });
});

describe('GPU power (#214)', () => {
    it('a worker\'s idle baseline is the median of its idle readings, summed across its cards', async () => {
        const response = await global.api.get('/api/v2/gpu/workers');

        expect(response.status).toBe(200);

        const mine = (response.body.workers || response.body).find((worker) => worker.worker_id === workerId);

        expect(mine.idle_power_watts).toBe(8);
    });

    it('the telemetry series carries the pool\'s total power per bucket', async () => {
        const hour = new Date(Date.now() - 25 * 86400e3);
        hour.setUTCMinutes(0, 0, 0);
        const response = await global.api.get('/api/v2/gpu/telemetry/series').query({
            since: hour.toISOString(), until: new Date(hour.getTime() + 3600e3).toISOString(), bucket: 'hour',
        });

        expect(response.status).toBe(200);

        /* One machine, both cards summed (150 W each reading), averaged over its readings. */
        const [point] = response.body.points.filter((one) => one.machines > 0);

        expect(point.total_power_watts).toBe(150);
    });
});
