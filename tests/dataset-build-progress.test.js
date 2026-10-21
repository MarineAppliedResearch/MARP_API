/**
 * Endpoint tests for `GET /api/v2/dataset/builds` — what the Datasets screen reads to
 * show a build in flight (#268, item 1.2).
 *
 * The screen's FRAMES column used to read `—` for a dataset that was being built, which
 * is the one place somebody watching a four-hour build looks. The progress it needs is on
 * `gpu_job_attempts` for the latest attempt of the `dataset_build` job whose
 * `spec->>'dataset_id'` is that dataset, and this route is that join.
 *
 * **Everything here is seeded and removed**, and every assertion is scoped to the rows
 * this file created. A real build in flight on the machine running the suite is a perfectly
 * ordinary thing, so an assertion about the length of the answer would pass on an idle
 * database and fail on a busy one — `tests/setup/corpus-guard.js` watches the former and
 * this file's own filtering is what handles the latter.
 *
 * The runner itself is not exercised: it cuts frames out of video with ffmpeg and takes
 * minutes, and what is under test here is what the route reports, not what the build does.
 *
 * @fileoverview Endpoint tests for GET /api/v2/dataset/builds.
 * @author Isaac Travers
 * @module tests/dataset-build-progress
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');

describe('GET /api/v2/dataset/builds', () => {

    /** Unique per run, so two runs against one database cannot see each other's rows. */
    const stamp = Date.now();

    /** Everything this file created, torn down in reverse. */
    const made = { datasets: [], jobs: [], attempts: [], workers: [] };

    /**
     * A `gpu_workers` row, because `gpu_job_attempts.worker_id` is NOT NULL with a foreign
     * key and CI builds an empty database — there is no worker to borrow.
     *
     * @returns {Promise<number>} Its id.
     */
    async function seedWorker() {
        /* `local_id` is unique, so the suffix counts up: every call after the first used to
           collide with the first one's row and fail the test that happened to be second. */
        const handle = `jest-build-progress-${stamp}-${made.workers.length + 1}`;

        const [worker] = await db.sequelize.query(
            `INSERT INTO gpu_workers (name, local_id, state, slot_count, enrolled_at, update_state)
             VALUES (:name, :localId, 'paused', 1, NOW(), 'current')
             RETURNING id`,
            {
                replacements: { name: handle, localId: handle },
                type: QueryTypes.SELECT,
            }
        );

        made.workers.push(worker.id);

        return worker.id;
    }

    /**
     * A dataset and the `dataset_build` job that is building it, the way `queueBuild` does.
     *
     * @param {Object} options
     * @param {string} options.name - Distinguishes one seeded build from another.
     * @param {string} [options.state] - The job's state. Defaults to `queued`.
     * @returns {Promise<{datasetId: number, jobId: number}>}
     */
    async function seedBuild({ name, state = 'queued' }) {
        const [dataset] = await db.sequelize.query(
            `INSERT INTO datasets (name, description, status, source, created_at, updated_at)
             VALUES (:name, 'seeded by tests/dataset-build-progress', 'building', 'jest', NOW(), NOW())
             RETURNING id`,
            { replacements: { name: `${name}-${stamp}` }, type: QueryTypes.SELECT }
        );

        made.datasets.push(dataset.id);

        const [job] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                   created_at, updated_at)
             VALUES ('dataset_build', :name, :spec, :state, 0, 0, 3, NOW(), NOW())
             RETURNING id`,
            {
                replacements: {
                    name: `Build ${name}-${stamp}`,
                    spec: JSON.stringify({ dataset_id: dataset.id, filters: {}, subsets: null }),
                    state,
                },
                type: QueryTypes.SELECT,
            }
        );

        made.jobs.push(job.id);

        return { datasetId: dataset.id, jobId: job.id };
    }

    /**
     * An attempt at a job, carrying whatever the runner would have reported by now.
     *
     * @param {Object} options
     * @param {number} options.jobId - The job.
     * @param {number} options.workerId - Its worker.
     * @param {number} options.epoch - Which try this is.
     * @param {?number} [options.done] - Frames written.
     * @param {?number} [options.total] - Frames intended.
     * @param {?string} [options.phase] - selecting, extracting or packaging.
     * @returns {Promise<number>} The attempt id.
     */
    async function seedAttempt({ jobId, workerId, epoch, done = null, total = null, phase = null }) {
        const [attempt] = await db.sequelize.query(
            `INSERT INTO gpu_job_attempts
                 (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at,
                  progress_done, progress_total, progress_unit, progress_phase)
             VALUES (:jobId, :workerId, 0, :epoch, 'running', NOW(), NOW() + INTERVAL '1 hour',
                     :done, :total, 'frames', :phase)
             RETURNING id`,
            {
                replacements: { jobId, workerId, epoch, done, total, phase },
                type: QueryTypes.SELECT,
            }
        );

        made.attempts.push(attempt.id);

        return attempt.id;
    }

    /** Only this file's rows, keyed by dataset id, out of whatever else is in flight. */
    async function mine(datasetIds) {
        const res = await global.api.get('/api/v2/dataset/builds');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        const wanted = new Set(datasetIds);

        return new Map(res.body
            .filter((build) => wanted.has(build.dataset_id))
            .map((build) => [build.dataset_id, build]));
    }

    afterAll(async () => {
        for (const id of made.attempts) {
            await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE id = :id', { replacements: { id } });
        }
        for (const id of made.jobs) {
            await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id } });
        }
        for (const id of made.datasets) {
            await db.sequelize.query('DELETE FROM datasets WHERE id = :id', { replacements: { id } });
        }
        for (const id of made.workers) {
            await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :id', { replacements: { id } });
        }
    });

    /**
     * The route exists at all, which is less obvious than it sounds: `/api/v2/dataset/:id`
     * is registered in the same file, Express matches in registration order, and after it
     * this path is a dataset whose id is the word "builds".
     */
    it('is a route of its own and not a dataset called "builds"', async () => {
        const res = await global.api.get('/api/v2/dataset/builds');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    /**
     * P3 — a queued build is distinct from a running one. `datasets.status` says `building`
     * from the instant a build is queued, so the dataset alone cannot say whether anything
     * has started; the job's state can, and the screen draws *Queued* rather than a count.
     */
    it('reports a queued build with no attempt and no progress', async () => {
        const { datasetId, jobId } = await seedBuild({ name: 'jest-queued' });

        const build = (await mine([datasetId])).get(datasetId);

        expect(build).toBeDefined();
        expect(build.job_id).toBe(jobId);
        expect(build.state).toBe('queued');
        expect(build.attempt_id).toBeNull();
        expect(build.progress_done).toBeNull();
        expect(build.progress_total).toBeNull();
        expect(build.progress_phase).toBeNull();
    });

    /**
     * P1 and P2 — frames done against total, and the phase. This is the answer the FRAMES
     * column is drawn from, and the pair is the point: a count with no phase cannot tell a
     * reader whether a build sitting at zero has started.
     */
    it('reports frames done, frames total and the phase for a running build', async () => {
        const worker = await seedWorker();
        const { datasetId, jobId } = await seedBuild({ name: 'jest-extracting', state: 'leased' });
        const attemptId = await seedAttempt({
            jobId, workerId: worker, epoch: 1, done: 480, total: 1367, phase: 'extracting',
        });

        const build = (await mine([datasetId])).get(datasetId);

        expect(build).toBeDefined();
        expect(build.state).toBe('leased');
        expect(build.attempt_id).toBe(attemptId);
        expect(build.progress_done).toBe(480);
        expect(build.progress_total).toBe(1367);
        expect(build.progress_unit).toBe('frames');
        expect(build.progress_phase).toBe('extracting');
        expect(build.started_at).not.toBeNull();
    });

    /**
     * The *selecting* phase, which is where a reader is most likely to think a build has
     * hung: it is running, and the total is genuinely not known yet, because the runner has
     * to resolve the observations and their videos before it can say how many frames it
     * intends to cut. A screen that renders a null total as `0` would claim the build knows
     * something it does not.
     */
    it('reports a phase with no counts while a build is still selecting', async () => {
        const worker = await seedWorker();
        const { datasetId, jobId } = await seedBuild({ name: 'jest-selecting', state: 'leased' });

        await seedAttempt({ jobId, workerId: worker, epoch: 1, phase: 'selecting' });

        const build = (await mine([datasetId])).get(datasetId);

        expect(build).toBeDefined();
        expect(build.progress_phase).toBe('selecting');
        expect(build.progress_done).toBeNull();
        expect(build.progress_total).toBeNull();
    });

    /**
     * A retry opens a second attempt on the same job, and the one worth drawing is the
     * latest. Reporting the first would show a build going backwards — the count from a
     * run that has already failed.
     */
    it('reports the latest attempt when a build has been retried', async () => {
        const worker = await seedWorker();
        const { datasetId, jobId } = await seedBuild({ name: 'jest-retried', state: 'leased' });

        await seedAttempt({
            jobId, workerId: worker, epoch: 1, done: 120, total: 1367, phase: 'extracting',
        });
        const second = await seedAttempt({
            jobId, workerId: worker, epoch: 2, done: 30, total: 1367, phase: 'extracting',
        });

        await db.sequelize.query('UPDATE gpu_jobs SET attempts_made = 2 WHERE id = :id',
            { replacements: { id: jobId } });

        const build = (await mine([datasetId])).get(datasetId);

        expect(build).toBeDefined();
        expect(build.attempt_id).toBe(second);
        expect(build.progress_done).toBe(30);
        expect(build.attempts_made).toBe(2);
    });

    /**
     * One row per dataset, so a consumer keying by dataset id never has to reduce. Two
     * in-flight jobs naming one dataset should not happen — a retry reuses the job — but if
     * it ever did, the newest is the one that is building it.
     */
    it('answers at most one build per dataset', async () => {
        const { datasetId } = await seedBuild({ name: 'jest-one-per-dataset' });

        const [second] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                   created_at, updated_at)
             VALUES ('dataset_build', :name, :spec, 'queued', 0, 0, 3, NOW(), NOW())
             RETURNING id`,
            {
                replacements: {
                    name: `Build jest-one-per-dataset-again-${stamp}`,
                    spec: JSON.stringify({ dataset_id: datasetId, filters: {}, subsets: null }),
                },
                type: QueryTypes.SELECT,
            }
        );

        made.jobs.push(second.id);

        const res = await global.api.get('/api/v2/dataset/builds');

        expect(res.status).toBe(200);

        const forThisDataset = res.body.filter((build) => build.dataset_id === datasetId);

        expect(forThisDataset).toHaveLength(1);
        expect(forThisDataset[0].job_id).toBe(second.id);
    });

    /**
     * P4 — the screen polls while anything is building and stops when nothing is, so a
     * build that has finished, failed or been cancelled must leave this answer. A route
     * that kept reporting it would poll for ever.
     */
    it('leaves out a build that has finished, failed or been cancelled', async () => {
        const worker = await seedWorker();
        const terminal = {};

        for (const state of ['succeeded', 'failed', 'cancelled']) {
            const { datasetId, jobId } = await seedBuild({ name: `jest-${state}`, state });
            await seedAttempt({
                jobId, workerId: worker, epoch: 1, done: 1367, total: 1367, phase: 'packaging',
            });
            terminal[state] = datasetId;
        }

        /* And one still running beside them, so an empty answer cannot pass this test by
           the route simply being broken. */
        const { datasetId: running, jobId: runningJob } = await seedBuild({ name: 'jest-still-running', state: 'leased' });
        await seedAttempt({
            jobId: runningJob, workerId: worker, epoch: 1, done: 10, total: 1367, phase: 'extracting',
        });

        const found = await mine([...Object.values(terminal), running]);

        for (const [state, datasetId] of Object.entries(terminal)) {
            expect(`${state}: ${found.has(datasetId)}`).toBe(`${state}: false`);
        }

        expect(found.has(running)).toBe(true);
    });

    /**
     * Only dataset builds. The pool's own work shares `gpu_jobs` and has progress on its
     * attempts in exactly the same columns, so a route that filtered on the state alone
     * would put every running inference job on the Datasets screen.
     */
    it('leaves out jobs that are not dataset builds', async () => {
        const [job] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                   created_at, updated_at)
             VALUES ('inference', :name, :spec, 'queued', 0, 0, 3, NOW(), NOW())
             RETURNING id`,
            {
                replacements: {
                    name: `jest-not-a-build-${stamp}`,
                    /* Carrying a `dataset_id` deliberately: the kind is what decides, and a
                       route matching on the spec would pick this up. */
                    spec: JSON.stringify({ dataset_id: 999999999 }),
                },
                type: QueryTypes.SELECT,
            }
        );

        made.jobs.push(job.id);

        const res = await global.api.get('/api/v2/dataset/builds');

        expect(res.status).toBe(200);
        expect(res.body.some((build) => build.job_id === job.id)).toBe(false);
    });

    /**
     * The image format is settled at the request, not minutes later in the runner.
     *
     * `{"format":"webp"}` used to answer 201 and then fail inside a job the asker had to
     * go and find -- a long way from the mistake, and after a dataset row had already been
     * created saying `building`. The route calls the same `imageSettings` the build calls,
     * so there is one answer to what a format is rather than two that can drift.
     */
    describe('refusing an image format the build cannot write', () => {
        const queue = (image) => global.api
            .post('/api/v2/dataset/build')
            .send({ name: `jest-image-${stamp}-${Math.random().toString(36).slice(2, 8)}`, image });

        /** Nothing was queued, so there is no dataset left saying `building` for ever. */
        async function nothingWasQueued(before) {
            const after = await db.sequelize.query(
                "SELECT count(*)::int AS n FROM gpu_jobs WHERE kind = 'dataset_build'",
                { type: QueryTypes.SELECT }
            );

            expect(after[0].n).toBe(before);
        }

        it('refuses a format it does not write, and queues nothing', async () => {
            const [{ n: before }] = await db.sequelize.query(
                "SELECT count(*)::int AS n FROM gpu_jobs WHERE kind = 'dataset_build'",
                { type: QueryTypes.SELECT }
            );

            const res = await queue({ format: 'webp' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/webp/);
            await nothingWasQueued(before);
        });

        it('refuses a quality outside 1 to 100', async () => {
            const res = await queue({ format: 'jpeg', quality: 140 });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/quality/i);
        });

        it('refuses png with a quality rather than ignoring it', async () => {
            const res = await queue({ format: 'png', quality: 95 });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/png/i);
        });
    });

    /**
     * Every route in this API requires a permission, and this one reads datasets. Asserted
     * because the screen fetches it on a timer: a route that answered anonymously would put
     * which surveys are being trained on in front of anybody who opened the page.
     */
    it('refuses a request carrying no principal', async () => {
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/v2/dataset/builds');

        expect(res.status).toBe(401);
    });
});
