/**
 * A worker's uptime is how long it has checked in without a break.
 *
 * #277. The Workers table's Uptime column always said "not reported": the worker's own
 * process uptime read 4.8 s on a machine up for hours, and MARP recorded nothing. It needs
 * nothing from the machine. A check-in after a silence of more than 180 seconds starts a
 * new run; any other keeps the one it is in; `GET /gpu/workers` serves when it began.
 *
 * @fileoverview Worker uptime from unbroken check-ins.
 * @author Isaac Travers
 * @module tests/gpu-worker-uptime
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run. */
const runId = Date.now();

let workerId;

function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/** Ask for work, as the worker does at least once a minute. */
function poll() {
    return global.api.post('/api/v2/gpu/poll').send({
        worker_id: workerId, slot_indexes: [0], wait_seconds: 0, capabilities: { gpus: [] },
    });
}

/** The worker's `up_since` and `last_seen_at`, in milliseconds. */
async function times() {
    const [row] = await query('SELECT up_since, last_seen_at FROM gpu_workers WHERE id = :workerId', { workerId });
    return { upSince: Date.parse(row.up_since), lastSeen: Date.parse(row.last_seen_at) };
}

beforeAll(async () => {
    const enrolled = await global.api.post('/api/v2/gpu/workers/enrol').send({
        local_id: `jest-uptime-local-${runId}`,
        name: `jest-uptime-${runId}`,
        slot_count: 1,
        worker_version: '0.0.1-jest',
        capabilities: { gpus: [], engines: [] },
    });

    workerId = enrolled.body.worker_id;
});

afterAll(async () => {
    const drop = (sql) => db.sequelize.query(sql, { replacements: { workerId }, logging: false });

    await drop('DELETE FROM gpu_worker_samples WHERE worker_id = :workerId');
    await drop('DELETE FROM gpu_workers WHERE id = :workerId');
});

describe('uptime from check-ins (#277)', () => {
    it('a check-in after a silence over 180 seconds starts a new run', async () => {
        await query(
            `UPDATE gpu_workers SET up_since = NOW() - interval '2 days', last_seen_at = NOW() - interval '10 minutes'
              WHERE id = :workerId RETURNING id`,
            { workerId }
        );

        const before = Date.now();
        expect((await poll()).status).toBeLessThan(300);

        const { upSince } = await times();

        expect(upSince).toBeGreaterThanOrEqual(before - 5000);
    });

    it('a check-in inside 180 seconds keeps the run it is in', async () => {
        await query(
            `UPDATE gpu_workers SET up_since = NOW() - interval '3 hours', last_seen_at = NOW() - interval '60 seconds'
              WHERE id = :workerId RETURNING id`,
            { workerId }
        );

        expect((await poll()).status).toBeLessThan(300);

        const { upSince, lastSeen } = await times();

        expect(lastSeen - upSince).toBeGreaterThan(2.9 * 3600e3);
    });

    it('the pool serves when the run began', async () => {
        const response = await global.api.get('/api/v2/gpu/workers');

        expect(response.status).toBe(200);

        const mine = (response.body.workers || response.body).find((worker) => worker.worker_id === workerId);

        expect(mine).toBeTruthy();
        expect(Date.now() - Date.parse(mine.up_since)).toBeGreaterThan(2.9 * 3600e3);
    });
});
