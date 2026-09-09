/**
 * Concurrency tests for the GPU job lease.
 *
 * "Two workers polling simultaneously never lease the same job" is the one real
 * concurrency claim in the orchestration design, and a single-threaded test
 * cannot observe it: calling the claim twice in sequence passes whether or not
 * any locking exists. So these tests hold two database transactions open at the
 * same time, which is the only arrangement in which the property is visible.
 *
 * The suite also contains a **negative control**: the same query without
 * `FOR UPDATE SKIP LOCKED`, run through the same two overlapping transactions,
 * and asserted to hand one job to both callers. That is what proves this file
 * can fail. Without it, the tests below would keep passing if somebody deleted
 * the locking clause, and a test that cannot fail is worse than no test.
 *
 * @fileoverview Concurrency tests for claiming a GPU job.
 * @author Isaac Travers
 * @module tests/gpu-lease-race
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const gpuRepository = require('../repository/gpu.repository');

/**
 * Unique per run, so two runs cannot collide on the worker name's unique index.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * Priority every job here is given, so the claim order is decided among this
 * suite's own jobs rather than by anything else in the queue.
 *
 * @constant
 * @type {number}
 */
const TEST_PRIORITY = 2000;

/** Job ids created here, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/** Worker ids created here, removed in afterAll. @type {Array<number>} */
const createdWorkerIds = [];

/**
 * Run one statement against the development database.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Queue `count` jobs through the API, and remember them for teardown.
 *
 * @param {number} count - How many.
 * @returns {Promise<Array<number>>} Their ids.
 */
async function queueJobs(count) {
    const ids = [];

    for (let index = 0; index < count; index += 1) {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                priority: TEST_PRIORITY,
                spec: {
                    engine: 'ultralytics',
                    model: { name: `jest-race-model-${runId}`, sha256: 'c'.repeat(64) },
                    video: { jellyfin_item_id: `jest-race-item-${runId}` },
                    range: { start_frame: index * 100, end_frame: (index * 100) + 100 },
                },
            });

        expect(response.status).toBe(200);

        const id = response.body.jobs[0].id;
        ids.push(id);
        createdJobIds.push(id);
    }

    return ids;
}

/**
 * Enrol a worker through the API, and remember it for teardown.
 *
 * @param {string} suffix - Distinguishes it from the suite's other workers.
 * @returns {Promise<number>} Its id.
 */
async function enrolWorker(suffix) {
    const response = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({ name: `jest-race-worker-${runId}-${suffix}`, slot_count: 1 });

    expect(response.status).toBe(200);

    createdWorkerIds.push(response.body.worker_id);

    return response.body.worker_id;
}

/**
 * Finish every job this suite left unfinished, so the next test starts from a
 * known queue.
 *
 * Leased jobs are cancelled as well as queued ones, not for tidiness: a lease
 * left open would expire on its own while the suite is still running, put its
 * job back in the queue, and give a later test a fifth claimable job it did not
 * ask for.
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

beforeAll(async () => {
    // These tests assert on which job a claim returns, so a job queued by
    // something else would be claimed first and the assertions would be about
    // the wrong row. Failing rather than skipping: a suite that quietly stops
    // checking looks exactly like a passing one.
    const [foreign] = await query('SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = \'queued\'');

    if (foreign.n > 0) {
        throw new Error(
            `${foreign.n} GPU job(s) are already queued in this database. These tests claim whatever is `
            + 'queued, so they cannot run alongside them. Cancel or finish them first.'
        );
    }
});

afterAll(async () => {
    if (createdJobIds.length > 0) {
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id IN (:jobIds)', {
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

/**
 * The locking primitive itself, with two transactions deliberately overlapping.
 */
describe('Claiming a GPU job under two overlapping transactions', () => {
    afterEach(drainQueue);

    it('does not offer one queued job to a second transaction while the first holds it', async () => {
        await queueJobs(1);

        const first = await db.sequelize.transaction();
        const second = await db.sequelize.transaction();

        try {
            // The first transaction takes the row lock and keeps it: nothing is
            // committed, which is exactly the state a poller is in between
            // choosing a job and writing the attempt.
            const firstClaim = await gpuRepository.selectClaimableJobRow(first);

            expect(firstClaim).not.toBeNull();

            // The second arrives while that lock is held. `SKIP LOCKED` means it
            // neither waits nor sees the locked row, so with only one job queued
            // it must come away with nothing.
            const secondClaim = await gpuRepository.selectClaimableJobRow(second);

            expect(secondClaim).toBeNull();
        } finally {
            await first.rollback();
            await second.rollback();
        }
    });

    it('gives two overlapping transactions two different jobs', async () => {
        const ids = await queueJobs(2);

        const first = await db.sequelize.transaction();
        const second = await db.sequelize.transaction();

        try {
            const firstClaim = await gpuRepository.selectClaimableJobRow(first);
            const secondClaim = await gpuRepository.selectClaimableJobRow(second);

            expect(firstClaim).not.toBeNull();
            expect(secondClaim).not.toBeNull();
            expect(secondClaim.id).not.toBe(firstClaim.id);
            expect(ids).toContain(firstClaim.id);
            expect(ids).toContain(secondClaim.id);
        } finally {
            await first.rollback();
            await second.rollback();
        }
    });

    it('negative control: without the locking clause, one job goes to both transactions', async () => {
        await queueJobs(1);

        /**
         * The claim query with `FOR UPDATE SKIP LOCKED` removed, and nothing
         * else changed. Written out here rather than reached through the
         * repository precisely because the repository must never contain it.
         *
         * @param {Object} transaction - Transaction to read in.
         * @returns {Promise<Object|null>} The job both callers will see.
         */
        async function selectWithoutLocking(transaction) {
            const [job] = await db.sequelize.query(
                `SELECT *
                   FROM gpu_jobs
                  WHERE state = 'queued'
                    AND attempts_made < max_attempts
                  ORDER BY priority DESC, created_at ASC, id ASC
                  LIMIT 1`,
                { type: QueryTypes.SELECT, transaction }
            );

            return job || null;
        }

        const first = await db.sequelize.transaction();
        const second = await db.sequelize.transaction();

        try {
            const firstClaim = await selectWithoutLocking(first);
            const secondClaim = await selectWithoutLocking(second);

            // Both hold the same job, and would both go on to lease it. This is
            // the failure the tests above exist to rule out, and seeing it here
            // is what proves they are capable of noticing it.
            expect(firstClaim).not.toBeNull();
            expect(secondClaim).not.toBeNull();
            expect(secondClaim.id).toBe(firstClaim.id);
        } finally {
            await first.rollback();
            await second.rollback();
        }
    });
});

