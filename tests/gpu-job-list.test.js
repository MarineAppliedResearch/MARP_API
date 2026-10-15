/**
 * What `GET /gpu/jobs` can be asked, and what it answers (#104, gaps 23 to 26).
 *
 * Over HTTP rather than through the service, because the half of this that can
 * be wrong is the query string: the service receives values somebody already
 * parsed, and the route is where `finished_after=last%20tuesday` actually
 * arrives. A service-level test would pass on a route that never read the
 * parameter at all.
 *
 * **Everything here seeds its own rows and searches for them by a marker unique
 * to the run.** The development database holds thousands of real jobs; a test
 * that asserted "the first page is sorted" over all of them would be asserting
 * something about somebody else's data, and would start failing the day an
 * inference run finished at an awkward moment.
 *
 * @fileoverview Route tests for the job list's progress, date range, sort and search.
 * @author Isaac Travers
 * @module tests/gpu-job-list
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run, and the thing every query here narrows by. @type {string} */
const marker = `joblist-${Date.now()}`;

/** Job ids created here, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/** Attempt ids created here, removed before the jobs. @type {Array<number>} */
const createdAttemptIds = [];

/** Worker ids created here, removed in afterAll. @type {Array<number>} */
const createdWorkerIds = [];

/**
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Submit one job through the route, so the name is validated the way a caller's
 * would be.
 *
 * @param {Object} options
 * @param {string} [options.name] - The job's name, omitted entirely when absent.
 * @param {string} options.sourceName - The video's source name.
 * @param {number} [options.pieceFrames] - Splits into a batch when given.
 * @returns {Promise<Object>} The route's response body.
 */
async function submit({ name, sourceName, pieceFrames }) {
    const body = {
        kind: 'inference',
        spec: {
            engine: 'ultralytics',
            model: { name: `${marker}-model`, sha256: 'd'.repeat(64) },
            video: { url: `http://jest.invalid/${marker}.mp4`, source_name: sourceName },
            range: { start_frame: 0, end_frame: 300 },
            reduction: { name: 'v3_dirpad', version: 1 },
        },
    };

    if (name !== undefined) body.name = name;
    if (pieceFrames !== undefined) body.piece_frames = pieceFrames;

    const response = await global.api.post('/api/v2/gpu/jobs').send(body);

    if (response.status === 200) {
        for (const job of response.body.jobs) createdJobIds.push(job.id);

        /* Taken out of the queue immediately. Nothing here asserts a job's
           state, and a queued job is one the coordinator may hand to a real
           worker -- when the whole GPU group runs, another suite's poll leased
           these and changed the rows underneath the assertions. Cancelled is
           terminal, so no poll will touch them. */
        await db.sequelize.query(
            "UPDATE gpu_jobs SET state = 'cancelled' WHERE id IN (:ids)",
            { replacements: { ids: response.body.jobs.map((job) => job.id) } }
        );
    }

    return response;
}

/**
 * Put an attempt on a job directly, rather than driving a real lease.
 *
 * These tests are about a read. Leasing a job for real would need a worker
 * polling, a slot, and a lease epoch, none of which this is testing, and would
 * make the progress numbers whatever the lease happened to produce rather than
 * the ones the assertion needs.
 *
 * @param {number} jobId - The job.
 * @param {number} workerId - The machine.
 * @param {Object} progress - `{done, total, unit, phase, elapsed_s}`.
 * @param {string} [state] - Attempt state; terminal by default.
 * @param {number} [leaseEpoch] - Which lease this was. `(job_id, lease_epoch)` is
 *   unique, which is the real model -- a job gets one attempt per lease -- so a
 *   second attempt at the same job has to say it is the second.
 * @returns {Promise<number>} The attempt's id.
 */
async function attemptOn(jobId, workerId, progress, state = 'succeeded', leaseEpoch = 1) {
    const [row] = await query(
        `INSERT INTO gpu_job_attempts
                (job_id, worker_id, slot_index, lease_epoch, state, leased_at,
                 lease_expires_at, last_heartbeat_at, progress_done, progress_total,
                 progress_unit, progress_phase, progress_elapsed_s)
         VALUES (:jobId, :workerId, 0, :leaseEpoch, :state, NOW(),
                 NOW() + INTERVAL '1 hour', NOW(), :done, :total, :unit, :phase, :elapsed)
         RETURNING id`,
        {
            jobId,
            workerId,
            state,
            leaseEpoch,
            done: progress.done,
            total: progress.total,
            unit: progress.unit,
            phase: progress.phase,
            elapsed: progress.elapsed_s,
        }
    );

    createdAttemptIds.push(row.id);

    return row.id;
}

