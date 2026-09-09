/**
 * Tests for a long poll whose worker has gone away.
 *
 * This is the tier the defect lives at and the only one that can see it. The
 * service and repository are both correct in isolation -- a poll waits, and a
 * claim claims -- and the bug is entirely in the pairing: an HTTP request that
 * outlives its client. Nothing below a real request and a real disconnection
 * can observe it, which is why it survived 264 passing tests and was found by
 * running a real worker against a real coordinator.
 *
 * What happened: a worker was stopped part way through a 60-second poll. The
 * socket closed; the handler kept waiting. Forty seconds later a job was
 * submitted, that dead poll claimed it, and an attempt was opened for a machine
 * that no longer existed. The job then sat `leased` and unheartbeated for a
 * full lease period and had spent one of its three attempts. Three dropped
 * connections in a row would `expire` a job no machine had ever touched.
 *
 * The suite carries a **positive control**: the same poll, not aborted, must
 * lease the job. Without it, these tests would keep passing if the poll stopped
 * working altogether -- "no attempt was created" is also what a broken poll
 * looks like.
 *
 * @fileoverview Tests that an abandoned long poll leases no work.
 * @author Isaac Travers
 * @module tests/gpu-abandoned-poll
 */

const db = require('../model');

/**
 * Unique per run, so two runs cannot collide on the worker name's unique index.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * Priority these jobs are given, high enough that a poll here claims this
 * suite's own job rather than anything else that happens to be queued.
 *
 * @constant
 * @type {number}
 */
const TEST_PRIORITY = 3000;

/** Job ids created here, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/** Worker ids created here, removed in afterAll. @type {Array<number>} */
const createdWorkerIds = [];

/**
 * Wait, without holding the event loop.
 *
 * @param {number} milliseconds - How long.
 * @returns {Promise<void>}
 */
function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Enrol a worker through the API.
 *
 * @param {string} suffix - Distinguishes it from this suite's other workers.
 * @returns {Promise<number>} Its id.
 */
async function enrolWorker(suffix) {
    const response = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({ name: `jest-abandoned-worker-${runId}-${suffix}`, slot_count: 1 });

    expect(response.status).toBe(200);

    createdWorkerIds.push(response.body.worker_id);

    return response.body.worker_id;
}

/**
 * Queue one job through the API.
 *
 * @returns {Promise<number>} Its id.
 */
async function queueJob() {
    const response = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'inference',
            priority: TEST_PRIORITY,
            spec: {
                engine: 'mock',
                model: { name: `jest-abandoned-model-${runId}`, sha256: 'd'.repeat(64) },
                video: { jellyfin_item_id: `jest-abandoned-item-${runId}` },
                range: { start_frame: 0, end_frame: 100 },
            },
        });

    expect(response.status).toBe(200);

    const id = response.body.jobs[0].id;
    createdJobIds.push(id);

    return id;
}

/**
 * Start a long poll and hand back the in-flight request, so a test can abandon
 * it.
 *
 * `end` is called with a callback that swallows the error an abort produces:
 * without it, aborting turns into an unhandled rejection and fails the run for
 * the wrong reason.
 *
 * @param {number} workerId - The worker polling.
 * @param {number} waitSeconds - How long to ask the coordinator to hold it.
 * @returns {Object} The superagent request, which has `abort()`.
 */
function startLongPoll(workerId, waitSeconds) {
    const poll = global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: waitSeconds });

    poll.end(() => {});

    return poll;
}

/**
 * Cancel anything this suite left queued or leased, so the next suite starts
 * from a known queue. `gpu-lease-race` refuses to run at all if a job is
 * queued, and that refusal is deliberate.
 *
 * @returns {Promise<void>}
 */
async function drainQueue() {
    if (createdJobIds.length === 0) {
        return;
    }

    await db.sequelize.query(
        'UPDATE gpu_jobs SET state = \'cancelled\' WHERE id IN (:jobIds) AND state IN (\'queued\', \'leased\')',
        { replacements: { jobIds: createdJobIds } }
    );
}

afterAll(async () => {
    await drainQueue();

    if (createdJobIds.length > 0) {
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });

        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
    }

    if (createdWorkerIds.length > 0) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id IN (:workerIds)', {
            replacements: { workerIds: createdWorkerIds },
        });
    }
});

