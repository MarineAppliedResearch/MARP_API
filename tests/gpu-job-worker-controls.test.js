/**
 * Job and worker controls: pause now, drain, resume, retire; retry; move up, down, front.
 *
 * #319, Phase 5 of the ML Dashboard plan. Settled with Isaac on 2026-11-03: a retried job
 * gets a fresh attempt budget; reordering is up, down or to the front; a retired worker
 * takes no work and keeps its history and token.
 *
 * @fileoverview Job and worker control routes, end to end against a database.
 * @author Isaac Travers
 * @module tests/gpu-job-worker-controls
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

const runId = Date.now();
const made = { workerId: null, jobIds: [] };

const query = (sql, replacements = {}) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

/** An inference spec whose video needs no media server. */
const spec = () => ({
    engine: 'ultralytics',
    model: { name: `jest-controls-model-${runId}`, sha256: 'a'.repeat(64) },
    video: { url: `http://jest.invalid/media/jest-controls-${runId}.mp4`, source_name: 'jest-controls.mp4' },
    range: { start_frame: 0, end_frame: 100 },
    params: { conf: 0.25 },
    reduction: { name: 'v3_dirpad', version: 1 },
});

/** A job written straight into the table, for states a test cannot otherwise reach. */
async function seedJob({ state, batchId = null, attemptsMade = 0, yieldsMade = 0, priority = 0, createdAgo = 0 }) {
    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, batch_id, name, spec, state, priority, attempts_made, yields_made, max_attempts,
                               finished_at, created_at, updated_at)
         VALUES ('inference', :batchId, :name, :spec, :state, :priority, :attemptsMade, :yieldsMade, 3,
                 CASE WHEN :state IN ('failed', 'expired', 'succeeded') THEN NOW() END,
                 NOW() - (:createdAgo * interval '1 second'), NOW())
         RETURNING id`,
        {
            batchId, name: `jest-controls-${runId}-${made.jobIds.length}`, spec: JSON.stringify(spec()),
            state, priority, attemptsMade, yieldsMade, createdAgo,
        }
    );
    made.jobIds.push(job.id);
    return job.id;
}

const job = async (id) => (await query('SELECT * FROM gpu_jobs WHERE id = :id', { id }))[0];
const control = (action) => global.api.post(`/api/v2/gpu/workers/${made.workerId}/control`).send({ action });
const enrol = () => global.api.post('/api/v2/gpu/workers/enrol').send({
    local_id: `jest-controls-local-${runId}`, name: `jest-controls-${runId}`, slot_count: 4,
    worker_version: '0.0.1-jest', capabilities: { gpus: [{ name: 'jest-gpu', vram_mb: 1024 }], engines: ['ultralytics'] },
});
const poll = () => global.api.post('/api/v2/gpu/poll')
    .send({ worker_id: made.workerId, slot_indexes: [0, 1, 2, 3], wait_seconds: 0, capabilities: { gpus: [] } });

beforeAll(async () => {
    // A poll and a move both act on the whole queue, so it must hold nothing but ours.
    const [queued] = await query("SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = 'queued'");
    if (queued.n > 0) throw new Error(`${queued.n} GPU job(s) are already queued here; this suite acts on the whole queue.`);

    made.workerId = (await enrol()).body.worker_id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
    if (made.jobIds.length) await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    if (made.workerId) {
        await drop('DELETE FROM gpu_worker_samples WHERE worker_id = :id', { id: made.workerId });
        await drop('DELETE FROM gpu_workers WHERE id = :id', { id: made.workerId });
    }
});

describe('Worker controls (#319)', () => {

    let lease;

    it('Pause now hands the running job back at its next heartbeat, and takes no more work', async () => {
        await seedJob({ state: 'queued', priority: 9000 });
        const polled = await poll();
        expect(polled.status).toBe(200);
        lease = polled.body;

        expect((await control('pause')).body).toEqual({ worker_id: made.workerId, state: 'paused' });

        const beat = await global.api.post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: made.workerId, lease_epoch: lease.lease_epoch, state: 'running',
                progress: { done: 10, total: 100, unit: 'frames' } });
        expect(beat.body.action).toBe('yield');

        await seedJob({ state: 'queued', priority: 9001 });
        expect((await poll()).status).toBe(204);
    });

    it('survives the worker restarting, which used to put it back online', async () => {
        await enrol();
        expect((await job(made.jobIds[1])).state).toBe('queued');
        expect((await query('SELECT state FROM gpu_workers WHERE id = :id', { id: made.workerId }))[0].state).toBe('paused');
    });

    it('Drain lets the running job carry on and takes no more work', async () => {
        expect((await control('drain')).body.state).toBe('draining');

        const beat = await global.api.post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: made.workerId, lease_epoch: lease.lease_epoch, state: 'running',
                progress: { done: 20, total: 100, unit: 'frames' } });
        expect(beat.body.action).toBe('continue');
        expect((await poll()).status).toBe(204);
    });

    it('Retire takes no work, keeps the machine listed by state, and Resume brings it back', async () => {
        expect((await control('retire')).body.state).toBe('retired');
        expect((await poll()).status).toBe(204);

        const pool = await global.api.get('/api/v2/gpu/workers');
        const mine = (pool.body.workers || pool.body).find((one) => one.worker_id === made.workerId);
        expect(mine.state).toBe('retired');

        expect((await control('resume')).body.state).toBe('online');
    });

    it('refuses an unknown action and an unknown worker', async () => {
        expect((await control('explode')).status).toBe(400);
        expect((await global.api.post('/api/v2/gpu/workers/2147483000/control').send({ action: 'pause' })).status).toBe(404);
    });
});

describe('Retry (#319)', () => {

    it('puts the failed and expired pieces of a run back with a fresh budget, and nothing else', async () => {
        const batchId = '5e3c1a2b-0000-4000-8000-' + String(runId).slice(-12).padStart(12, '0');
        const failed = await seedJob({ state: 'failed', batchId, attemptsMade: 3 });
        const expired = await seedJob({ state: 'expired', batchId, attemptsMade: 4, yieldsMade: 1 });
        const done = await seedJob({ state: 'succeeded', batchId, attemptsMade: 1 });

        const response = await global.api.post('/api/v2/gpu/jobs/retry').send({ batch_id: batchId });

        expect(response.status).toBe(200);
        expect(response.body.retried).toBe(2);
        expect(response.body.skipped).toEqual([{ id: done, reason: 'succeeded, not failed' }]);

        // Spent so far plus three: the same tries a new job gets.
        expect(await job(failed)).toMatchObject({ state: 'queued', max_attempts: 6, finished_at: null });
        expect(await job(expired)).toMatchObject({ state: 'queued', max_attempts: 6 });
        expect((await job(done)).state).toBe('succeeded');

        // Out of the queue again, so the move test below has it to itself.
        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id IN (:ids)", { replacements: { ids: [failed, expired] } });
    });
});

describe('Move (#319)', () => {

    it('moves a run as one block up, down and to the front', async () => {
        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id IN (:ids) AND state IN ('queued', 'leased')",
            { replacements: { ids: made.jobIds } });

        const runA = '6e3c1a2b-0000-4000-8000-' + String(runId).slice(-12).padStart(12, '0');
        const a1 = await seedJob({ state: 'queued', batchId: runA, createdAgo: 30 });
        const a2 = await seedJob({ state: 'queued', batchId: runA, createdAgo: 29 });
        const b = await seedJob({ state: 'queued', createdAgo: 20 });
        const c = await seedJob({ state: 'queued', createdAgo: 10 });

        const order = async () => (await query(
            `SELECT id FROM gpu_jobs WHERE id IN (:ids) AND state = 'queued' ORDER BY priority DESC, created_at, id`,
            { ids: [a1, a2, b, c] })).map((row) => row.id);

        expect(await order()).toEqual([a1, a2, b, c]);

        const front = await global.api.post(`/api/v2/gpu/jobs/${c}/move`).send({ direction: 'front' });
        expect(front.body).toEqual({ job_id: c, moved: true, position: 1, of: 3 });
        expect(await order()).toEqual([c, a1, a2, b]);

        // Moving one piece moves its run.
        await global.api.post(`/api/v2/gpu/jobs/${a2}/move`).send({ direction: 'down' });
        expect(await order()).toEqual([c, b, a1, a2]);

        await global.api.post(`/api/v2/gpu/jobs/${b}/move`).send({ direction: 'up' });
        expect(await order()).toEqual([b, c, a1, a2]);

        // Past the front is not an error.
        expect((await global.api.post(`/api/v2/gpu/jobs/${b}/move`).send({ direction: 'up' })).body.moved).toBe(false);
        expect((await global.api.post(`/api/v2/gpu/jobs/${b}/move`).send({ direction: 'sideways' })).status).toBe(400);

        await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id IN (:ids)", { replacements: { ids: [a1, a2, b, c] } });
        expect((await global.api.post(`/api/v2/gpu/jobs/${b}/move`).send({ direction: 'up' })).status).toBe(409);
    });
});