/**
 * Ask the list, always narrowed to this run's rows.
 *
 * @param {Object} [params] - Extra query parameters.
 * @returns {Promise<Object>} The supertest response.
 */
function list(params = {}) {
    return global.api.get('/api/v2/gpu/jobs').query({ search: marker, limit: 50, ...params });
}

beforeAll(async () => {
    const [worker] = await query(
        `INSERT INTO gpu_workers (local_id, name, state, slot_count, enrolled_at)
         VALUES (:localId, :name, 'online', 1, NOW())
         RETURNING id`,
        { localId: `${marker}-local`, name: `${marker}-worker` }
    );

    createdWorkerIds.push(worker.id);
});

afterAll(async () => {
    /* Taken down by what belongs to this suite's jobs rather than by what the
       suite remembers creating, because the API creates rows of its own on the
       way past -- attempts carry `gpu_job_events`, and those hold the foreign
       key that makes a job undeletable. Tracking ids by hand missed them, the
       delete failed, and the corpus guard reported every row left behind.
       Inside out: events, then attempts, then jobs. */
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

    /* Connection left open deliberately: the corpus guard counts the tables
       again after this file finishes. */
});

describe('R1 — the list carries progress', () => {
    test('a job with no attempt has nulls, not zeroes', async () => {
        const submitted = await submit({ name: `${marker} untried`, sourceName: `${marker}-a` });
        expect(submitted.status).toBe(200);

        const response = await list({ search: `${marker} untried` });
        const [job] = response.body.jobs;

        expect(job.progress_done).toBeNull();
        expect(job.progress_total).toBeNull();
        expect(job.progress_phase).toBeNull();

        /* The distinction the Jobs screen draws a dash for. A zero here would
           render as a 0% bar, which claims the job has started and got nowhere. */
        expect(job.progress_done).not.toBe(0);
    });

    test('progress comes from the latest attempt, not the first', async () => {
        const submitted = await submit({ name: `${marker} retried`, sourceName: `${marker}-b` });
        const jobId = submitted.body.jobs[0].id;
        const workerId = createdWorkerIds[0];

        await attemptOn(jobId, workerId, { done: 11, total: 300, unit: 'frames', phase: 'first', elapsed_s: 5 }, 'failed', 1);
        await attemptOn(jobId, workerId, { done: 222, total: 300, unit: 'frames', phase: 'second', elapsed_s: 90 }, 'succeeded', 2);

        const response = await list({ search: `${marker} retried` });
        const [job] = response.body.jobs;

        expect(job.progress_done).toBe(222);
        expect(job.progress_phase).toBe('second');
        expect(job.progress_elapsed_s).toBe(90);
    });

    test('the five fields carry the attempt\'s own names', async () => {
        const response = await list({ search: `${marker} retried` });
        const [job] = response.body.jobs;

        expect(Object.keys(job)).toEqual(expect.arrayContaining([
            'progress_done', 'progress_total', 'progress_unit', 'progress_phase', 'progress_elapsed_s',
        ]));
    });
});

describe('R2 — the list can be asked about time', () => {
    /** Two fixed instants, a day apart, neither near now. @type {Object} */
    const WHEN = {
        early: '2026-03-01T00:00:00.000Z',
        late: '2026-03-02T00:00:00.000Z',
    };

    beforeAll(async () => {
        const early = await submit({ name: `${marker} early`, sourceName: `${marker}-early` });
        const late = await submit({ name: `${marker} late`, sourceName: `${marker}-late` });

        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'succeeded', created_at = :when, finished_at = :when
              WHERE id = :id`,
            { replacements: { id: early.body.jobs[0].id, when: WHEN.early } }
        );

        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'succeeded', created_at = :when, finished_at = :when
              WHERE id = :id`,
            { replacements: { id: late.body.jobs[0].id, when: WHEN.late } }
        );
    });

    test('a window narrows the total rather than just the page', async () => {
        const everything = await list({ search: `${marker} ` });
        const windowed = await list({
            search: `${marker} `,
            finished_after: WHEN.early,
            finished_before: WHEN.late,
        });

        expect(windowed.body.total).toBe(1);
        expect(windowed.body.total).toBeLessThan(everything.body.total);
        expect(windowed.body.jobs[0].name).toBe(`${marker} early`);
    });

    test('the window is half-open, so adjacent windows do not both claim a job', async () => {
        const first = await list({ search: `${marker} `, finished_after: WHEN.early, finished_before: WHEN.late });
        const second = await list({ search: `${marker} `, finished_after: WHEN.late });

        const firstIds = first.body.jobs.map((job) => job.id);
        const secondIds = second.body.jobs.map((job) => job.id);

        expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
        expect(secondIds.length).toBeGreaterThan(0);
    });

    test('a date that is not a date is a 400', async () => {
        const response = await list({ finished_after: 'last tuesday' });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/ISO 8601/);
    });
});

