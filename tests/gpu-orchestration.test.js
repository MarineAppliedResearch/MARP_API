/**
 * Endpoint tests for the GPU orchestration API.
 *
 * Covers the whole worker contract at the HTTP tier, which is the tier that can
 * actually see it: enrolment, the poll that leases, the heartbeat that carries
 * control back, the event stream, the artifact hand-off, and the terminal
 * result. The concurrency property -- that two pollers cannot lease one job --
 * needs two simultaneous pollers to be observable at all and is therefore in
 * `tests/gpu-lease-race.test.js` rather than here.
 *
 * Three things are checked by moving the coordinator's clock rather than by
 * waiting: lease expiry, the per-attempt cap, and what a worker is told after
 * its lease was taken away. Waiting a real minute per assertion would make the
 * suite unusable, and the thing under test is the comparison against the
 * coordinator's clock, which an `UPDATE` exercises exactly as a passing minute
 * would.
 *
 * @fileoverview Endpoint tests for /api/v2/gpu.
 * @author Isaac Travers
 * @module tests/gpu-orchestration
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');

const db = require('../model');

/**
 * Where the API stores staged artifact bytes. The suite removes the files it
 * uploads, so a run leaves nothing behind on disk.
 *
 * @constant
 * @type {string}
 */
const ARTIFACT_DIRECTORY = path.join(__dirname, '..', 'storage', 'gpu-artifacts');

/**
 * Unique per run, so a failed run's leftovers are distinguishable and two runs
 * cannot collide on the durable id a worker enrols with.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * Priority every job this suite submits is given.
 *
 * Higher than anything a person would queue, so the claim order is decided by
 * this suite's own jobs and a poll cannot wander off and lease something that
 * happens to be sitting in the queue.
 *
 * @constant
 * @type {number}
 */
const TEST_PRIORITY = 1000;

/** Job ids this suite created, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/** Artifact hashes this suite staged, removed in afterAll. @type {Array<string>} */
const stagedHashes = [];

/** The worker this suite enrols. @type {number|undefined} */
let workerId;

/**
 * Any further workers one test needed. Removed in afterAll rather than by the
 * test itself, because `gpu_job_attempts.worker_id` is ON DELETE RESTRICT: a
 * machine cannot be deleted while attempts against it exist, and those go with
 * the jobs afterAll deletes first.
 *
 * @type {Array<number>}
 */
const extraWorkerIds = [];

/**
 * A Milestone 1 job spec: inference over a frame range of a Jellyfin video.
 *
 * @param {Object} range - `{start_frame, end_frame}`, half-open: the start is
 * included and the end is one past the last frame.
 * @returns {Object} A spec the submit route accepts.
 */
function specFor(range) {
    return {
        engine: 'ultralytics',
        model: { name: `jest-gpu-model-${runId}`, sha256: 'a'.repeat(64) },
        video: { jellyfin_item_id: `jest-item-${runId}`, source_name: 'jest-gpu.mp4' },
        range,
        params: { conf: 0.25, iou: 0.7, imgsz: 1280, tracker: null },
        reduction: { name: 'v3_dirpad', version: 1 },
    };
}

/**
 * Submit one job and remember it for teardown.
 *
 * @param {Object} [overrides] - Fields to merge into the submission body.
 * @returns {Promise<Object>} The created job row as the API returned it.
 */
async function submitJob(overrides = {}) {
    // Each submission outranks the last. A job leased earlier in this suite and
    // never finished can have its lease expire while the suite is still running,
    // which puts it back in the queue -- and being older, it would then be
    // claimed ahead of the job the current test just submitted. Rising priority
    // makes each test's own job the one its poll gets, whatever is behind it.
    const response = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'inference',
            spec: specFor({ start_frame: 0, end_frame: 100 }),
            priority: TEST_PRIORITY + createdJobIds.length,
            ...overrides,
        });

    expect(response.status).toBe(200);

    for (const job of response.body.jobs) {
        createdJobIds.push(job.id);
    }

    return response.body;
}

/**
 * Poll once, with no waiting.
 *
 * @returns {Promise<Object>} The Supertest response.
 */
function pollOnce() {
    return global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0, capabilities: { gpus: [] } });
}

/**
 * Submit a job and lease it, which is the starting position for most of the
 * tests below.
 *
 * @param {Object} [overrides] - Fields to merge into the submission body.
 * @returns {Promise<Object>} `{job, lease}`.
 */
async function submitAndLease(overrides = {}) {
    const submitted = await submitJob(overrides);
    const polled = await pollOnce();

    expect(polled.status).toBe(200);
    expect(polled.body.job_id).toBe(submitted.jobs[0].id);

    return { job: submitted.jobs[0], lease: polled.body };
}

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

