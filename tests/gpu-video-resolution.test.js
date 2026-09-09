/**
 * Endpoint tests for how a job's video reaches a worker.
 *
 * The contract these hold in place: **the coordinator resolves the video and
 * hands the worker a playable URL.** A worker knows nothing about MARP or
 * Jellyfin -- it opens a source it was given -- which is also why it can process
 * any reachable video and not only a Jellyfin item.
 *
 * At the HTTP tier, because that is the tier a worker meets. What a worker
 * receives is the leased body, and a check one layer down would pass while the
 * body handed over was missing the URL entirely -- which is exactly the class of
 * defect this file exists to catch.
 *
 * Jellyfin is stubbed at the repository boundary, one method deep. The
 * alternative would be a suite that only runs where the media server is
 * reachable, and CI cannot reach it (`tests/jellyfin.test.js` is excluded there
 * for that reason). What is being tested is what MARP does with the URL, not
 * whether Jellyfin returns one.
 *
 * @fileoverview Endpoint tests for video resolution at lease time.
 * @author Isaac Travers
 * @module tests/gpu-video-resolution
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');

/**
 * Unique per run, so two runs cannot collide on the durable id a worker enrols
 * with and a failed run's leftovers are recognisable.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * Priority every job here is given: above anything a person would queue, so this
 * suite's polls take this suite's jobs.
 *
 * @constant
 * @type {number}
 */
const TEST_PRIORITY = 1000;

/**
 * The Jellyfin item id these jobs name. Opaque provenance as far as the worker
 * is concerned, and asserted to survive to the leased spec untouched.
 *
 * @constant
 * @type {string}
 */
const ITEM_ID = `jest-resolve-item-${runId}`;

/**
 * What the stubbed Jellyfin hand-off answers with. A real direct-stream URL
 * carries an api_key, which is the reason resolution happens at lease time
 * rather than at submission, so the stub carries one too.
 *
 * @constant
 * @type {string}
 */
const RESOLVED_URL = `http://jellyfin.invalid/Videos/${ITEM_ID}/stream?static=true&api_key=jest-media-key`;

/**
 * The Jellyfin item the stub returns. `path` is what a `source_name` is taken
 * from -- an observation's `video_source` is a filename with its extension,
 * while Jellyfin's display name is usually the stem.
 *
 * @constant
 * @type {Object}
 */
const JELLYFIN_ITEM = {
    id: ITEM_ID,
    name: `jest-resolved-${runId}`,
    type: 'Video',
    path: `C:/media/dives/jest-resolved-${runId}.mp4`,
    isFolder: false,
    mediaType: 'Video',
    runtimeTicks: 36000000000,
    childCount: null,
};

/** Job ids this suite created, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/** The worker this suite enrols. @type {number|undefined} */
let workerId;

/**
 * Submit one job and remember it for teardown.
 *
 * @param {Object} video - The `spec.video` to submit.
 * @param {Object} [overrides] - Fields merged into the submission body.
 * @returns {Promise<Object>} The Supertest response.
 */
async function submit(video, overrides = {}) {
    // Rising priority, for the same reason as the main GPU suite: a lease left
    // open earlier can expire and put an older job back in the queue ahead of
    // the one the current test just submitted.
    const response = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'inference',
            priority: TEST_PRIORITY + createdJobIds.length,
            spec: {
                engine: 'ultralytics',
                model: { name: `jest-resolve-model-${runId}`, sha256: 'e'.repeat(64) },
                video,
                range: { start_frame: 0, end_frame: 100 },
                reduction: { name: 'v3_dirpad', version: 1 },
            },
            ...overrides,
        });

    if (response.status === 200) {
        for (const job of response.body.jobs) {
            createdJobIds.push(job.id);
        }
    }

    return response;
}

/**
 * Poll once, with no waiting.
 *
 * @returns {Promise<Object>} The Supertest response.
 */
function pollOnce() {
    return global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });
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
    // A poll takes the best-priority queued job in the whole database, so a job
    // left over from elsewhere would be leased here and every assertion about
    // which job came back would be about the wrong row. Failing rather than
    // skipping: a suite that quietly stops checking looks exactly like a passing
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
            local_id: `jest-resolve-local-${runId}`,
            name: `jest-resolve-worker-${runId}`,
            // More slots than any test here needs, because most leave their lease
            // open rather than reporting a result.
            slot_count: 32,
            worker_version: '0.0.1-jest',
        });

    expect(enrolled.status).toBe(200);
    workerId = enrolled.body.worker_id;
});