describe('R3 — a job can be named', () => {
    test('every piece of a split batch carries the same name', async () => {
        const response = await submit({
            name: `${marker} split`,
            sourceName: `${marker}-split`,
            pieceFrames: 100,
        });

        expect(response.status).toBe(200);
        expect(response.body.jobs.length).toBeGreaterThan(1);

        const names = response.body.jobs.map((job) => job.name);
        expect(new Set(names)).toEqual(new Set([`${marker} split`]));
    });

    test('a job submitted without a name has none, and MARP composes nothing', async () => {
        const response = await submit({ sourceName: `${marker}-nameless` });

        expect(response.status).toBe(200);
        expect(response.body.jobs[0].name).toBeNull();
    });

    test('an over-long name is a 400 rather than a database error', async () => {
        const response = await submit({ name: 'x'.repeat(256), sourceName: `${marker}-long` });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/255 characters or fewer/);
    });

    test('a named job is found by searching for its name', async () => {
        const response = await list({ search: `${marker} split` });

        expect(response.body.total).toBeGreaterThan(0);
        for (const job of response.body.jobs) {
            expect(job.name).toBe(`${marker} split`);
        }
    });
});

describe('R4 — the list sorts and searches', () => {
    test('sorting ascending and descending reverse each other', async () => {
        const ascending = await list({ sort: 'created_at', direction: 'asc' });
        const descending = await list({ sort: 'created_at', direction: 'desc' });

        const up = ascending.body.jobs.map((job) => job.id);
        const down = descending.body.jobs.map((job) => job.id);

        expect(up.length).toBeGreaterThan(1);
        expect(up).toEqual([...down].reverse());
    });

    test('page two continues page one rather than re-sorting within the page', async () => {
        const size = 2;
        const first = await list({ sort: 'created_at', direction: 'asc', limit: size, offset: 0 });
        const second = await list({ sort: 'created_at', direction: 'asc', limit: size, offset: size });

        expect(first.body.jobs.length).toBe(size);
        expect(second.body.jobs.length).toBeGreaterThan(0);

        /* The defect this is for: sorting only the rows on the page looks
           identical to a correct sort until you turn it. */
        const lastOfFirst = new Date(first.body.jobs[size - 1].created_at).getTime();
        const firstOfSecond = new Date(second.body.jobs[0].created_at).getTime();

        expect(lastOfFirst).toBeLessThanOrEqual(firstOfSecond);
    });

    test('nulls sort last, so an unnamed job does not head the list', async () => {
        const response = await list({ sort: 'name', direction: 'asc' });
        const names = response.body.jobs.map((job) => job.name);
        const firstNull = names.indexOf(null);

        if (firstNull !== -1) {
            expect(names.slice(firstNull).every((name) => name === null)).toBe(true);
        }
    });

    test('an unknown sort key is a 400, not a silent fallback', async () => {
        const response = await list({ sort: 'progress' });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/sort must be one of/);
    });

    test('search matches the video source name as well as the job name', async () => {
        const response = await list({ search: `${marker}-nameless` });

        expect(response.body.total).toBe(1);
        expect(response.body.jobs[0].name).toBeNull();
        expect(response.body.jobs[0].spec.video.source_name).toBe(`${marker}-nameless`);
    });

    test('search matches a batch id', async () => {
        const split = await list({ search: `${marker} split`, limit: 1 });
        const batchId = split.body.jobs[0].batch_id;

        expect(batchId).not.toBeNull();

        const response = await global.api.get('/api/v2/gpu/jobs').query({ search: batchId });

        expect(response.body.total).toBeGreaterThan(1);
    });

    test('a search that should miss, misses', async () => {
        const response = await global.api
            .get('/api/v2/gpu/jobs')
            .query({ search: `${marker}-no-such-thing` });

        expect(response.body.total).toBe(0);
        expect(response.body.jobs).toEqual([]);
    });
});