beforeAll(async () => {
    // A poll takes the best-priority queued job in the database, so a job left
    // over from somewhere else would be leased by this suite and its assertions
    // about "no work left" would be meaningless. Failing rather than skipping,
    // because a suite that quietly stops checking looks exactly like a passing
    // one.
    const [foreign] = await query(
        'SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = \'queued\''
    );

    if (foreign.n > 0) {
        throw new Error(
            `${foreign.n} GPU job(s) are already queued in this database. This suite leases whatever is `
            + 'queued, so it cannot run alongside them. Cancel or finish them first.'
        );
    }

    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-gpu-local-${runId}`,
            name: `jest-gpu-worker-${runId}`,
            // Far more slots than a real machine would have. Most tests here
            // leave their lease open rather than reporting a result, and a
            // machine is never given more concurrent work than its slot_count --
            // which is checked on its own, with a one-slot worker, below.
            slot_count: 64,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [{ name: 'jest-gpu', vram_mb: 1024 }], engines: ['ultralytics'] },
        });

    expect(enrolled.status).toBe(200);
    workerId = enrolled.body.worker_id;
});

afterAll(async () => {
    // Artifacts first. `artifacts.job_id` is ON DELETE RESTRICT, deliberately --
    // a result cannot outlive the record of what produced it -- so a job with
    // artifacts cannot be deleted until they are.
    if (createdJobIds.length > 0) {
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });

        // Attempts and their events go with the job, by cascade.
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
    }

    if (stagedHashes.length > 0) {
        await db.sequelize.query('DELETE FROM gpu_artifacts_staging WHERE sha256 IN (:hashes)', {
            replacements: { hashes: stagedHashes },
        });

        for (const hash of stagedHashes) {
            fs.rmSync(path.join(ARTIFACT_DIRECTORY, hash), { force: true });
        }
    }

    const workerIds = [workerId, ...extraWorkerIds].filter(Boolean);

    if (workerIds.length > 0) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id IN (:workerIds)', {
            replacements: { workerIds },
        });
    }
});

/**
 * Enrolment is idempotent by the machine's durable id, which is what keeps a
 * machine that reboots from becoming a second row in the pool.
 */
describe('GPU worker enrolment', () => {
    it('returns the same worker when the same durable id enrols again, with fresh hardware', async () => {
        const again = await global.api
            .post('/api/v2/gpu/workers/enrol')
            .send({
                local_id: `jest-gpu-local-${runId}`,
                name: `jest-gpu-worker-${runId}`,
                capabilities: { gpus: [{ name: 'jest-gpu-2', vram_mb: 2048 }] },
            });

        expect(again.status).toBe(200);
        expect(again.body.worker_id).toBe(workerId);
        expect(again.body.heartbeat_seconds).toEqual(expect.any(Number));

        const [row] = await query('SELECT capabilities FROM gpu_workers WHERE id = :workerId', { workerId });

        expect(row.capabilities.gpus[0].name).toBe('jest-gpu-2');
    });

    it('refuses an enrolment with no name', async () => {
        const response = await global.api
            .post('/api/v2/gpu/workers/enrol')
            .send({ local_id: `jest-gpu-nameless-${runId}`, slot_count: 1 });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses an enrolment with no durable id, because that is the identity', async () => {
        const response = await global.api
            .post('/api/v2/gpu/workers/enrol')
            .send({ name: `jest-gpu-no-local-id-${runId}`, slot_count: 1 });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(response.body.error.message).toMatch(/local_id/);
    });

    it('does not echo the durable id back, keeping the identity internal', async () => {
        const again = await global.api
            .post('/api/v2/gpu/workers/enrol')
            .send({ local_id: `jest-gpu-local-${runId}`, name: `jest-gpu-worker-${runId}` });

        expect(again.status).toBe(200);
        expect(Object.keys(again.body)).not.toContain('local_id');
    });
});

/**
 * Submission, splitting, and the claim that happens inside the poll.
 */
describe('GPU job submission and leasing', () => {
    it('queues one job and leases it, in one poll and with no separate claim', async () => {
        const submitted = await submitJob();
        const job = submitted.jobs[0];

        expect(submitted.batch_id).toBeNull();
        expect(job.state).toBe('queued');
        expect(job.attempts_made).toBe(0);

        const polled = await pollOnce();

        expect(polled.status).toBe(200);
        expect(polled.body.job_id).toBe(job.id);
        expect(polled.body.lease_epoch).toBe(1);
        expect(polled.body.attempt_id).toEqual(expect.any(Number));
        expect(polled.body.spec.range).toEqual({ start_frame: 0, end_frame: 100 });

        const [after] = await query('SELECT state, attempts_made FROM gpu_jobs WHERE id = :id', { id: job.id });

        expect(after.state).toBe('leased');
        expect(after.attempts_made).toBe(1);
    });

    it('answers 204 when there is nothing to do', async () => {
        const polled = await pollOnce();

        expect(polled.status).toBe(204);
        expect(polled.body).toEqual({});
    });

    it('splits a range into half-open pieces that cover every frame exactly once', async () => {
        const totalFrames = 1000;
        const pieceFrames = 300;

        const submitted = await submitJob({
            spec: specFor({ start_frame: 0, end_frame: totalFrames }),
            piece_frames: pieceFrames,
        });

        expect(submitted.batch_id).toEqual(expect.any(String));
        expect(submitted.jobs).toHaveLength(4);

        const ranges = submitted.jobs.map((job) => job.spec.range);

        // The bounds are half-open, so each piece's end is the next piece's
        // start. The two repositories disagreed about this once -- MARP_API read
        // both bounds as inclusive while the worker read the end as exclusive --
        // and the cost was one frame silently dropped at every boundary. This
        // test exists so that divergence cannot come back unnoticed.
        expect(ranges).toEqual([
            { start_frame: 0, end_frame: 300 },
            { start_frame: 300, end_frame: 600 },
            { start_frame: 600, end_frame: 900 },
            { start_frame: 900, end_frame: 1000 },
        ]);

        // The last piece is short rather than over-long: nothing runs past the
        // end of the video.
        const last = ranges[ranges.length - 1];

        expect(last.end_frame - last.start_frame).toBe(100);
        expect(last.end_frame).toBe(totalFrames);

        // The count is the property the convention buys: end - start, with no
        // +1 anywhere, and the pieces adding up to the whole.
        const covered = ranges.reduce((sum, range) => sum + (range.end_frame - range.start_frame), 0);

        expect(covered).toBe(totalFrames);

        // And then the frames themselves, one tally per frame across the whole
        // range. A gap and an overlap can cancel out in a total, so counting is
        // not enough on its own.
        const timesCovered = new Array(totalFrames).fill(0);

        for (const range of ranges) {
            for (let frame = range.start_frame; frame < range.end_frame; frame += 1) {
                timesCovered[frame] += 1;
            }
        }

        expect(timesCovered.filter((times) => times === 0)).toHaveLength(0);
        expect(timesCovered.filter((times) => times > 1)).toHaveLength(0);
        expect(new Set(timesCovered)).toEqual(new Set([1]));

        // Every piece belongs to the same batch, which is how the dashboard
        // groups them and how a person finds the rest of a split video.
        expect(new Set(submitted.jobs.map((job) => job.batch_id)).size).toBe(1);

        const listed = await global.api.get(`/api/v2/gpu/jobs?batch_id=${submitted.batch_id}`);

        expect(listed.status).toBe(200);
        expect(listed.body.total).toBe(4);

        // Leave the queue as this suite found it, so later tests can still
        // assert that a poll finds nothing.
        for (const job of submitted.jobs) {
            await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);
        }
    });

    it('divides a range that does not divide evenly without losing or repeating a frame', async () => {
        // Seven frames into pieces of three, and not starting at zero. The
        // remainder is where an off-by-one in the piece arithmetic shows up
        // first, and a non-zero start is where one in the base does.
        const submitted = await submitJob({
            spec: specFor({ start_frame: 40, end_frame: 47 }),
            piece_frames: 3,
        });

        const ranges = submitted.jobs.map((job) => job.spec.range);

        expect(ranges).toEqual([
            { start_frame: 40, end_frame: 43 },
            { start_frame: 43, end_frame: 46 },
            { start_frame: 46, end_frame: 47 },
        ]);

        // Starts where the range starts, ends where it ends, and every boundary
        // is shared rather than adjacent.
        expect(ranges[0].start_frame).toBe(40);
        expect(ranges[ranges.length - 1].end_frame).toBe(47);

        for (let index = 1; index < ranges.length; index += 1) {
            expect(ranges[index].start_frame).toBe(ranges[index - 1].end_frame);
        }

        expect(ranges.reduce((sum, range) => sum + (range.end_frame - range.start_frame), 0)).toBe(7);

        for (const job of submitted.jobs) {
            await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);
        }
    });

    it('refuses an empty frame range rather than queueing a job that does nothing', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({ kind: 'inference', spec: specFor({ start_frame: 500, end_frame: 500 }) });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/must be greater than/);
    });

    it('refuses a submission with no frame range, even for a whole video', async () => {
        const spec = specFor({ start_frame: 0, end_frame: 10 });
        delete spec.range;

        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({ kind: 'inference', spec });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/spec.range is required/);
    });

    it('refuses a job of an unknown kind', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({ kind: 'transcoding', spec: specFor({ start_frame: 0, end_frame: 1 }) });

        expect(response.status).toBe(400);
    });

    it('does not give a machine more concurrent work than the slots it enrolled with', async () => {
        const enrolled = await global.api
            .post('/api/v2/gpu/workers/enrol')
            .send({
                local_id: `jest-gpu-one-slot-local-${runId}`,
                name: `jest-gpu-one-slot-${runId}`,
                slot_count: 1,
            });

        expect(enrolled.status).toBe(200);

        const oneSlot = enrolled.body.worker_id;
        extraWorkerIds.push(oneSlot);

        // The same priority for both, so which is claimed first is decided by
        // age. The rising priority in submitJob would otherwise make the second
        // job the one taken, and the assertion below would be about the wrong
        // row.
        const priority = TEST_PRIORITY + 500;
        const first = await submitJob({ priority });
        const second = await submitJob({ priority });

        try {
            const firstPoll = await global.api
                .post('/api/v2/gpu/poll')
                .send({ worker_id: oneSlot, wait_seconds: 0 });

            expect(firstPoll.status).toBe(200);

            // A second job is queued and this machine is online, but it said it
            // runs one thing at a time. Handing it both would thrash the GPU and
            // make the pool view a work of fiction.
            const secondPoll = await global.api
                .post('/api/v2/gpu/poll')
                .send({ worker_id: oneSlot, wait_seconds: 0 });

            expect(secondPoll.status).toBe(204);

            // And the job nobody took is still queued, ready for a machine that
            // has room.
            const [waiting] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: second.jobs[0].id });

            expect(waiting.state).toBe('queued');
        } finally {
            await global.api.post(`/api/v2/gpu/jobs/${first.jobs[0].id}/cancel`);
            await global.api.post(`/api/v2/gpu/jobs/${second.jobs[0].id}/cancel`);
            // End this machine's lease so it cannot expire later and put its job
            // back in the queue underneath a later test. The machine itself goes
            // in afterAll, once its attempts have gone with their jobs.
            await db.sequelize.query(
                'UPDATE gpu_job_attempts SET state = \'abandoned\', finished_at = NOW() WHERE worker_id = :oneSlot',
                { replacements: { oneSlot } }
            );
        }
    });

    it('does not hand work to a paused machine', async () => {
        const submitted = await submitJob();

        await db.sequelize.query('UPDATE gpu_workers SET state = \'paused\' WHERE id = :workerId', {
            replacements: { workerId },
        });

        try {
            const polled = await pollOnce();

            expect(polled.status).toBe(204);
        } finally {
            await db.sequelize.query('UPDATE gpu_workers SET state = \'online\' WHERE id = :workerId', {
                replacements: { workerId },
            });
        }

        // The job is still queued, untouched by the poll it was not given to.
        const [job] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: submitted.jobs[0].id });

        expect(job.state).toBe('queued');

        await global.api.post(`/api/v2/gpu/jobs/${submitted.jobs[0].id}/cancel`);
    });
});

/**
 * The heartbeat: progress in, and the only control channel MARP has out.
 */
describe('GPU heartbeat', () => {
    it('extends the lease, records progress, and says continue', async () => {
        const { lease } = await submitAndLease();

        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                state: 'running',
                progress: { done: 40, total: 100, unit: 'frames' },
            });

        expect(beat.status).toBe(200);
        expect(beat.body.action).toBe('continue');
        expect(new Date(beat.body.lease_expires_at).getTime())
            .toBeGreaterThan(new Date(lease.lease_expires_at).getTime() - 1000);

        const [attempt] = await query(
            'SELECT state, progress_done, progress_total, progress_unit, last_heartbeat_at FROM gpu_job_attempts WHERE id = :id',
            { id: lease.attempt_id }
        );

        expect(attempt.state).toBe('running');
        expect(attempt.progress_done).toBe(40);
        expect(attempt.progress_total).toBe(100);
        expect(attempt.progress_unit).toBe('frames');
        expect(attempt.last_heartbeat_at).not.toBeNull();
    });

    it('refuses a worker that claims a stale lease epoch, and writes nothing', async () => {
        const { lease } = await submitAndLease();

        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch + 7, progress: { done: 999 } });

        expect(beat.status).toBe(200);
        expect(beat.body.action).toBe('abandon');
        expect(beat.body.reason).toMatch(/stale/);
        expect(beat.body.lease_expires_at).toBeNull();

        const [attempt] = await query(
            'SELECT progress_done, last_heartbeat_at FROM gpu_job_attempts WHERE id = :id',
            { id: lease.attempt_id }
        );

        // The point of the refusal: a stale caller cannot move a job's progress.
        expect(attempt.progress_done).toBeNull();
        expect(attempt.last_heartbeat_at).toBeNull();
    });

    it('refuses a worker claiming another machine\'s attempt', async () => {
        const { lease } = await submitAndLease();

        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: workerId + 100000, lease_epoch: lease.lease_epoch });

        expect(beat.status).toBe(200);
        expect(beat.body.action).toBe('abandon');
        expect(beat.body.reason).toMatch(/another worker/);
    });

    it('will not let a worker declare itself succeeded', async () => {
        const { lease } = await submitAndLease();

        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, state: 'succeeded' });

        expect(beat.status).toBe(400);
        expect(beat.body.error.message).toMatch(/result route/);
    });

    it('delivers a cancel through the heartbeat, and only through the heartbeat', async () => {
        const { job, lease } = await submitAndLease();

        const cancelled = await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);

        expect(cancelled.status).toBe(200);
        expect(cancelled.body.changed).toBe(true);
        expect(cancelled.body.job.state).toBe('cancelled');

        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, state: 'running', progress: { done: 5 } });

        expect(beat.body.action).toBe('cancel');
        // Still extended, so the machine has time to wind down and report back
        // rather than being declared expired mid-shutdown.
        expect(beat.body.lease_expires_at).not.toBeNull();

        const [attempt] = await query('SELECT progress_done FROM gpu_job_attempts WHERE id = :id', { id: lease.attempt_id });

        expect(attempt.progress_done).toBe(5);
    });

    it('delivers a pause to a machine that has been paused', async () => {
        const { lease } = await submitAndLease();

        await db.sequelize.query('UPDATE gpu_workers SET state = \'paused\' WHERE id = :workerId', {
            replacements: { workerId },
        });

        try {
            const beat = await global.api
                .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
                .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, state: 'running' });

            expect(beat.body.action).toBe('pause');
        } finally {
            await db.sequelize.query('UPDATE gpu_workers SET state = \'online\' WHERE id = :workerId', {
                replacements: { workerId },
            });
        }
    });

    it('takes the lease back from an attempt that has run past the per-attempt cap', async () => {
        const { job, lease } = await submitAndLease();

        // The coordinator's clock is what decides this, so moving when the lease
        // started is exactly the situation a very long attempt produces.
        await db.sequelize.query(
            'UPDATE gpu_job_attempts SET leased_at = NOW() - INTERVAL \'25 hours\' WHERE id = :id',
            { replacements: { id: lease.attempt_id } }
        );

        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, state: 'running' });

        expect(beat.body.action).toBe('abandon');
        expect(beat.body.reason).toMatch(/cap/);

        const [attempt] = await query('SELECT state FROM gpu_job_attempts WHERE id = :id', { id: lease.attempt_id });
        const [after] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: job.id });

        expect(attempt.state).toBe('abandoned');
        // Attempts remain, so the work goes back in the queue rather than dying.
        expect(after.state).toBe('queued');

        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);
    });
});

/**
 * The event stream, and its replay safety.
 */
describe('GPU attempt events', () => {
    it('accepts a batch, and treats a replay of it as duplicates rather than new events', async () => {
        const { lease } = await submitAndLease();

        const batch = {
            worker_id: workerId,
            lease_epoch: lease.lease_epoch,
            events: [
                { seq: 0, kind: 'log', at: new Date().toISOString(), payload: { line: 'starting' } },
                { seq: 1, kind: 'metric', payload: { frames_per_second: 41.2 } },
            ],
        };

        const first = await global.api.post(`/api/v2/gpu/attempts/${lease.attempt_id}/events`).send(batch);

        expect(first.status).toBe(200);
        expect(first.body.accepted).toBe(2);
        expect(first.body.duplicates).toBe(0);
        expect(first.body.next_seq).toBe(2);

        const again = await global.api.post(`/api/v2/gpu/attempts/${lease.attempt_id}/events`).send(batch);

        expect(again.status).toBe(200);
        expect(again.body.accepted).toBe(0);
        expect(again.body.duplicates).toBe(2);
        expect(again.body.next_seq).toBe(2);

        const [counted] = await query(
            'SELECT COUNT(*)::int AS n FROM gpu_job_events WHERE attempt_id = :id AND seq >= 0',
            { id: lease.attempt_id }
        );

        expect(counted.n).toBe(2);
    });

    it('refuses a batch from a stale lease, and writes none of it', async () => {
        const { lease } = await submitAndLease();

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/events`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch + 3,
                events: [{ seq: 0, kind: 'log', payload: { line: 'from a stale worker' } }],
            });

        expect(response.status).toBe(200);
        expect(response.body.action).toBe('abandon');
        expect(response.body.accepted).toBe(0);

        const [counted] = await query(
            'SELECT COUNT(*)::int AS n FROM gpu_job_events WHERE attempt_id = :id',
            { id: lease.attempt_id }
        );

        expect(counted.n).toBe(0);
    });

    it('refuses the coordinator\'s own event kind and its own sequence numbers', async () => {
        const { lease } = await submitAndLease();

        const asNote = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/events`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                events: [{ seq: 0, kind: 'note', payload: {} }],
            });

        expect(asNote.status).toBe(400);

        const negative = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/events`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                events: [{ seq: -1, kind: 'log', payload: {} }],
            });

        expect(negative.status).toBe(400);
    });
});

