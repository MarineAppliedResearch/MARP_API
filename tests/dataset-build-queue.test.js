/**
 * Tests for queueing a dataset build, and for who is allowed to run one.
 *
 * `POST /api/v2/dataset/build` answers immediately and leaves two rows behind: the
 * dataset the Datasets screen will show as building, and the `gpu_jobs` row that is the
 * record of the build itself. Both halves matter and neither is visible from the other --
 * a dataset with no job says `building` for ever, and a job with no dataset has nothing
 * to write into -- so the pairing is what these assert rather than either row alone.
 *
 * **The claim tripwire is the reason this file is at this tier.** R2 says the API runs a
 * build and the pool never sees one, and the only thing enforcing that is
 * `LEASABLE_JOB_KINDS` being a different list from `JOB_KINDS`. Adding `dataset_build` to
 * the wrong one is a one-word edit that nothing else would notice: a worker would lease
 * a build, have no video access to run it, and burn one of its three attempts failing.
 * Nothing below a real poll against a real queue can see that, because the whole
 * mechanism is the SQL the claim is built from.
 *
 * Everything here is seeded by the file and removed again -- `tests/setup/corpus-guard.js`
 * fails the file otherwise, and a dataset row left behind would show up in the ML
 * Dashboard as a real dataset somebody has to explain.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Endpoint tests for POST /api/v2/dataset/build and the claim rule.
 * @author Isaac Travers
 * @module tests/dataset-build-queue
 */

const db = require('../model');

const { QueryTypes } = db.Sequelize;

/** The route, at the version everything is actually served at. */
const BUILD = '/api/v2/dataset/build';

/** The path the route is *declared* at. Nothing should answer here. */
const DECLARED_BUILD = '/api/dataset/build';

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/**
 * High enough that this suite's own build sits at the head of the queue.
 *
 * The poll below has to be refused a build that is *first in line*, not one it never
 * reached: a queue ordered by priority would hide the rule being tested behind the
 * ordering.
 */
const BUILD_PRIORITY = 4000;

/** Below the build, so an inference job offered to a worker proves the skip. */
const CONTROL_PRIORITY = 3000;

/** Everything seeded, so `afterAll` can remove exactly it. */
const seeded = { datasetIds: [], jobIds: [], workerIds: [] };

/**
 * Runs one statement and returns its rows.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Named replacements.
 * @returns {Promise<Array<Object>>} The rows.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Queue a build through the route, recording both rows for cleanup.
 *
 * @param {Object} body - The request body.
 * @returns {Promise<Object>} The supertest response.
 */
async function queue(body) {
    const response = await global.api.post(BUILD).send(body);

    if (response.body && response.body.dataset) seeded.datasetIds.push(response.body.dataset.id);
    if (response.body && response.body.job) seeded.jobIds.push(response.body.job.id);

    return response;
}