describe('What a poll says about the machine that made it', () => {
    afterEach(drainQueue);

    it('records the worker as heard from even when there is no work for it', async () => {
        const workerId = await enrolWorker('idle');

        const before = await global.api.get('/api/v2/gpu/workers');
        const enrolled = before.body.find((worker) => worker.worker_id === workerId);

        expect(enrolled.last_seen_at).not.toBeNull();

        // Long enough that the timestamps are distinguishable.
        await wait(1200);

        // An empty queue and no wait: the poll is answered 204 immediately.
        const poll = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

        expect(poll.status).toBe(204);

        const after = await global.api.get('/api/v2/gpu/workers');
        const seen = after.body.find((worker) => worker.worker_id === workerId);

        // The whole point. `last_seen_at` was written on enrolment, on a
        // heartbeat, and on a poll that took a job -- but not on one answered
        // "no work". So a machine dialling out every few seconds went stale
        // within a minute and read exactly like one that had been switched off,
        // which is the state a pool view most needs to be able to tell apart.
        expect(new Date(seen.last_seen_at).getTime())
            .toBeGreaterThan(new Date(enrolled.last_seen_at).getTime());

        // And it is still idle rather than having been given anything.
        expect(seen.activity).toBe('idle');
    }, 30000);
});

describe('Reading one job whose worker has gone quiet', () => {
    afterEach(drainQueue);

    it('reports the lease as expired without waiting for some other request to sweep', async () => {
        const workerId = await enrolWorker('quiet');
        const jobId = await queueJob();

        // Lease it, then never heartbeat: the machine has gone.
        const lease = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

        expect(lease.status).toBe(200);
        expect(lease.body.job_id).toBe(jobId);

        // Put the lease in the past rather than waiting a minute for it. The
        // coordinator's clock is what decides expiry, and this is the clock it
        // reads -- so moving the deadline is the same event as time passing.
        await db.sequelize.query(
            `UPDATE gpu_job_attempts
                SET lease_expires_at = NOW() - INTERVAL '1 second'
              WHERE id = :attemptId`,
            { replacements: { attemptId: lease.body.attempt_id } }
        );

        // One read of this job, and nothing else. Before this swept, the answer
        // stayed `leased` / `running` until some unrelated request happened to
        // sweep -- so a page watching one job showed a dead machine as working.
        const detail = await global.api.get(`/api/v2/gpu/jobs/${jobId}`);

        expect(detail.status).toBe(200);
        expect(detail.body.job.state).toBe('queued');
        expect(detail.body.attempts[0].state).toBe('abandoned');
        expect(detail.body.attempts[0].failure_reason).toMatch(/Lease expired/);
    }, 30000);
});

describe('A long poll whose worker has gone away', () => {
    afterEach(drainQueue);

    it('leases nothing when the request was abandoned before the work appeared', async () => {
        const workerId = await enrolWorker('abandoned');

        // Long enough that the poll is certainly still waiting when the job is
        // queued below.
        const poll = startLongPoll(workerId, 20);

        // Let it reach the waiting loop before anything else happens.
        await wait(500);

        // The worker goes away: process stopped, link dropped, laptop shut.
        poll.abort();

        // Let the socket's close reach the handler.
        await wait(500);

        // Work appears with nobody listening for it.
        const jobId = await queueJob();

        // Several times the poll's retry interval, so a handler still looking
        // has had many chances to claim it.
        await wait(3000);

        const detail = await global.api.get(`/api/v2/gpu/jobs/${jobId}`);

        expect(detail.status).toBe(200);

        // Still claimable by a machine that actually exists, and no attempt has
        // been spent on one that does not.
        expect(detail.body.job.state).toBe('queued');
        expect(detail.body.job.attempts_made).toBe(0);
        expect(detail.body.attempts).toHaveLength(0);
    }, 30000);

    it('still leases the job when the poll was not abandoned', async () => {
        const workerId = await enrolWorker('present');

        // The positive control. Identical timings, nothing aborted: this must
        // lease. Without this test, removing the wait loop -- or breaking the
        // poll entirely -- would leave the test above passing.
        const poll = global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 20 });

        const answered = poll.then((response) => response);

        await wait(500);

        const jobId = await queueJob();

        const response = await answered;

        expect(response.status).toBe(200);
        expect(response.body.job_id).toBe(jobId);
        expect(response.body.lease_epoch).toBe(1);

        const detail = await global.api.get(`/api/v2/gpu/jobs/${jobId}`);

        expect(detail.body.job.state).toBe('leased');
        expect(detail.body.attempts).toHaveLength(1);
        expect(detail.body.attempts[0].worker_id).toBe(workerId);
    }, 30000);
});