/**
 * The same property through the routes, which is where a real worker meets it.
 *
 * These fire genuinely simultaneous requests, but whether the two claim
 * transactions actually overlap inside Postgres is up to the scheduler, so a
 * pass here does not on its own prove the locking works -- that is what the
 * overlapping-transaction tests above are for. What these add is that the whole
 * path, from route through service to the claim, upholds the invariant.
 */
describe('Simultaneous polls through the API', () => {
    afterEach(drainQueue);

    it('leases one queued job to exactly one of two workers polling at once', async () => {
        const [jobId] = await queueJobs(1);
        const workerA = await enrolWorker('a');
        const workerB = await enrolWorker('b');

        const [pollA, pollB] = await Promise.all([
            global.api.post('/api/v2/gpu/poll').send({ worker_id: workerA, wait_seconds: 0 }),
            global.api.post('/api/v2/gpu/poll').send({ worker_id: workerB, wait_seconds: 0 }),
        ]);

        const statuses = [pollA.status, pollB.status].sort();

        expect(statuses).toEqual([200, 204]);

        const leased = pollA.status === 200 ? pollA.body : pollB.body;

        expect(leased.job_id).toBe(jobId);
        expect(leased.lease_epoch).toBe(1);

        // The row is the proof: one attempt, and the job counted exactly one
        // lease. Two attempts here would mean two machines running the same
        // frames and two results claiming to be the answer.
        const attempts = await query('SELECT id, lease_epoch FROM gpu_job_attempts WHERE job_id = :jobId', { jobId });
        const [job] = await query('SELECT state, attempts_made FROM gpu_jobs WHERE id = :jobId', { jobId });

        expect(attempts).toHaveLength(1);
        expect(job.state).toBe('leased');
        expect(job.attempts_made).toBe(1);
    });

    it('shares four queued jobs among eight simultaneous polls without leasing any twice', async () => {
        const jobIds = await queueJobs(4);
        const workerIds = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((index) => enrolWorker(`fan-${index}`)));

        const responses = await Promise.all(
            workerIds.map((workerId) => global.api.post('/api/v2/gpu/poll').send({ worker_id: workerId, wait_seconds: 0 }))
        );

        const leased = responses.filter((response) => response.status === 200);
        const empty = responses.filter((response) => response.status === 204);

        expect(leased).toHaveLength(4);
        expect(empty).toHaveLength(4);

        // Four leases over four jobs, each job leased once.
        const leasedJobIds = leased.map((response) => response.body.job_id).sort((a, b) => a - b);

        expect(leasedJobIds).toEqual(jobIds.slice().sort((a, b) => a - b));
        expect(new Set(leasedJobIds).size).toBe(4);

        const attempts = await query(
            'SELECT job_id, lease_epoch FROM gpu_job_attempts WHERE job_id IN (:jobIds) ORDER BY job_id ASC',
            { jobIds }
        );

        expect(attempts).toHaveLength(4);
        expect(attempts.every((attempt) => attempt.lease_epoch === 1)).toBe(true);
    });
});

/**
 * The database's own backstop, underneath the locking.
 */
describe('The unique attempt-per-epoch index', () => {
    afterEach(drainQueue);

    it('refuses a second attempt at the same job and epoch', async () => {
        const [jobId] = await queueJobs(1);
        const workerId = await enrolWorker('index');

        const polled = await global.api.post('/api/v2/gpu/poll').send({ worker_id: workerId, wait_seconds: 0 });

        expect(polled.status).toBe(200);

        // Inserted by hand, because no route can produce this: it is the shape a
        // bug in the claim would take, and the index is what stops such a bug
        // becoming two machines on one job.
        let failure = null;

        try {
            await db.sequelize.query(
                `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at)
                 VALUES (:jobId, :workerId, 1, :leaseEpoch, 'assigned', NOW(), NOW() + INTERVAL '60 seconds')`,
                { replacements: { jobId, workerId, leaseEpoch: polled.body.lease_epoch } }
            );
        } catch (error) {
            failure = error;
        }

        expect(failure).not.toBeNull();

        // Sequelize wraps a unique violation, so the constraint's name is in the
        // driver's own message rather than always in the wrapper's.
        const message = (failure.original && failure.original.message) || failure.message;

        expect(message).toMatch(/gpu_job_attempts_job_epoch_unique/);
    });
});