afterAll(async () => {
    /* Cancelled before deleted: `gpu-lease-race` refuses to run at all while a job is
       queued, and that refusal is deliberate. */
    if (seeded.jobIds.length) {
        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'cancelled'
              WHERE id IN (:ids) AND state IN ('queued', 'leased')`,
            { replacements: { ids: seeded.jobIds } }
        );
        await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', {
            replacements: { ids: seeded.jobIds },
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:ids)', {
            replacements: { ids: seeded.jobIds },
        });
    }

    if (seeded.datasetIds.length) {
        await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', {
            replacements: { ids: seeded.datasetIds },
        });
    }

    if (seeded.workerIds.length) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id IN (:ids)', {
            replacements: { ids: seeded.workerIds },
        });
    }
});

describe('POST /api/v2/dataset/build (#268)', () => {

    test('answers with a dataset that is building and the job that will build it', async () => {
        const response = await queue({
            name: `Jest Build ${runId}`,
            description: 'Queued by tests/dataset-build-queue.test.js',
            filters: { session: [987654321] },
        });

        expect(response.status).toBe(201);

        const { dataset, job } = response.body;

        /* The dataset exists before the build starts, which is what `datasets.status`
           gained `building` for: the screen can show it immediately. */
        expect(dataset.status).toBe('building');
        expect(dataset.source).toBe('ml-dashboard');
        expect(dataset.name).toBe(`Jest Build ${runId}`);

        /* And the job is the record of the build -- the thing that carries progress,
           cancellation and the three attempts. */
        expect(job.kind).toBe('dataset_build');
        expect(job.state).toBe('queued');
        expect(Number(job.max_attempts)).toBe(3);
        expect(Number(job.attempts_made)).toBe(0);

        // The pairing. Either row alone is the failure this is here to catch.
        expect(job.spec.dataset_id).toBe(dataset.id);
    });

    test('both rows are really in the database, not just in the answer', async () => {
        const response = await queue({ name: `Jest Build Persisted ${runId}` });

        expect(response.status).toBe(201);

        const [row] = await q(
            `SELECT d.status, d.source, j.kind, j.state, j.spec
               FROM datasets d
               JOIN gpu_jobs j ON (j.spec->>'dataset_id')::int = d.id
              WHERE d.id = :datasetId`,
            { datasetId: response.body.dataset.id }
        );

        expect(row).toBeDefined();
        expect(row.status).toBe('building');
        expect(row.kind).toBe('dataset_build');
        expect(row.state).toBe('queued');
    });

    test('the filters are carried into the spec, not a reference to them', async () => {
        const filters = { session: [11, 22], trainingDisposition: ['promoted'] };
        const response = await queue({ name: `Jest Build Filters ${runId}`, filters });

        expect(response.status).toBe(201);

        /* A saved query can be edited afterwards and a build has to stay a record of what
           was actually asked for, which is the same reason the archive is content
           addressed. */
        expect(response.body.job.spec.filters).toEqual(filters);
        expect(response.body.job.spec.subsets).toBeNull();
    });

    test('subsets are carried with the split each one asked for', async () => {
        const subsets = [
            { split: 'train', filters: { session: [11] } },
            { split: 'validation', filters: { session: [22] } },
            { split: 'test', filters: { session: [33] } },
        ];
        const response = await queue({ name: `Jest Build Subsets ${runId}`, subsets });

        expect(response.status).toBe(201);
        expect(response.body.job.spec.subsets).toEqual(subsets);
    });

    test('an empty subsets array is not a subsets build', async () => {
        const response = await queue({
            name: `Jest Build Empty Subsets ${runId}`,
            subsets: [],
            filters: { session: [44] },
        });

        expect(response.status).toBe(201);

        /* The runner chooses its shape on `subsets` being a non-empty array, so an empty
           one has to arrive as null -- otherwise a build that named filters would select
           nothing and fail with a message about filters matching nothing. */
        expect(response.body.job.spec.subsets).toBeNull();
        expect(response.body.job.spec.filters).toEqual({ session: [44] });
    });

    test('the image settings are carried, so the format is the build\'s own', async () => {
        const response = await queue({
            name: `Jest Build Image ${runId}`,
            image: { format: 'png' },
        });

        expect(response.status).toBe(201);
        expect(response.body.job.spec.image).toEqual({ format: 'png' });
    });

    test('no image settings means none in the spec, and the default is the runner\'s', async () => {
        const response = await queue({ name: `Jest Build Default Image ${runId}` });

        expect(response.status).toBe(201);

        /* Deliberately not defaulted here. The runner owns what JPEG at 95 means and a
           copy of it in the spec would be a second place to change it. */
        expect(response.body.job.spec.image).toBeNull();
    });

    test('records who asked for it', async () => {
        const response = await queue({ name: `Jest Build CreatedBy ${runId}` });

        expect(response.status).toBe(201);

        // The fixture user is a person, so `created_by` is a person and not null.
        expect(response.body.job.created_by).not.toBeNull();
    });

    test('a missing name is a 400 and leaves nothing behind', async () => {
        const before = await q('SELECT count(*)::int AS n FROM datasets');
        const response = await queue({ filters: { session: [11] } });

        expect(response.status).toBe(400);

        const after = await q('SELECT count(*)::int AS n FROM datasets');

        /* Scoped to the count rather than to a name, because the failure being guarded
           against is a dataset row created before the validation ran. */
        expect(after[0].n).toBe(before[0].n);
    });

    test('a blank name is a 400 too', async () => {
        const response = await queue({ name: '   ' });

        expect(response.status).toBe(400);
    });

    test('the name is trimmed rather than stored with its whitespace', async () => {
        const response = await queue({ name: `  Jest Build Trimmed ${runId}  ` });

        expect(response.status).toBe(201);
        expect(response.body.dataset.name).toBe(`Jest Build Trimmed ${runId}`);
    });

    test('nothing answers at the path the route is declared at', async () => {
        const response = await global.api.post(DECLARED_BUILD).send({ name: `Jest Build V1 ${runId}` });

        // There are no V1 routes; everything is registered once, at /api/v2.
        expect(response.status).toBe(404);
    });
});

describe('a dataset build is never handed to a worker (#268 R2)', () => {

    /**
     * Enrol a worker through the API.
     *
     * @returns {Promise<number>} Its id.
     */
    async function enrolWorker() {
        const response = await global.api.post('/api/v2/gpu/workers/enrol').send({
            local_id: `jest-build-poll-local-${runId}`,
            name: `jest-build-poll-worker-${runId}`,
            slot_count: 1,
        });

        expect(response.status).toBe(200);
        seeded.workerIds.push(response.body.worker_id);

        return response.body.worker_id;
    }

    test('a queued build is invisible to POST /gpu/poll, and an inference job behind it is not', async () => {
        const workerId = await enrolWorker();

        const build = await queue({ name: `Jest Build Unleasable ${runId}` });

        expect(build.status).toBe(201);

        /* Put the build at the head of the queue. A build the poll never reached would
           pass this test for the wrong reason. */
        await db.sequelize.query('UPDATE gpu_jobs SET priority = :priority WHERE id = :id', {
            replacements: { priority: BUILD_PRIORITY, id: build.body.job.id },
        });

        const empty = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

        // 204 is "no work", with a `dataset_build` sitting queued and first in line.
        expect(empty.status).toBe(204);

        /* The positive control. Without it, a poll that had stopped working altogether
           would look exactly like the rule being enforced. */
        const control = await global.api.post('/api/v2/gpu/jobs').send({
            kind: 'inference',
            priority: CONTROL_PRIORITY,
            spec: {
                engine: 'mock',
                model: { name: `jest-build-control-${runId}`, sha256: 'e'.repeat(64) },
                video: {
                    url: `http://jest.invalid/media/jest-build-${runId}.mp4`,
                    source_name: 'jest-build-control.mp4',
                },
                range: { start_frame: 0, end_frame: 100 },
                reduction: { name: 'v3_dirpad', version: 1 },
            },
        });

        expect(control.status).toBe(200);
        seeded.jobIds.push(control.body.jobs[0].id);

        const leased = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

        expect(leased.status).toBe(200);
        expect(leased.body.kind).toBe('inference');
        expect(leased.body.job_id).toBe(control.body.jobs[0].id);

        // And the build is still queued, untouched, with none of its attempts spent.
        const [after] = await q('SELECT state, attempts_made FROM gpu_jobs WHERE id = :id', {
            id: build.body.job.id,
        });

        expect(after.state).toBe('queued');
        expect(Number(after.attempts_made)).toBe(0);

        const [attempts] = await q(
            'SELECT count(*)::int AS n FROM gpu_job_attempts WHERE job_id = :id',
            { id: build.body.job.id }
        );

        expect(attempts.n).toBe(0);
    });
});