beforeEach(() => {
    // Stubbed per test rather than once, so a test that wants a failure can
    // replace one of these without leaking that into the next.
    jest.spyOn(jellyfinRepository, 'buildDirectStreamUrl').mockResolvedValue(RESOLVED_URL);
    jest.spyOn(jellyfinRepository, 'getItem').mockResolvedValue(JELLYFIN_ITEM);
});

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(async () => {
    if (createdJobIds.length > 0) {
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });

        // Attempts and their events go with the job, by cascade.
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
    }

    if (workerId) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :workerId', {
            replacements: { workerId },
        });
    }
});

/**
 * What a submission is allowed to say about its video.
 */
describe('GPU job submission: the video', () => {
    it('refuses a submission carrying both an item id and a url', async () => {
        const response = await submit({
            jellyfin_item_id: ITEM_ID,
            url: RESOLVED_URL,
            source_name: 'jest-both.mp4',
        });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/exactly one of jellyfin_item_id or url/);
    });

    it('refuses a bare url with no source_name, because nothing else can name the observations', async () => {
        const response = await submit({ url: `http://jest.invalid/media/nameless-${runId}.mp4` });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/source_name/);
    });

    it('refuses an empty url rather than storing one', async () => {
        const response = await submit({ url: '', source_name: 'jest-empty.mp4' });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/spec\.video\.url/);
    });

    it('refuses a video that names neither an item id nor a url', async () => {
        const response = await submit({ source_name: 'jest-nothing.mp4' });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/either jellyfin_item_id or url/);
    });

    it('keeps the stored spec as it was submitted, resolving nothing at submit time', async () => {
        const response = await submit({ jellyfin_item_id: ITEM_ID, source_name: 'jest-stored.mp4' });

        expect(response.status).toBe(200);

        const [row] = await query('SELECT spec FROM gpu_jobs WHERE id = :id', { id: response.body.jobs[0].id });

        // No URL in the queued row, and nothing asked of Jellyfin. A URL carries
        // its own media credential and one minted here would sit in the queue
        // until somebody claimed it, by which time an expiring one would be dead.
        expect(row.spec.video).toEqual({ jellyfin_item_id: ITEM_ID, source_name: 'jest-stored.mp4' });
        expect(row.spec.video.url).toBeUndefined();
        expect(jellyfinRepository.buildDirectStreamUrl).not.toHaveBeenCalled();

        await global.api.post(`/api/v2/gpu/jobs/${response.body.jobs[0].id}/cancel`);
    });
});

/**
 * The coordinator's guarantee: a leased spec carries a URL the worker can open.
 */