/**
 * The artifact hand-off, which is addressed by content rather than by sender.
 */
describe('GPU artifact hand-off', () => {
    it('answers already_have false, accepts the bytes, then answers already_have true', async () => {
        const { lease } = await submitAndLease();

        const bytes = Buffer.from(JSON.stringify({ detections: [{ frame: 0, boxes: [] }] }));
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        stagedHashes.push(sha256);

        const before = await global.api
            .post('/api/v2/gpu/artifacts/check')
            .send({ sha256, bytes: bytes.length });

        expect(before.status).toBe(200);
        expect(before.body.already_have).toBe(false);
        expect(before.body.upload_url).toBe(`/api/v2/gpu/artifacts/upload/${sha256}`);

        const uploaded = await global.api
            .post(`${before.body.upload_url}?attempt_id=${lease.attempt_id}`)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes);

        expect(uploaded.status).toBe(200);
        expect(uploaded.body.sha256).toBe(sha256);
        expect(uploaded.body.bytes).toBe(bytes.length);
        expect(uploaded.body.content_type).toBe('application/octet-stream');

        // The bytes are on disk, not in the database.
        expect(fs.existsSync(path.join(ARTIFACT_DIRECTORY, sha256))).toBe(true);

        const after = await global.api
            .post('/api/v2/gpu/artifacts/check')
            .send({ sha256, bytes: bytes.length });

        expect(after.body.already_have).toBe(true);
        expect(after.body.upload_url).toBeNull();

        // A second upload of the same bytes is not an error: they are the same
        // artifact, so the answer is the same.
        const twice = await global.api
            .post(`/api/v2/gpu/artifacts/upload/${sha256}`)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes);

        expect(twice.status).toBe(200);
    });

    it('keeps nothing when the bytes do not hash to the sha256 in the path', async () => {
        const claimed = crypto.createHash('sha256').update('not what is sent').digest('hex');

        const response = await global.api
            .post(`/api/v2/gpu/artifacts/upload/${claimed}`)
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from('something else entirely'));

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/hash to/);

        expect(fs.existsSync(path.join(ARTIFACT_DIRECTORY, claimed))).toBe(false);

        const [staged] = await query('SELECT COUNT(*)::int AS n FROM gpu_artifacts_staging WHERE sha256 = :sha256', { sha256: claimed });

        expect(staged.n).toBe(0);
    });

    it('refuses a hash that is not 64 lower-case hexadecimal characters', async () => {
        const response = await global.api
            .post('/api/v2/gpu/artifacts/check')
            .send({ sha256: 'A'.repeat(64) });

        expect(response.status).toBe(400);
    });
});