describe('GPU lease: the video the worker is handed', () => {
    it('resolves an item id into a url at lease time', async () => {
        const submitted = await submit({ jellyfin_item_id: ITEM_ID, source_name: 'jest-lease.mp4' });

        expect(submitted.status).toBe(200);

        const polled = await pollOnce();

        expect(polled.status).toBe(200);
        expect(polled.body.job_id).toBe(submitted.body.jobs[0].id);

        // The guarantee, asserted on the body the worker actually receives.
        expect(polled.body.spec.video.url).toBe(RESOLVED_URL);
        expect(jellyfinRepository.buildDirectStreamUrl).toHaveBeenCalledWith(ITEM_ID, expect.any(Object));

        // Provenance, unchanged. The worker echoes this into its output and never
        // resolves it.
        expect(polled.body.spec.video.jellyfin_item_id).toBe(ITEM_ID);
        expect(polled.body.spec.video.source_name).toBe('jest-lease.mp4');

        // And the job row is still what was submitted: the lease is where the URL
        // is produced, not a rewrite of what is stored.
        const [row] = await query('SELECT spec FROM gpu_jobs WHERE id = :id', { id: submitted.body.jobs[0].id });

        expect(row.spec.video.url).toBeUndefined();
    });

    it('fills source_name from the Jellyfin item when the submission left it out', async () => {
        const submitted = await submit({ jellyfin_item_id: ITEM_ID });

        expect(submitted.status).toBe(200);

        const polled = await pollOnce();

        expect(polled.status).toBe(200);

        // The basename of Jellyfin's path, with its extension: this is what
        // becomes `video_source` on every observation the run produces, and it
        // cannot be guessed from a URL.
        expect(polled.body.spec.video.source_name).toBe(`jest-resolved-${runId}.mp4`);
        expect(polled.body.spec.video.url).toBe(RESOLVED_URL);
    });

    it('hands a bare url through unchanged, asking Jellyfin nothing', async () => {
        const url = `http://jest.invalid/media/handed-through-${runId}.mp4?token=abc`;
        const submitted = await submit({ url, source_name: 'handed-through.mp4' });

        expect(submitted.status).toBe(200);

        const polled = await pollOnce();

        expect(polled.status).toBe(200);
        expect(polled.body.spec.video.url).toBe(url);
        expect(polled.body.spec.video.source_name).toBe('handed-through.mp4');

        // A worker can process any reachable source. Nothing about a URL job
        // touches the media server.
        expect(jellyfinRepository.buildDirectStreamUrl).not.toHaveBeenCalled();
        expect(jellyfinRepository.getItem).not.toHaveBeenCalled();
    });

    it('does not hand out a lease when the video cannot be resolved, and lets the job fail', async () => {
        jellyfinRepository.buildDirectStreamUrl.mockRejectedValue(new Error('Jellyfin is unreachable'));

        // Two attempts, so both halves are visible: back to the queue while one
        // remains, and finished when none does.
        const submitted = await submit(
            { jellyfin_item_id: ITEM_ID, source_name: 'jest-unresolvable.mp4' },
            { max_attempts: 2 }
        );

        expect(submitted.status).toBe(200);

        const jobId = submitted.body.jobs[0].id;

        const first = await pollOnce();

        // 204 rather than a lease with no URL in it. A worker cannot be handed a
        // job it has no way to open.
        expect(first.status).toBe(204);
        expect(first.body).toEqual({});

        const [afterFirst] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: jobId });
        const attemptsAfterFirst = await query(
            'SELECT state, failure_reason FROM gpu_job_attempts WHERE job_id = :id ORDER BY lease_epoch',
            { id: jobId }
        );

        // The attempt exists and says why. It is spent, not released: an
        // unresolvable video retried forever would never be visible to anybody.
        expect(attemptsAfterFirst).toHaveLength(1);
        expect(attemptsAfterFirst[0].state).toBe('failed');
        expect(attemptsAfterFirst[0].failure_reason).toMatch(/could not be resolved/);
        expect(attemptsAfterFirst[0].failure_reason).toMatch(/Jellyfin is unreachable/);
        expect(afterFirst.state).toBe('queued');

        const second = await pollOnce();

        expect(second.status).toBe(204);

        const [afterSecond] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: jobId });
        const attemptsAfterSecond = await query(
            'SELECT state FROM gpu_job_attempts WHERE job_id = :id',
            { id: jobId }
        );

        // Attempts exhausted, so the job lands `failed` -- a state a person sees
        // -- rather than sitting queued and being retried indefinitely.
        expect(attemptsAfterSecond).toHaveLength(2);
        expect(afterSecond.state).toBe('failed');
    });

    it('never hands over an empty url, even from a spec that already holds one', async () => {
        // The submit route refuses an empty url, so this row is made empty
        // directly. It is the shape that matters: a worker refuses a spec whose
        // `video.url` is missing *or* empty, and a coordinator that resolved
        // nothing is likelier to emit `""` than to omit the key. This asserts
        // MARP does neither -- there is no lease at all.
        const submitted = await submit(
            { url: `http://jest.invalid/media/to-be-emptied-${runId}.mp4`, source_name: 'to-be-emptied.mp4' },
            { max_attempts: 1 }
        );

        expect(submitted.status).toBe(200);

        const jobId = submitted.body.jobs[0].id;

        await db.sequelize.query(
            'UPDATE gpu_jobs SET spec = jsonb_set(spec, \'{video,url}\', \'""\'::jsonb) WHERE id = :id',
            { replacements: { id: jobId } }
        );

        const [stored] = await query('SELECT spec FROM gpu_jobs WHERE id = :id', { id: jobId });

        expect(stored.spec.video.url).toBe('');

        const polled = await pollOnce();

        expect(polled.status).toBe(204);
        expect(polled.body).toEqual({});

        const [attempt] = await query(
            'SELECT state, failure_reason FROM gpu_job_attempts WHERE job_id = :id',
            { id: jobId }
        );

        // An empty url is treated as no url: with no item id to resolve either,
        // the attempt fails saying so rather than the empty string being handed
        // on in the belief that a worker will tolerate it.
        expect(attempt.state).toBe('failed');
        expect(attempt.failure_reason).toMatch(/neither a video\.url nor a video\.jellyfin_item_id/);
    });

    it('does not hand out a lease when Jellyfin does not have the item', async () => {
        jellyfinRepository.getItem.mockResolvedValue(null);

        const submitted = await submit({ jellyfin_item_id: ITEM_ID }, { max_attempts: 1 });

        expect(submitted.status).toBe(200);

        const polled = await pollOnce();

        expect(polled.status).toBe(204);

        const [job] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: submitted.body.jobs[0].id });
        const [attempt] = await query(
            'SELECT state, failure_reason FROM gpu_job_attempts WHERE job_id = :id',
            { id: submitted.body.jobs[0].id }
        );

        expect(attempt.state).toBe('failed');
        expect(attempt.failure_reason).toMatch(/has no item/);
        expect(job.state).toBe('failed');
    });
});