/**
 * The terminal result: idempotent, guarded, and recorded in the existing
 * artifacts table.
 */
describe('GPU attempt result', () => {
    it('records a success as an artifact belonging to the job rather than to a training run', async () => {
        const { job, lease } = await submitAndLease();

        const bytes = Buffer.from(`detections for job ${job.id}`);
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        stagedHashes.push(sha256);

        await global.api
            .post(`/api/v2/gpu/artifacts/upload/${sha256}?attempt_id=${lease.attempt_id}`)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes);

        const reported = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'succeeded',
                artifacts: [{ sha256, role: 'detections' }],
            });

        expect(reported.status).toBe(200);
        expect(reported.body.published).toBe(true);
        expect(reported.body.job_state).toBe('succeeded');
        expect(reported.body.artifacts_recorded).toBe(1);

        const detail = await global.api.get(`/api/v2/gpu/jobs/${job.id}`);

        expect(detail.status).toBe(200);
        expect(detail.body.job.published_attempt_id).toBe(lease.attempt_id);
        expect(detail.body.artifacts).toHaveLength(1);

        // The whole point of making training_run_id nullable: an inference
        // result has no training run behind it and now has somewhere to live.
        expect(detail.body.artifacts[0].training_run_id).toBeNull();
        expect(detail.body.artifacts[0].job_id).toBe(job.id);
        expect(detail.body.artifacts[0].hash).toBe(sha256);
        expect(detail.body.artifacts[0].artifact_type).toBe('detections');
    });

    it('answers a replayed terminal report from the stored rows, without a second result', async () => {
        const { job, lease } = await submitAndLease();

        const first = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, outcome: 'succeeded' });

        expect(first.body.idempotent).toBe(false);
        expect(first.body.published).toBe(true);

        const again = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, outcome: 'succeeded' });

        expect(again.status).toBe(200);
        expect(again.body.idempotent).toBe(true);
        expect(again.body.outcome).toBe('succeeded');
        expect(again.body.published_attempt_id).toBe(lease.attempt_id);

        const [attempts] = await query(
            'SELECT COUNT(*)::int AS n FROM gpu_job_attempts WHERE job_id = :id',
            { id: job.id }
        );

        expect(attempts.n).toBe(1);
    });

    it('requeues the job on a failure while attempts remain, and fails it when they run out', async () => {
        const { job, lease } = await submitAndLease({ max_attempts: 2 });

        const firstFailure = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'failed',
                failure_reason: 'CUDA out of memory at frame 12.',
            });

        expect(firstFailure.body.job_state).toBe('queued');

        const second = await pollOnce();

        expect(second.status).toBe(200);
        expect(second.body.job_id).toBe(job.id);
        expect(second.body.lease_epoch).toBe(2);

        const secondFailure = await global.api
            .post(`/api/v2/gpu/attempts/${second.body.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: 2,
                outcome: 'failed',
                failure_reason: 'CUDA out of memory again.',
            });

        expect(secondFailure.body.job_state).toBe('failed');

        const detail = await global.api.get(`/api/v2/gpu/jobs/${job.id}`);

        // Two attempts, each keeping its own account of what went wrong: a retry
        // does not overwrite the record of the first failure.
        expect(detail.body.attempts).toHaveLength(2);
        expect(detail.body.attempts[0].failure_reason).toMatch(/frame 12/);
        expect(detail.body.attempts[1].failure_reason).toMatch(/again/);
    });

    it('does not let a success reported after a cancel resurrect the job', async () => {
        const { job, lease } = await submitAndLease();

        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);

        const reported = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, outcome: 'succeeded' });

        expect(reported.status).toBe(200);
        expect(reported.body.published).toBe(false);
        expect(reported.body.job_state).toBe('cancelled');

        const [after] = await query('SELECT state, published_attempt_id FROM gpu_jobs WHERE id = :id', { id: job.id });

        expect(after.state).toBe('cancelled');
        expect(after.published_attempt_id).toBeNull();

        // The attempt still records that it succeeded: what the machine did is
        // not in dispute, only what the job is.
        const [attempt] = await query('SELECT state FROM gpu_job_attempts WHERE id = :id', { id: lease.attempt_id });

        expect(attempt.state).toBe('succeeded');
    });

    it('refuses a result naming an artifact that was never handed over', async () => {
        const { lease } = await submitAndLease();

        const response = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'succeeded',
                artifacts: [{ sha256: 'b'.repeat(64), role: 'detections' }],
            });

        expect(response.status).toBe(409);
        expect(response.body.error.message).toMatch(/has not been handed over/);
    });
});

/**
 * Expiry, which is judged on the coordinator's clock and nothing else.
 */
describe('GPU lease expiry', () => {
    it('returns an expired lease\'s job to the queue and tells the old worker to abandon', async () => {
        const { job, lease } = await submitAndLease();

        // What a missed heartbeat leaves behind. The comparison under test is
        // lease_expires_at against the coordinator's NOW(), so moving the
        // expiry is the same situation as waiting for it.
        await db.sequelize.query(
            'UPDATE gpu_job_attempts SET lease_expires_at = NOW() - INTERVAL \'1 minute\' WHERE id = :id',
            { replacements: { id: lease.attempt_id } }
        );

        const second = await pollOnce();

        expect(second.status).toBe(200);
        expect(second.body.job_id).toBe(job.id);
        expect(second.body.lease_epoch).toBe(2);
        expect(second.body.attempt_id).not.toBe(lease.attempt_id);

        const [old] = await query(
            'SELECT state, failure_reason, finished_at FROM gpu_job_attempts WHERE id = :id',
            { id: lease.attempt_id }
        );

        expect(old.state).toBe('abandoned');
        expect(old.failure_reason).toMatch(/Lease expired/);
        expect(old.finished_at).not.toBeNull();

        // The coordinator records why it took the lease away, on a negative
        // sequence number so it can never collide with a worker's own events.
        const [note] = await query(
            'SELECT seq, kind, payload FROM gpu_job_events WHERE attempt_id = :id ORDER BY seq ASC LIMIT 1',
            { id: lease.attempt_id }
        );

        expect(note.seq).toBeLessThan(0);
        expect(note.kind).toBe('note');
        expect(note.payload.note).toBe('lease expired');

        // The resurrected worker: still holding what it thinks is a good lease,
        // and told to abandon rather than allowed to touch the job.
        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, state: 'running', progress: { done: 90 } });

        expect(beat.body.action).toBe('abandon');

        const result = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, outcome: 'succeeded' });

        expect(result.body.action).toBe('abandon');
        expect(result.body.accepted).toBe(false);

        // And the job it lost is unaffected by any of that.
        const [current] = await query('SELECT state, published_attempt_id FROM gpu_jobs WHERE id = :id', { id: job.id });

        expect(current.state).toBe('leased');
        expect(current.published_attempt_id).toBeNull();

        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);
    });
});

/**
 * The pool view a dashboard reads.
 */
describe('GPU pool view', () => {
    it('shows the machine, its hardware, and the job it is running', async () => {
        const { job, lease } = await submitAndLease();

        await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                state: 'running',
                progress: { done: 12, total: 100, unit: 'frames' },
            });

        const pool = await global.api.get('/api/v2/gpu/workers');

        expect(pool.status).toBe(200);

        const mine = pool.body.find((worker) => worker.worker_id === workerId);

        expect(mine).toBeDefined();
        expect(mine.activity).toBe('busy');
        expect(mine.capabilities.gpus[0].name).toMatch(/^jest-gpu/);
        expect(mine.last_seen_at).not.toBeNull();
        // The suite leaves earlier tests' leases open, so this machine holds
        // several live attempts; the one under test is found by its job rather
        // than by being the only one.
        const running = mine.attempts.find((attempt) => attempt.job.job_id === job.id);

        expect(running).toBeDefined();
        expect(running.state).toBe('running');
        expect(running.progress).toEqual({ done: 12, total: 100, unit: 'frames' });

        // Nothing in the pool view can say where a machine is, because nothing
        // in the schema can. This is the assertion that would fail if somebody
        // added a host column and started returning it.
        const serialised = JSON.stringify(mine);

        expect(serialised).not.toMatch(/"(host|hostname|url|ip|address|port)"/i);

        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);

        const idle = await global.api.get('/api/v2/gpu/workers');

        // Cancelling does not free the machine: the attempt is live until the
        // worker reports back, which is exactly what "the coordinator's row is
        // the truth about the job, not about the machine" means.
        expect(idle.body.find((worker) => worker.worker_id === workerId).activity).toBe('busy');
    });
});

/**
 * A machine is renameable because its identity is the durable id it generated
 * for itself, not what it is called.
 *
 * These tests use their own machines rather than the suite's, because renaming
 * the one every other test polls with would make those tests depend on the order
 * this block runs in.
 */
describe('GPU worker rename', () => {
    /**
     * Enrol a machine of this block's own, and remember it for teardown.
     *
     * @param {string} localId - Its durable id.
     * @param {string} name - What to call it.
     * @returns {Promise<Object>} The enrolment response body.
     */
    async function enrol(localId, name) {
        const response = await global.api
            .post('/api/v2/gpu/workers/enrol')
            .send({ local_id: localId, name, slot_count: 1 });

        expect(response.status).toBe(200);

        if (!extraWorkerIds.includes(response.body.worker_id)) {
            extraWorkerIds.push(response.body.worker_id);
        }

        return response.body;
    }

    it('keeps the new name when the machine enrols again, and stays one row', async () => {
        const localId = `jest-rename-local-${runId}`;
        const enrolled = await enrol(localId, `jest-rename-before-${runId}`);

        const renamed = await global.api
            .post(`/api/v2/gpu/workers/${enrolled.worker_id}/rename`)
            .send({ name: `jest-rename-after-${runId}` });

        expect(renamed.status).toBe(200);
        expect(renamed.body.worker_id).toBe(enrolled.worker_id);
        expect(renamed.body.name).toBe(`jest-rename-after-${runId}`);

        // The machine restarting. A worker computes its name at startup and sends
        // it every time, so this is the enrolment that used to undo the rename --
        // and, when the name was the key, the one that forked the row.
        const again = await enrol(localId, `jest-rename-before-${runId}`);

        expect(again.worker_id).toBe(enrolled.worker_id);
        expect(again.name).toBe(`jest-rename-after-${runId}`);

        const [count] = await query(
            'SELECT COUNT(*)::int AS n FROM gpu_workers WHERE local_id = :localId',
            { localId }
        );

        expect(count.n).toBe(1);

        const [row] = await query('SELECT name FROM gpu_workers WHERE local_id = :localId', { localId });

        expect(row.name).toBe(`jest-rename-after-${runId}`);
    });

    it('gives two machines that share a name a row each', async () => {
        const shared = `jest-rename-shared-${runId}`;

        const first = await enrol(`jest-rename-twin-a-${runId}`, shared);
        const second = await enrol(`jest-rename-twin-b-${runId}`, shared);

        expect(second.worker_id).not.toBe(first.worker_id);

        const [count] = await query(
            'SELECT COUNT(*)::int AS n FROM gpu_workers WHERE name = :shared',
            { shared }
        );

        expect(count.n).toBe(2);
    });

    it('does not disturb a live lease', async () => {
        const worker = await enrol(`jest-rename-busy-local-${runId}`, `jest-rename-busy-${runId}`);
        const submitted = await submitJob();
        const job = submitted.jobs[0];

        const polled = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: worker.worker_id, slot_indexes: [0], wait_seconds: 0 });

        expect(polled.status).toBe(200);
        expect(polled.body.job_id).toBe(job.id);

        const lease = polled.body;

        const renamed = await global.api
            .post(`/api/v2/gpu/workers/${worker.worker_id}/rename`)
            .send({ name: `jest-rename-busy-renamed-${runId}` });

        expect(renamed.status).toBe(200);

        // The machine re-enrols mid-job, which is the moment the old design broke:
        // keyed on the name, this enrolment found nothing called
        // `jest-rename-busy-<runId>` any more and opened a second row, leaving the
        // first one holding the lease. The worker would then heartbeat as the new
        // machine and be told the attempt belongs to somebody else.
        const again = await enrol(`jest-rename-busy-local-${runId}`, `jest-rename-busy-${runId}`);

        expect(again.worker_id).toBe(worker.worker_id);

        // The lease is quoted as (attempt_id, worker_id, lease_epoch), and neither
        // the rename nor the re-enrolment moves any of those. If either did, this
        // heartbeat would be answered `abandon` and the machine would throw away
        // work it is halfway through.
        const beat = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/heartbeat`)
            .send({
                worker_id: again.worker_id,
                lease_epoch: lease.lease_epoch,
                state: 'running',
                progress: { done: 7, total: 100, unit: 'frames' },
            });

        expect(beat.status).toBe(200);
        expect(beat.body.action).toBe('continue');

        const [attempt] = await query(
            'SELECT worker_id, lease_epoch, state, progress_done FROM gpu_job_attempts WHERE id = :id',
            { id: lease.attempt_id }
        );

        expect(attempt.worker_id).toBe(worker.worker_id);
        expect(attempt.lease_epoch).toBe(lease.lease_epoch);
        expect(attempt.state).toBe('running');
        expect(attempt.progress_done).toBe(7);

        const [current] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: job.id });

        expect(current.state).toBe('leased');

        // And the pool shows the new name against the same machine and the same
        // attempt -- one row renamed, not a second row with the work on the first.
        const pool = await global.api.get('/api/v2/gpu/workers');
        const mine = pool.body.find((entry) => entry.worker_id === worker.worker_id);

        expect(mine.name).toBe(`jest-rename-busy-renamed-${runId}`);
        expect(mine.attempts.map((entry) => entry.attempt_id)).toEqual([lease.attempt_id]);

        // The durable id is the identity and is kept out of every response, so a
        // reader of the pool cannot learn the value a re-enrolment keys on.
        expect(Object.keys(mine)).not.toContain('local_id');

        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`);
    });

    it('refuses an empty name, and 404s an unknown machine', async () => {
        const worker = await enrol(`jest-rename-refusal-local-${runId}`, `jest-rename-refusal-${runId}`);

        const empty = await global.api
            .post(`/api/v2/gpu/workers/${worker.worker_id}/rename`)
            .send({ name: '   ' });

        expect(empty.status).toBe(400);
        expect(empty.body.error.code).toBe('VALIDATION_ERROR');

        const missing = await global.api
            .post('/api/v2/gpu/workers/0/rename')
            .send({ name: `jest-rename-nobody-${runId}` });

        expect(missing.status).toBe(404);

        // The name it already had is untouched by either refusal.
        const [row] = await query('SELECT name FROM gpu_workers WHERE id = :id', { id: worker.worker_id });

        expect(row.name).toBe(`jest-rename-refusal-${runId}`);
    });
});
