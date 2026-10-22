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
const buildRepository = require('../repository/dataset-build.repository');

describe('GET /api/v2/dataset/builds', () => {

    /** Unique per run, so two runs against one database cannot see each other's rows. */
    const stamp = Date.now();

    /** Everything this file created, torn down in reverse. */
    const made = { datasets: [], jobs: [], attempts: [], workers: [], observations: [], artifacts: [] };

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
    async function seedAttempt({ jobId, workerId, epoch, done = null, total = null, phase = null, failureReason = null }) {
        const [attempt] = await db.sequelize.query(
            `INSERT INTO gpu_job_attempts
                 (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at,
                  progress_done, progress_total, progress_unit, progress_phase, failure_reason)
             VALUES (:jobId, :workerId, 0, :epoch, 'running', NOW(), NOW() + INTERVAL '1 hour',
                     :done, :total, 'frames', :phase, :failureReason)
             RETURNING id`,
            {
                replacements: { jobId, workerId, epoch, done, total, phase, failureReason },
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
        /* **Anything the route queued, not only what was seeded.** The refusal tests below
           post a real build and expect a 400, so on the happy path nothing is created --
           but the moment that validation regresses the request succeeds, and a failing test
           would leave a `gpu_jobs` row and a dataset saying `building` for ever. That is
           exactly the run where cleanup matters, and it is the run where it was missing:
           one `jest-image-...` dataset survived a red run before this was here. Matched on
           the stamp, so it can only ever reach this file's own rows. */
        const queued = await db.sequelize.query(
            `SELECT id, (spec->>'dataset_id')::int AS dataset_id
               FROM gpu_jobs
              WHERE kind = 'dataset_build' AND name LIKE :like`,
            { replacements: { like: `Build jest-image-${stamp}-%` }, type: QueryTypes.SELECT }
        );

        for (const job of queued) {
            if (job.dataset_id) made.datasets.push(job.dataset_id);
            made.jobs.push(job.id);
        }

        /* A build the route queued may have been claimed and given an attempt before the
           suite finished, and an attempt holds a foreign key to its job. */
        for (const id of made.jobs) {
            await db.sequelize.query('DELETE FROM gpu_job_attempts WHERE job_id = :id',
                { replacements: { id } });
        }

        /* Likewise its membership and vocabulary, if it got as far as recording them. */
        for (const id of made.datasets) {
            await db.sequelize.query('DELETE FROM dataset_observations WHERE dataset_id = :id',
                { replacements: { id } });
            await db.sequelize.query('DELETE FROM dataset_classes WHERE dataset_id = :id',
                { replacements: { id } });
        }

        /* Artifacts first of all: `artifacts.job_id` is RESTRICT, so a job this file
           created while proving that refusal cannot be deleted until its artifact is. */
        for (const id of made.artifacts) {
            await db.sequelize.query('DELETE FROM artifacts WHERE id = :id',
                { replacements: { id } });
        }

        /* A reading hangs off an attempt, so it goes first -- and it is a row this file
           created just as much as the attempt is. */
        for (const id of made.attempts) {
            await db.sequelize.query('DELETE FROM gpu_attempt_progress WHERE attempt_id = :id',
                { replacements: { id } });
        }

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

        /* After the membership rows above, which hold the foreign key to them. */
        for (const id of made.observations) {
            await db.sequelize.query('DELETE FROM observations WHERE observation_id = :id',
                { replacements: { id } });
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
     * The phase carries which video the build is on, and the route hands it back whole.
     *
     * `progress_phase` was a bare word; it now reads `extracting 2/6 …name`, because a
     * reader watching a four-hour build could not tell working from wedged. The screen
     * splits it on the first space — the phase goes in the pill, the rest on its own
     * line — so what matters here is that the route does not touch it: a phase mangled
     * on the way out would put a filename in a status pill, or lose the video entirely.
     */
    it('hands back a phase that names the video, exactly as it was written', async () => {
        const worker = await seedWorker();
        const { jobId } = await seedBuild({ name: 'jest-phase-video', state: 'leased' });
        const phase = 'extracting 2/6 …0727_163021_Fwd';

        await seedAttempt({
            jobId, workerId: worker, epoch: 1, done: 400, total: 4760, phase,
        });

        const build = (await mine([made.datasets.at(-1)])).get(made.datasets.at(-1));

        expect(build).toBeDefined();
        expect(build.progress_phase).toBe(phase);
        /* And the first word is still the phase, which is the half the pill reads. */
        expect(build.progress_phase.split(' ')[0]).toBe('extracting');
    });

    /**
     * `progress_phase` is `varchar(64)`, and the runner trims a long video name from the
     * left to fit — the end of a Jellyfin name is the distinguishing part. A phase at
     * exactly the column's width has to survive, because that is the case the trimming
     * aims at and the one a shorter column would silently cut.
     */
    it('keeps a phase that fills the column', async () => {
        const [column] = await db.sequelize.query(
            `SELECT character_maximum_length AS width
               FROM information_schema.columns
              WHERE table_name = 'gpu_job_attempts' AND column_name = 'progress_phase'`,
            { type: QueryTypes.SELECT }
        );

        expect(column.width).toBeGreaterThanOrEqual(64);

        const worker = await seedWorker();
        const { jobId } = await seedBuild({ name: 'jest-phase-wide', state: 'leased' });
        const phase = `extracting 6/6 ${'x'.repeat(column.width - 15)}`;

        expect(phase).toHaveLength(column.width);

        await seedAttempt({ jobId, workerId: worker, epoch: 1, done: 1, total: 2, phase });

        const build = (await mine([made.datasets.at(-1)])).get(made.datasets.at(-1));

        expect(build.progress_phase).toHaveLength(column.width);
        expect(build.progress_phase).toBe(phase);
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
     * **A build that succeeded is gone; one that failed is kept, for its reason.**
     *
     * The screen draws a failed build as *Needs attention*, and until this answer carried
     * `failure_reason` the panel under that row could only say something had gone wrong —
     * *"which isn't telling me ANYTHING about why it needs attention"*. A build that
     * worked needs nothing from here: its dataset says `ready` and carries its own counts.
     *
     * P4 still holds, and this is where the distinction lives: **polling is keyed on the
     * state, not on the answer being empty.** A failed build stays failed, so a screen
     * watching for a non-empty answer would poll for ever; it watches for `queued` or
     * `leased`, and the test below pins that those are the only two that mean *running*.
     */
    it('keeps a failed build for its reason, and drops one that succeeded', async () => {
        const worker = await seedWorker();
        const seeded = {};

        for (const state of ['succeeded', 'failed', 'cancelled']) {
            const { datasetId, jobId } = await seedBuild({ name: `jest-${state}`, state });
            await seedAttempt({
                jobId,
                workerId: worker,
                epoch: 1,
                done: 1367,
                total: 1367,
                phase: 'packaging',
                failureReason: state === 'succeeded' ? null : `jest: ${state} on purpose`,
            });
            seeded[state] = datasetId;
        }

        /* And one still running beside them, so an empty answer cannot pass this test by
           the route simply being broken. */
        const { datasetId: running, jobId: runningJob } = await seedBuild({ name: 'jest-still-running', state: 'leased' });
        await seedAttempt({
            jobId: runningJob, workerId: worker, epoch: 1, done: 10, total: 1367, phase: 'extracting',
        });

        const found = await mine([...Object.values(seeded), running]);

        expect(`succeeded: ${found.has(seeded.succeeded)}`).toBe('succeeded: false');

        for (const state of ['failed', 'cancelled']) {
            const build = found.get(seeded[state]);

            expect(`${state}: ${Boolean(build)}`).toBe(`${state}: true`);
            expect(build.failure_reason).toBe(`jest: ${state} on purpose`);
        }

        expect(found.get(running).failure_reason).toBeNull();
    });

    /**
     * What the screen polls on. Two states mean a build is still going, and a reader
     * watching a four-hour build depends on the timer stopping when it is over — a failed
     * build in the answer must not keep it running.
     */
    it('marks a finished build with a state that is not queued or leased', async () => {
        const worker = await seedWorker();
        const { datasetId, jobId } = await seedBuild({ name: 'jest-not-running', state: 'failed' });

        await seedAttempt({
            jobId, workerId: worker, epoch: 1, failureReason: 'jest: over',
        });

        const build = (await mine([datasetId])).get(datasetId);

        expect(['queued', 'leased']).not.toContain(build.state);
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
     * Keeping a reading per minute, which is what makes a *rate* answerable.
     *
     * The attempt row holds where a build is now and is overwritten by every report, so it
     * can never say how fast anything went. `gpu_attempt_progress` is the second reading,
     * and `GET /gpu/throughput/series` differences consecutive ones. The pool's heartbeat
     * has written it since `20261020130000`; a build wrote only to the attempt, so the
     * Datasets screen's Build activity panel had no series and said so on screen.
     */
    describe('keeping a reading so a rate can be worked out', () => {
        /** The readings this file's own attempt produced. */
        const readings = (attemptId) => db.sequelize.query(
            `SELECT at, progress_done, progress_total, progress_unit, job_kind
               FROM gpu_attempt_progress WHERE attempt_id = :attemptId ORDER BY at`,
            { replacements: { attemptId }, type: QueryTypes.SELECT }
        );

        it('writes a reading carrying the build kind, so the series can be narrowed', async () => {
            const worker = await seedWorker();
            const { jobId } = await seedBuild({ name: 'jest-sampled', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1 });

            await buildRepository.reportProgress(attemptId, {
                phase: 'extracting', done: 400, total: 1456, unit: 'frames',
            });

            const kept = await readings(attemptId);

            expect(kept).toHaveLength(1);
            expect(Number(kept[0].progress_done)).toBe(400);
            expect(Number(kept[0].progress_total)).toBe(1456);
            expect(kept[0].progress_unit).toBe('frames');
            /* Without this the reading is invisible to `?kind=dataset_build`, which is how
               the panel tells build work from the pool's. */
            expect(kept[0].job_kind).toBe('dataset_build');
        });

        /**
         * One row per attempt per minute. The runner reports once per 400-frame pass, which
         * on a fast video is several times a minute, and a chart cannot draw more than a
         * point a minute anyway -- so the later reading replaces the earlier rather than
         * adding to it. The unique key on `(attempt_id, at)` is what enforces it, and an
         * insert that did not say `ON CONFLICT` would throw on the second pass and, because
         * this runs inside the extraction loop, take the build with it.
         */
        it('replaces rather than adds when two reports land in the same minute', async () => {
            const worker = await seedWorker();
            const { jobId } = await seedBuild({ name: 'jest-sampled-twice', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1 });

            await buildRepository.reportProgress(attemptId, { phase: 'extracting', done: 400, total: 1456, unit: 'frames' });
            await buildRepository.reportProgress(attemptId, { phase: 'extracting', done: 800, total: 1456, unit: 'frames' });

            const kept = await readings(attemptId);

            expect(kept).toHaveLength(1);
            expect(Number(kept[0].progress_done)).toBe(800);
        });

        /**
         * The *selecting* phase reports a phase and no counts, because the total is not
         * knowable until the observations and their videos are resolved. A row claiming zero
         * there reads as "no frames in that minute" rather than "not counting yet" -- a line
         * along the floor instead of no line at all.
         */
        it('keeps no reading for a report that carries no count', async () => {
            const worker = await seedWorker();
            const { jobId } = await seedBuild({ name: 'jest-selecting-sample', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1 });

            await buildRepository.reportProgress(attemptId, { phase: 'selecting', unit: 'frames' });

            expect(await readings(attemptId)).toHaveLength(0);
        });

        /**
         * **A sample that cannot be written must not fail the build.** This runs inside the
         * extraction loop, and a build is hours of ffmpeg; losing a point off a graph is not
         * a reason to throw that away. An attempt id with no row is the cheapest way to make
         * the insert fail -- the foreign key refuses it -- and the call still resolves.
         */
        it('does not fail a build when the reading cannot be written', async () => {
            await expect(buildRepository.sampleProgress(-1, { done: 400, total: 1456, unit: 'frames' }))
                .resolves.toBeUndefined();
        });

        /**
         * And the point of all of it: the reading reaches the route the panel reads, as a
         * difference between two of them rather than as a total. Two readings a minute
         * apart, so they land in different buckets and the second differences against the
         * first.
         */
        it('reaches GET /gpu/throughput/series as a difference, under the build kind', async () => {
            const worker = await seedWorker();
            const { jobId } = await seedBuild({ name: 'jest-series', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1 });

            /* Taken before anything is seeded, so the assertion below is about the
               difference this test made rather than about the whole answer. */
            const measured = (async () => {
                const res = await global.api
                    .get('/api/v2/gpu/throughput/series')
                    .query({ kind: 'dataset_build', bucket: 'minute' });

                return (res.body.points || []).reduce((sum, p) => sum + Number(p.units_done), 0);
            })();

            await measured;

            /* Written at two chosen minutes rather than through `sampleProgress`, which
               stamps `now`: a test that waited a minute for the second bucket would take a
               minute. The shape is the one `sampleProgress` writes. */
            for (const [minutesAgo, done] of [[2, 400], [1, 1456]]) {
                await db.sequelize.query(
                    `INSERT INTO gpu_attempt_progress
                            (attempt_id, at, progress_done, progress_total, progress_unit, job_kind)
                     VALUES (:attemptId,
                             date_trunc('minute', NOW() - make_interval(mins => :minutesAgo)),
                             :done, 1456, 'frames', 'dataset_build')`,
                    { replacements: { attemptId, minutesAgo, done } }
                );
            }

            const total = async () => {
                const res = await global.api
                    .get('/api/v2/gpu/throughput/series')
                    .query({ kind: 'dataset_build', bucket: 'minute' });

                expect(res.status).toBe(200);

                return (res.body.points || []).reduce((sum, p) => sum + Number(p.units_done), 0);
            };

            const before = await measured;
            const after = await total();

            /* **The difference this test made, not the figure it produced.** A bucket is
               shared: the route groups by minute across every attempt of the kind, so an
               assertion that some bucket equals 1056 passes on an idle database and fails
               the moment a real build reports in the same minute — which is exactly how it
               failed inside `npm run test:ml` while passing on its own. 1456 - 400 is the
               work done between the two readings, and it is what this adds to the answer
               whatever else is in there. */
            expect(after - before).toBe(1056);
        });
    });

    /**
     * What a dataset is made of, which the Datasets screen drew from a fixture until now.
     *
     * The panel keyed its Build record, its split bar and its class breakdown on the
     * dataset's *name*, against five invented ones — so the first dataset MARP actually
     * built rendered a wall of em dashes with confident sentences beside them, and a split
     * bar hardcoded to 70/20/10. Both halves are recorded and neither was served.
     */
    describe('GET /api/v2/dataset/:id/composition', () => {
        /** A dataset with membership and a vocabulary, as a finished build leaves it. */
        async function seedComposed() {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, num_samples, num_observations,
                                       num_classes, created_at, updated_at)
                 VALUES (:name, 'ready', 'ml-dashboard', 120, 3, 2, NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-composition-${stamp}` }, type: QueryTypes.SELECT }
            );

            made.datasets.push(dataset.id);

            /* Two splits with different counts, so a bar drawn from them cannot pass by
               being hardcoded to anything. */
            const members = [['train', 2], ['eval', 1]];

            for (const [split, howMany] of members) {
                for (let i = 0; i < howMany; i++) {
                    /* **A real observation, because membership has a foreign key to one**
                       (`20260909120300`). Borrowing one out of the corpus would pass here
                       and fail in CI, which builds an empty database. Inserted with SQL
                       rather than through the model: `observation_id` is declared without
                       `autoIncrement`, so Sequelize sends an explicit null and the insert
                       fails -- see the repository note on #62. */
                    const [seededObservation] = await db.sequelize.query(
                        `INSERT INTO observations ("obsID", "createdAt", "updatedAt")
                         VALUES (0, NOW(), NOW())
                         RETURNING observation_id`,
                        { type: QueryTypes.SELECT }
                    );

                    made.observations.push(seededObservation.observation_id);

                    await db.sequelize.query(
                        `INSERT INTO dataset_observations
                             (dataset_id, observation_id, inclusion_type, selection_method,
                              created_at, updated_at)
                         VALUES (:dataset, :observation, :split, 'jest', NOW(), NOW())`,
                        {
                            replacements: {
                                dataset: dataset.id,
                                observation: seededObservation.observation_id,
                                split,
                            },
                        }
                    );
                }
            }

            /* **Real species, because `dataset_classes.species_id` is NOT NULL** and
               carries a foreign key. Taken from the catalogue rather than invented: the
               species import migration seeds 854 of them, so they are there in CI too,
               and this only reads them. */
            const catalogue = await db.sequelize.query(
                'SELECT id FROM species ORDER BY id LIMIT 2',
                { type: QueryTypes.SELECT }
            );

            expect(catalogue).toHaveLength(2);

            /* Deliberately inserted out of order: the route promises index order, because
               that is the order a YOLO label file indexes and reading it any other way
               renames every class. */
            for (const [index, species] of [[1, catalogue[1].id], [0, catalogue[0].id]]) {
                await db.sequelize.query(
                    `INSERT INTO dataset_classes (dataset_id, species_id, class_index, created_at, updated_at)
                     VALUES (:dataset, :species, :index, NOW(), NOW())`,
                    { replacements: { dataset: dataset.id, species, index } }
                );
            }

            return dataset.id;
        }

        it('counts the observations in each split', async () => {
            const datasetId = await seedComposed();
            const res = await global.api.get(`/api/v2/dataset/${datasetId}/composition`);

            expect(res.status).toBe(200);

            const bySplit = Object.fromEntries(res.body.splits.map((s) => [s.split, s.observations]));

            expect(bySplit).toEqual({ train: 2, eval: 1 });
        });

        it('returns the classes in index order, whatever order they were written in', async () => {
            const datasetId = await seedComposed();
            const res = await global.api.get(`/api/v2/dataset/${datasetId}/composition`);

            expect(res.status).toBe(200);
            expect(res.body.classes.map((c) => c.class_index)).toEqual([0, 1]);
        });

        /**
         * A dataset built before #268 recorded membership has neither, and that is a real
         * answer rather than an error — every legacy import is in that state. The screen
         * says so instead of drawing an empty bar.
         */
        it('answers with empty arrays for a dataset whose membership was never recorded', async () => {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, created_at, updated_at)
                 VALUES (:name, 'ready', 'legacy import', NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-legacy-${stamp}` }, type: QueryTypes.SELECT }
            );

            made.datasets.push(dataset.id);

            const res = await global.api.get(`/api/v2/dataset/${dataset.id}/composition`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ splits: [], classes: [] });
        });

        /**
         * **404 rather than the same empty answer.** They mean different things — "built
         * before membership was recorded" against "there is no such dataset" — and a
         * mistyped id that looked like an old build would send somebody looking for a
         * migration that is not the problem.
         */
        it('refuses a dataset that does not exist', async () => {
            const res = await global.api.get('/api/v2/dataset/2147483600/composition');

            expect(res.status).toBe(404);
        });

        /**
         * The archive columns reach `GET /api/v2/dataset`. They are columns on `datasets`
         * and were simply not declared on the model, so the list route could not return
         * them and the screen invented a fingerprint and an archive size keyed on the
         * dataset's name.
         */
        it('serves the archive fields on the dataset list', async () => {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, archive_path, archive_sha256,
                                       archive_bytes, created_at, updated_at)
                 VALUES (:name, 'ready', 'ml-dashboard', 'datasets/jest.tar', :sha, 541542400, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: { name: `jest-archive-${stamp}`, sha: 'a'.repeat(64) },
                    type: QueryTypes.SELECT,
                }
            );

            made.datasets.push(dataset.id);

            const res = await global.api.get('/api/v2/dataset');

            expect(res.status).toBe(200);

            const mineOnly = res.body.find((d) => d.id === dataset.id);

            expect(mineOnly).toBeDefined();
            expect(mineOnly.archive_path).toBe('datasets/jest.tar');
            expect(mineOnly.archive_sha256).toBe('a'.repeat(64));
            expect(Number(mineOnly.archive_bytes)).toBe(541542400);
        });
    });

    /**
     * The Datasets screen's *More samples* opens the Mosaic Reviewer on the query the panel
     * is describing, by writing that query as an address. The reviewer keeps its question in
     * the URL and nowhere else, so a link is a first-class way in — but it means a key
     * renamed on either side lands the reader on a *different question* rather than on an
     * error, and nothing in a browser would say so.
     *
     * These read the two declarations off disk and compare them. No database and no server:
     * what is under test is an agreement between three files.
     */
    describe('the Mosaic Reviewer link keeps the vocabulary it is written in', () => {
        const fs = require('fs');
        const path = require('path');

        const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

        /** The keys `mosaicReviewUrl` writes, taken from the arrays it writes them from. */
        function keysTheLinkWrites() {
            const source = read('frontend', 'apps', 'ml-dashboard', 'mock.js');
            const order = /const ORDER = \[([\s\S]*?)\];/.exec(source);

            expect(order).not.toBeNull();

            return order[1].split(',')
                .map((piece) => piece.trim().replace(/^'|'$/g, ''))
                .filter(Boolean);
        }

        /** The dimension keys the reviewer declares, which is what it reads an address with. */
        function keysTheReviewerReads() {
            const source = read('frontend', 'apps', 'marp-mosaic-review', 'src', 'model', 'dimensions.js');

            return [...source.matchAll(/^\s*key: '([a-zA-Z]+)'/gm)].map((m) => m[1]);
        }

        it('writes only dimensions the reviewer declares', () => {
            const declared = keysTheReviewerReads();

            expect(declared.length).toBeGreaterThan(5);

            /* A key the reviewer does not declare is ignored by `fromQuery`, so the filter
               silently does not apply and the reader reviews a wider set than the panel
               they came from was describing. */
            for (const key of keysTheLinkWrites()) {
                expect(`${key}: ${declared.includes(key)}`).toBe(`${key}: true`);
            }
        });

        /**
         * Both vocabularies are the same one. The link is built from what the screen already
         * sends to `POST /mosaic/observations/*`, so the filter keys and the URL keys have to
         * stay the same words or the translation stops being a copy and becomes a mapping
         * somebody has to maintain.
         */
        it('writes dimensions the mosaic query filters also accept', () => {
            const contract = JSON.parse(read('docs', 'openapi.generated.json'));
            const accepted = Object.keys(contract.components.schemas.MosaicQueryFilters.properties);

            /* `timeOfDay` and `date` are the two the screen has no control for yet; they are
               in the written order so the next person adding one can see where it goes.
               `date` is a reviewer dimension the filters do not take, and naming it here is
               what stops that being discovered by a link that quietly drops it. */
            const notInTheApi = ['date'];

            for (const key of keysTheLinkWrites()) {
                if (notInTheApi.includes(key)) continue;
                expect(`${key}: ${accepted.includes(key)}`).toBe(`${key}: true`);
            }
        });

        /**
         * **The link must carry `trainingDisposition=promoted`, and this is why.** Training
         * mode opens at `undecided`, and `toQuery` writes a mode's own status dimension only
         * when it differs from that default — so a link that left it out would land on the
         * observations nobody has judged yet, which is the opposite of what a dataset builder
         * is looking at. If that default ever becomes `promoted`, the link stops needing to
         * say it and this test is where that is noticed.
         */
        it('cannot rely on the reviewer defaulting to promoted', () => {
            const modes = read('frontend', 'apps', 'marp-mosaic-review', 'src', 'model', 'modes.js');
            const training = /training: \{[\s\S]*?\n  \}/.exec(modes);

            expect(training).not.toBeNull();
            expect(training[0]).toContain("statusKey: 'trainingDisposition'");

            const defaults = /defaultStatus: \[([^\]]*)\]/.exec(training[0]);

            expect(defaults).not.toBeNull();
            expect(defaults[1]).not.toContain('promoted');

            /* And the link does say it. */
            const source = read('frontend', 'apps', 'ml-dashboard', 'mock.js');

            expect(source).toContain('trainingDisposition=${filters.trainingDisposition.map(enc).join(\',\')}');
        });
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
    /**
     * The sample of frames a build cut, read back out of the archive it wrote.
     *
     * The Datasets panel showed four sample pictures per dataset and they were four
     * hardcoded Jellyfin item ids -- the same four on every row, of video unrelated to the
     * dataset beneath them. These routes serve the real frames instead, and the real boxes
     * beside them.
     *
     * **The archive here is made with `tar`, the way the builder makes one.** A reader
     * written against a tar this file encoded by hand would prove only that it agrees with
     * itself; what is worth knowing is that it reads what `service/dataset-build.service.js`
     * actually produces, headers and padding and all.
     */
    describe('GET /api/v2/dataset/:id/preview', () => {
        const fs = require('fs');
        const os = require('os');
        const nodePath = require('path');
        const { execFileSync } = require('child_process');
        const { DATASET_DIRECTORY } = require('../config/gpu-orchestration');

        /** Archive files this file wrote into dataset storage, removed in `afterAll`. */
        const archives = [];

        /**
         * Builds a real tar of a small dataset and records it on a `datasets` row.
         *
         * The images are not JPEGs -- nothing here decodes one, and the route hands back
         * whatever bytes the archive holds -- but each is distinct, which is what lets a
         * test say *which* frame came back rather than only that one did.
         *
         * @param {Object} [options] - Shape of the fixture.
         * @param {number} [options.train] - How many training frames.
         * @param {number} [options.evaluate] - How many eval frames.
         * @returns {Promise<{datasetId: number, contents: Map<string, Buffer>}>}
         */
        async function seedArchive({ train = 10, evaluate = 2 } = {}) {
            const staging = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'jest-preview-'));
            const contents = new Map();

            for (const [directory, count] of [['train', train], ['eval', evaluate]]) {
                fs.mkdirSync(nodePath.join(staging, directory, 'images'), { recursive: true });
                fs.mkdirSync(nodePath.join(staging, directory, 'labels'), { recursive: true });

                for (let i = 0; i < count; i++) {
                    const stem = `${directory}_video_${String(i).padStart(8, '0')}`;

                    /* Distinct bytes per frame, and long enough to span more than one
                       512-byte tar block so the padding arithmetic is actually exercised. */
                    const bytes = Buffer.alloc(1100 + i, `${directory[0]}${i % 10}`);

                    contents.set(`${directory}/images/${stem}.jpg`, bytes);
                    fs.writeFileSync(nodePath.join(staging, directory, 'images', `${stem}.jpg`), bytes);

                    /* One box per frame, at a position derived from the index, so a test
                       can say the boxes came back with the frame they belong to. */
                    fs.writeFileSync(
                        nodePath.join(staging, directory, 'labels', `${stem}.txt`),
                        `${i % 3} ${(0.1 + i / 100).toFixed(6)} 0.500000 0.200000 0.300000\n`
                    );
                }
            }

            fs.writeFileSync(nodePath.join(staging, 'data.yaml'), 'names:\n- One\nnc: 1\n');
            fs.mkdirSync(DATASET_DIRECTORY, { recursive: true });

            const file = `jest-preview-${stamp}-${archives.length + 1}.tar`;

            // A bare name with `-C`, because a drive letter's colon reads as a remote host.
            execFileSync('tar', ['-cf', file, '-C', staging, 'train', 'eval', 'data.yaml'],
                { cwd: DATASET_DIRECTORY, stdio: 'pipe' });

            archives.push(nodePath.join(DATASET_DIRECTORY, file));
            fs.rmSync(staging, { recursive: true, force: true });

            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, archive_path, archive_sha256,
                                       archive_bytes, created_at, updated_at)
                 VALUES (:name, 'ready', 'ml-dashboard', :path, :sha, :bytes, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: {
                        name: `jest-preview-${stamp}-${archives.length}`,
                        path: `datasets/${file}`,
                        /* The hash keys the preview's cache, so two fixtures sharing one
                           would serve the first one's frames for the second one's dataset
                           -- which this makes impossible rather than catches. */
                        sha: `${stamp}${archives.length}`.padStart(64, 'f').slice(-64),
                        bytes: fs.statSync(nodePath.join(DATASET_DIRECTORY, file)).size,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            made.datasets.push(dataset.id);

            return { datasetId: dataset.id, contents };
        }

        afterAll(() => {
            for (const file of archives) fs.rmSync(file, { force: true });
        });

        it('serves frames out of the archive with the boxes their label files record', async () => {
            const { datasetId } = await seedArchive();
            const res = await global.api.get(`/api/v2/dataset/${datasetId}/preview?limit=4`);

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(12);
            expect(res.body.frames).toHaveLength(4);

            for (const frame of res.body.frames) {
                expect(['train', 'eval']).toContain(frame.split);
                expect(frame.boxes).toHaveLength(1);

                /* YOLO, and centre-origin: the builder writes `cx cy w h`, and a reader
                   treating x and y as the top-left corner draws every box down and right
                   by half its own size -- wrong in a way that looks plausible. */
                expect(frame.boxes[0].w).toBeCloseTo(0.2, 5);
                expect(frame.boxes[0].h).toBeCloseTo(0.3, 5);
                expect(frame.boxes[0].cy).toBeCloseTo(0.5, 5);
            }
        });

        /**
         * **The sample is spread, and this is the test for that decision.**
         *
         * A build interpolates between keyframes, so the images sit in the archive in shot
         * order and the first N are one animal a fortieth of a second apart. Taking the
         * front of the archive is cheaper to write and produces a preview that cannot show
         * that a build covered two splits, let alone several videos.
         */
        it('spreads the sample across the archive rather than taking the front of it', async () => {
            const { datasetId } = await seedArchive();
            const res = await global.api.get(`/api/v2/dataset/${datasetId}/preview?limit=4`);

            expect(res.status).toBe(200);

            const splits = new Set(res.body.frames.map((frame) => frame.split));

            /* The fixture is ten train frames then two eval, so the front four are all
               train and only an even stride reaches the eval ones. */
            expect(splits.has('train')).toBe(true);
            expect(splits.has('eval')).toBe(true);
        });

        it('serves one frame as the bytes the archive holds for it', async () => {
            const { datasetId, contents } = await seedArchive();
            const listing = await global.api.get(`/api/v2/dataset/${datasetId}/preview?limit=4`);

            expect(listing.status).toBe(200);

            const first = listing.body.frames[0];
            const res = await global.api
                .get(`/api/v2/dataset/${datasetId}/preview/0?limit=4`)
                .buffer()
                .parse((response, callback) => {
                    const chunks = [];

                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => callback(null, Buffer.concat(chunks)));
                });

            expect(res.status).toBe(200);

            /* Byte-identical to what went in, which is the whole claim: the offset and the
               length come off the tar header, and either being wrong still gives bytes
               that look like a plausible image response. */
            const expected = [...contents].find(([name]) => name.includes(first.stem))[1];

            expect(Buffer.compare(res.body, expected)).toBe(0);
        });

        /**
         * Immutable, and said so. An archive is named for its own hash, so these bytes
         * cannot change under a reader; the dashboard opens the same panel repeatedly and
         * should not re-fetch eight full-size frames each time.
         */
        it('answers 304 to a conditional request carrying the frame tag', async () => {
            const { datasetId } = await seedArchive();

            const first = await global.api.get(`/api/v2/dataset/${datasetId}/preview/0?limit=4`);

            expect(first.status).toBe(200);
            expect(first.headers.etag).toBeTruthy();
            expect(first.headers['cache-control']).toMatch(/immutable/);

            const again = await global.api
                .get(`/api/v2/dataset/${datasetId}/preview/0?limit=4`)
                .set('If-None-Match', first.headers.etag);

            expect(again.status).toBe(304);
        });

        it('refuses a frame past the end of the sample', async () => {
            const { datasetId } = await seedArchive();
            const res = await global.api.get(`/api/v2/dataset/${datasetId}/preview/99?limit=4`);

            expect(res.status).toBe(404);
        });

        /**
         * A dataset with no archive is a 404 rather than an empty sample, because the two
         * mean different things: a build that failed at packaging has no frames to show,
         * and an empty list would read as a build that cut none.
         */
        it('refuses a dataset that was never packaged', async () => {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, created_at, updated_at)
                 VALUES (:name, 'ready', 'legacy import', NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-unpackaged-${stamp}` }, type: QueryTypes.SELECT }
            );

            made.datasets.push(dataset.id);

            const res = await global.api.get(`/api/v2/dataset/${dataset.id}/preview`);

            expect(res.status).toBe(404);
        });

        /**
         * These serve pictures of survey video out of the archive, so the gate matters as
         * much here as it does on the archive itself.
         */
        it('refuses a request carrying no principal', async () => {
            const request = require('supertest');
            const app = require('../app');

            const res = await request(app).get('/api/v2/dataset/1/preview');

            expect(res.status).toBe(401);
        });
    });

    /**
     * What a running build writes onto its own dataset row, rather than only when it ends.
     *
     * Isaac, watching one: *"the frames get bigger, the elapsed time passes, etc. but the
     * updated table does not update, and when we queue it up, shouldn't it have the number
     * of observations and classes, those only seem to be updated at the end right now?"*
     * Both were real and they are separate -- one is a timestamp never touched until the
     * end, the other two columns whose answer is known hours before it is written.
     */
    describe('what a build writes while it is still running', () => {

        /**
         * Puts a dataset's timestamps in the past, so a write during the test is visible
         * as a move rather than as two values a few milliseconds apart.
         *
         * @param {number} datasetId - A dataset this file created.
         * @returns {Promise<string>} The backdated `updated_at`.
         */
        async function backdate(datasetId) {
            const [row] = await db.sequelize.query(
                `UPDATE datasets SET updated_at = NOW() - INTERVAL '10 minutes'
                  WHERE id = :datasetId
                 RETURNING updated_at`,
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            return row.updated_at;
        }

        /**
         * **The defect, stated as a test.** The Datasets table showed a frame count
         * climbing and an elapsed clock ticking beside an `Updated` column frozen at the
         * moment the build was queued, which reads as a row nothing is maintaining. On
         * dataset 381 it said created 22:19:27 and updated 22:25:06 -- and 22:25:06 was
         * when the build finished, five and a half minutes of work with no sign of it.
         */
        it('moves the dataset Updated timestamp when the build reports progress', async () => {
            const worker = await seedWorker();
            const { jobId, datasetId } = await seedBuild({ name: 'jest-touch', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1, phase: 'selecting' });
            const before = await backdate(datasetId);

            await buildRepository.reportProgress(attemptId, {
                done: 40, total: 400, unit: 'frames', phase: 'extracting 1/2 a-video',
            });

            const [after] = await db.sequelize.query(
                'SELECT updated_at FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before));
        });

        /**
         * The dataset is found through the job's `spec`, so the obvious way to get this
         * wrong is an update whose `WHERE` does not actually narrow -- which would touch
         * every dataset in the table on every report and be invisible on a database
         * holding one.
         */
        it('touches only the dataset its own job names', async () => {
            const worker = await seedWorker();
            const mineBuild = await seedBuild({ name: 'jest-touch-mine', state: 'leased' });
            const other = await seedBuild({ name: 'jest-touch-other', state: 'queued' });
            const attemptId = await seedAttempt({ jobId: mineBuild.jobId, workerId: worker, epoch: 1 });

            await backdate(mineBuild.datasetId);

            const untouched = await backdate(other.datasetId);

            await buildRepository.reportProgress(attemptId, { done: 1, total: 2, unit: 'frames' });

            const [after] = await db.sequelize.query(
                'SELECT updated_at FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId: other.datasetId }, type: QueryTypes.SELECT }
            );

            expect(Date.parse(after.updated_at)).toBe(Date.parse(untouched));
        });

        /**
         * **Known when selecting ends, not when the build does.** Resolving the filters is
         * what produces the observations and the vocabulary; everything after it is cutting
         * frames out of video, which is where the hours go. The screen has had columns for
         * both the whole time -- it was the server not filling them.
         */
        it('records the observation and class counts as soon as selection resolves', async () => {
            const { datasetId } = await seedBuild({ name: 'jest-selected', state: 'leased' });

            await buildRepository.recordSelection({ datasetId, observations: 115, classes: 3 });

            const [row] = await db.sequelize.query(
                'SELECT num_observations, num_classes, num_samples FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(row.num_observations).toBe(115);
            expect(row.num_classes).toBe(3);

            /* **And not `num_samples`.** That column means images, and the only honest
               image count mid-build is how many have been cut so far -- which the Frames
               cell already shows live off the attempt row. Writing the planned total here
               would make one column mean "intended" on a running row and "written" on a
               finished one. */
            expect(row.num_samples).toBeNull();
        });

        /**
         * A build that failed after selection holds no membership -- `recordBuild` writes
         * `dataset_observations` and it never ran -- so a count left behind would have the
         * table row claiming 115 observations while the panel it expands into, which counts
         * that table live, says none were recorded. Two numbers for one thing.
         */
        it('clears the selection counts when the build fails', async () => {
            const worker = await seedWorker();
            const { jobId, datasetId } = await seedBuild({ name: 'jest-selected-failed', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1 });

            await buildRepository.recordSelection({ datasetId, observations: 115, classes: 3 });
            await buildRepository.failBuild({
                jobId,
                attemptId,
                datasetId,
                reason: 'seeded by tests/dataset-build-progress',
            });

            const [row] = await db.sequelize.query(
                'SELECT status, num_observations, num_classes FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(row.status).toBe('failed');
            expect(row.num_observations).toBeNull();
            expect(row.num_classes).toBeNull();
        });
    });

    /**
     * How many builds run at once, which is a number Isaac is going to turn while
     * watching the media server rather than one anybody can derive.
     *
     * *"Let's allow two or three builds at once and see how Jellyfin copes."* The second
     * half of that is why this is an environment variable: a judgement formed by watching
     * is worth nothing if acting on it means editing code and redeploying.
     *
     * **Only the parsing is exercised here, deliberately.** Proving the ceiling by running
     * builds would mean calling `claimBuild`, which takes the oldest queued
     * `dataset_build` job on the database the suite is pointed at -- and on a development
     * machine that may be a real build somebody queued a minute ago. Claiming it would
     * flip it to `leased`, open an attempt nothing is running, and strand it exactly the
     * way an API left running beside `npm test` does. That is the hazard `DATASET_BUILDS`
     * exists for and it is not worth re-creating to assert a number.
     */
    describe('how many builds run at once', () => {
        const buildService = require('../service/dataset-build.service');

        /** Restored after each case: the suite shares one process with everything else. */
        const original = process.env.DATASET_BUILD_CONCURRENCY;

        afterEach(() => {
            if (original === undefined) delete process.env.DATASET_BUILD_CONCURRENCY;
            else process.env.DATASET_BUILD_CONCURRENCY = original;
        });

        it('runs two at once when nothing says otherwise', () => {
            delete process.env.DATASET_BUILD_CONCURRENCY;

            expect(buildService.concurrency()).toBe(buildService.DEFAULT_CONCURRENCY);
            expect(buildService.DEFAULT_CONCURRENCY).toBe(2);
        });

        it('takes the number it is given', () => {
            process.env.DATASET_BUILD_CONCURRENCY = '3';

            expect(buildService.concurrency()).toBe(3);
        });

        /**
         * **Read per call, not captured at load.** The whole point is that the number can
         * be changed; one read into a module-level constant would mean the variable was
         * documented and inert, which is worse than not having it.
         */
        it('reads the variable again rather than remembering the first answer', () => {
            process.env.DATASET_BUILD_CONCURRENCY = '3';
            expect(buildService.concurrency()).toBe(3);

            process.env.DATASET_BUILD_CONCURRENCY = '1';
            expect(buildService.concurrency()).toBe(1);
        });

        /**
         * Zero and below fall back rather than stopping builds. Stopping them is a thing
         * somebody may well want, and `DATASET_BUILDS=off` is how it is said -- out loud,
         * with a log line. A silent halt from a mistyped number is the failure nobody
         * diagnoses, because every part of the screen still works and nothing ever builds.
         */
        it('ignores a value that would stop builds silently', () => {
            for (const bad of ['0', '-1', '', 'two', 'off']) {
                process.env.DATASET_BUILD_CONCURRENCY = bad;

                expect(buildService.concurrency()).toBe(buildService.DEFAULT_CONCURRENCY);
            }
        });

        /** A fractional value is floored, not rounded up past what was asked for. */
        it('does not round a fraction up into another build', () => {
            process.env.DATASET_BUILD_CONCURRENCY = '2.9';

            expect(buildService.concurrency()).toBe(2);
        });
    });

    /**
     * What happens to a dataset when its build is cancelled and nobody is running it.
     *
     * Cancelling goes through `POST /gpu/jobs/:id/cancel`, which is kind-agnostic and
     * already worked for a `dataset_build` -- no route was added. A *running* build polls
     * that state once per pass and calls `failBuild` itself, which is the path that also
     * deletes the staging directory.
     *
     * **A queued build has nobody to notice**, and that was the defect. `claimBuild` only
     * ever selects `state = 'queued'`, so a cancelled job is never picked up, `failBuild`
     * is never reached, and the dataset sits at `building` for ever with nothing building
     * it. `reclaimAbandonedBuilds` cannot see it either -- it wants a `leased` job with an
     * expired attempt and this has neither.
     */
    describe('settling a dataset whose build was cancelled', () => {

        /** What the dataset row says now. */
        async function datasetRow(datasetId) {
            const [row] = await db.sequelize.query(
                'SELECT status, num_observations, num_classes FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            return row;
        }

        /**
         * **The defect.** Queue a build, cancel it before anything claims it, and the
         * dataset is stranded at `building` until somebody notices by hand.
         */
        it('returns a queued build\'s dataset to draft', async () => {
            const { jobId, datasetId } = await seedBuild({ name: 'jest-cancel-queued', state: 'queued' });

            await db.sequelize.query(
                "UPDATE gpu_jobs SET state = 'cancelled', finished_at = NOW() WHERE id = :jobId",
                { replacements: { jobId } }
            );

            expect((await datasetRow(datasetId)).status).toBe('building');
            expect(await buildRepository.settleCancelledBuilds()).toBeGreaterThanOrEqual(1);
            expect((await datasetRow(datasetId)).status).toBe('draft');
        });

        /**
         * **The runner owns a build it is still running**, and this must not race it. It
         * is the only thing that can delete the staging directory it opened, so settling
         * the row underneath it would report the build over while gigabytes were still
         * being written. A live lease is what "still running" means -- the same test
         * `reclaimAbandonedBuilds` uses, for the same reason.
         */
        it('leaves a cancelled build alone while a runner is still reporting on it', async () => {
            const worker = await seedWorker();
            const { jobId, datasetId } = await seedBuild({ name: 'jest-cancel-live', state: 'leased' });

            await seedAttempt({ jobId, workerId: worker, epoch: 1, done: 40, total: 400 });
            await db.sequelize.query(
                "UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :jobId",
                { replacements: { jobId } }
            );

            await buildRepository.settleCancelledBuilds();

            expect((await datasetRow(datasetId)).status).toBe('building');
        });

        /**
         * And the mirror image: a build cancelled while leased whose runner then died.
         * The attempt is stuck `running`, the job is `cancelled` rather than `leased`, so
         * reclaiming cannot see it and no runner will ever report again. Both the attempt
         * and the dataset are closed here, or the attempt stays `running` for ever.
         */
        it('settles one whose runner died, and closes the attempt it left behind', async () => {
            const worker = await seedWorker();
            const { jobId, datasetId } = await seedBuild({ name: 'jest-cancel-dead', state: 'leased' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1, done: 40, total: 400 });

            await db.sequelize.query(
                `UPDATE gpu_job_attempts SET lease_expires_at = NOW() - INTERVAL '2 hours'
                  WHERE id = :attemptId`,
                { replacements: { attemptId } }
            );
            await db.sequelize.query(
                "UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :jobId",
                { replacements: { jobId } }
            );

            await buildRepository.settleCancelledBuilds();

            const [attempt] = await db.sequelize.query(
                'SELECT state, failure_reason FROM gpu_job_attempts WHERE id = :attemptId',
                { replacements: { attemptId }, type: QueryTypes.SELECT }
            );

            expect((await datasetRow(datasetId)).status).toBe('draft');
            expect(attempt.state).toBe('cancelled');
            expect(attempt.failure_reason).toMatch(/did not report back/i);
        });

        /**
         * The selection counts go with the status, for the reason `failBuild` clears
         * them: `recordBuild` writes the membership and it never ran, so a count left
         * behind describes rows that are not there -- and the panel, which counts that
         * table live, would disagree with the row it expands from.
         */
        it('clears the counts a selection had already written', async () => {
            const { jobId, datasetId } = await seedBuild({ name: 'jest-cancel-counted', state: 'queued' });

            await buildRepository.recordSelection({ datasetId, observations: 115, classes: 3 });
            await db.sequelize.query(
                "UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :jobId",
                { replacements: { jobId } }
            );

            await buildRepository.settleCancelledBuilds();

            const row = await datasetRow(datasetId);

            expect(row.status).toBe('draft');
            expect(row.num_observations).toBeNull();
            expect(row.num_classes).toBeNull();
        });

        /** A build nobody cancelled is none of this function's business. */
        it('does not touch a build that is merely queued', async () => {
            const { datasetId } = await seedBuild({ name: 'jest-cancel-untouched', state: 'queued' });

            await buildRepository.settleCancelledBuilds();

            expect((await datasetRow(datasetId)).status).toBe('building');
        });

        /**
         * It runs on every poll, so running it twice has to be free. The second pass
         * matches nothing: the dataset is no longer `building` and the attempt is no
         * longer `running`, which is what the guard in the CTE is for.
         */
        it('does nothing the second time', async () => {
            const { jobId } = await seedBuild({ name: 'jest-cancel-twice', state: 'queued' });

            await db.sequelize.query(
                "UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :jobId",
                { replacements: { jobId } }
            );

            await buildRepository.settleCancelledBuilds();

            expect(await buildRepository.settleCancelledBuilds()).toBe(0);
        });
    });

    /**
     * Deleting a dataset, and the two things that stop it.
     *
     * *"Delete everything, but refuse if a model was trained from that dataset."* That
     * rule is the schema's: `dataset_observations` and `dataset_classes` cascade, and
     * `training_runs.dataset_id` is `NO ACTION`, so PostgreSQL blocks the delete while a
     * run points at the row. **The `NO ACTION` is the guard, not an oversight** -- a
     * dataset is the answer to *what was this model trained on* -- and the test below
     * that proves a trained-from dataset survives is the one that must never be relaxed
     * into a cascade to make it pass.
     */
    describe('DELETE /api/v2/dataset/:id', () => {
        const fs = require('fs');
        const nodePath = require('path');
        const { DATASET_DIRECTORY } = require('../config/gpu-orchestration');

        /** Training runs this block created, removed before the datasets they point at. */
        const runs = [];

        /** And the models those runs name, removed after the runs that reference them. */
        const models = [];

        /**
         * A dataset with membership, a vocabulary and a file on disk, as a build leaves it.
         *
         * @param {string} label - Distinguishes it within this file.
         * @returns {Promise<{datasetId: number, archive: string}>}
         */
        async function seedDeletable(label) {
            const file = `jest-delete-${stamp}-${label}.tar`;
            const archive = nodePath.join(DATASET_DIRECTORY, file);

            fs.mkdirSync(DATASET_DIRECTORY, { recursive: true });
            fs.writeFileSync(archive, 'not a real archive, but a real file');

            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, archive_path, archive_bytes,
                                       num_samples, created_at, updated_at)
                 VALUES (:name, 'ready', 'ml-dashboard', :path, 35, 2, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: { name: `jest-delete-${stamp}-${label}`, path: `datasets/${file}` },
                    type: QueryTypes.SELECT,
                }
            );

            made.datasets.push(dataset.id);

            /* Both cascading children, so the test can say they went rather than assuming
               the schema does what the schema says.

               A real `observations` row, because `dataset_observations.observation_id`
               carries a foreign key to it -- a made-up negative id is refused, which is
               how this was first written. Inserted with SQL rather than through the
               model: `observation_id` is declared without `autoIncrement`, so Sequelize
               sends an explicit null and the insert fails (#62). */
            const [observation] = await db.sequelize.query(
                `INSERT INTO observations ("obsID", "createdAt", "updatedAt")
                 VALUES (0, NOW(), NOW())
                 RETURNING observation_id`,
                { type: QueryTypes.SELECT }
            );

            made.observations.push(observation.observation_id);

            await db.sequelize.query(
                `INSERT INTO dataset_observations
                     (dataset_id, observation_id, inclusion_type, selection_method, created_at, updated_at)
                 VALUES (:dataset, :observation, 'train', 'jest', NOW(), NOW())`,
                { replacements: { dataset: dataset.id, observation: observation.observation_id } }
            );

            const [species] = await db.sequelize.query(
                'SELECT id FROM species ORDER BY id LIMIT 1',
                { type: QueryTypes.SELECT }
            );

            await db.sequelize.query(
                `INSERT INTO dataset_classes (dataset_id, species_id, class_index, created_at, updated_at)
                 VALUES (:dataset, :species, 0, NOW(), NOW())`,
                { replacements: { dataset: dataset.id, species: species.id } }
            );

            return { datasetId: dataset.id, archive };
        }

        afterAll(async () => {
            /* Before the datasets go: a run is what blocks their delete, which is the
               whole point of this block. */
            for (const id of runs) {
                await db.sequelize.query('DELETE FROM training_runs WHERE id = :id',
                    { replacements: { id } });
            }

            for (const id of models) {
                await db.sequelize.query('DELETE FROM ml_models WHERE id = :id',
                    { replacements: { id } });
            }

            for (const label of ['kept', 'trained']) {
                fs.rmSync(nodePath.join(DATASET_DIRECTORY, `jest-delete-${stamp}-${label}.tar`), { force: true });
            }
        });

        it('deletes the dataset, its membership, its classes and its archive', async () => {
            const { datasetId, archive } = await seedDeletable('gone');

            expect(fs.existsSync(archive)).toBe(true);

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ deleted: true, archive_removed: true });
            expect(fs.existsSync(archive)).toBe(false);

            const [row] = await db.sequelize.query(
                'SELECT id FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(row).toBeUndefined();

            /* The cascades, asserted rather than assumed. A migration that quietly changed
               one to `NO ACTION` would otherwise show up as an unexplained 500 much later. */
            const [left] = await db.sequelize.query(
                `SELECT (SELECT count(*)::int FROM dataset_observations WHERE dataset_id = :datasetId) AS members,
                        (SELECT count(*)::int FROM dataset_classes WHERE dataset_id = :datasetId) AS classes`,
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(left).toEqual({ members: 0, classes: 0 });
        });

        /**
         * **The rule, and the archive stays too.** A refusal that deleted the file anyway
         * would leave a dataset that exists, says it has an archive, and serves a 404 for
         * it -- which is worse than either outcome on its own, and is why the route
         * removes the file only after the row is gone.
         */
        it('refuses a dataset a model was trained from, and leaves its archive alone', async () => {
            const { datasetId, archive } = await seedDeletable('trained');

            /* `training_runs.model_id` is NOT NULL, so the model comes first -- and it
               is the model's name the refusal quotes, since a run has none of its own. */
            const [model] = await db.sequelize.query(
                `INSERT INTO ml_models (name, model_type, status, preferred, created_at, updated_at)
                 VALUES (:name, 'detection', 'registered', false, NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-model-${stamp}` }, type: QueryTypes.SELECT }
            );

            models.push(model.id);

            const [run] = await db.sequelize.query(
                `INSERT INTO training_runs (dataset_id, model_id, notes, created_at, updated_at)
                 VALUES (:datasetId, :modelId, 'seeded by tests/dataset-build-progress', NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: { datasetId, modelId: model.id },
                    type: QueryTypes.SELECT,
                }
            );

            runs.push(run.id);

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(409);
            /* Naming the run is the useful half: it is what somebody needs to decide
               whether the training still matters. */
            expect(res.body.error.message).toMatch(new RegExp(`#${run.id}`));
            expect(res.body.error.message).toContain(`jest-model-${stamp}`);
            expect(res.body.error.message).toMatch(/train/i);

            const [row] = await db.sequelize.query(
                'SELECT id FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(row).toBeDefined();
            expect(fs.existsSync(archive)).toBe(true);
        });

        /**
         * A build in flight holds a staging directory and is about to write this row.
         * Deleting underneath it makes its own completion the error, so it is refused and
         * told to cancel -- one press, which takes effect within a pass.
         */
        it('refuses a dataset that is still building, and says to cancel it', async () => {
            const { datasetId } = await seedBuild({ name: 'jest-delete-building', state: 'leased' });

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(409);
            expect(res.body.error.message).toMatch(/cancel/i);
        });

        it('refuses a dataset that does not exist', async () => {
            const res = await global.api.delete('/api/v2/dataset/2147483600');

            expect(res.status).toBe(404);
        });

        /**
         * A row whose archive was already removed by hand still deletes. The row is the
         * thing being deleted; a missing file is one less thing to do, not a failure.
         */
        it('deletes a dataset whose archive is already gone', async () => {
            const { datasetId, archive } = await seedDeletable('kept');

            fs.rmSync(archive, { force: true });

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ deleted: true, archive_removed: false });
        });

        /**
         * **A failed build is the one somebody most wants rid of**, and it was the one
         * that could not be deleted: the control lived in the ready panel's footer, and a
         * failed build draws a different panel. Isaac found it the hour after delete
         * shipped. The route always allowed it -- only `building` is refused -- so this
         * pins the server half so a future guard cannot quietly widen and take it away.
         */
        it('deletes a dataset whose build failed', async () => {
            const { datasetId } = await seedBuild({ name: 'jest-delete-failed', state: 'failed' });

            await db.sequelize.query(
                "UPDATE datasets SET status = 'failed' WHERE id = :datasetId",
                { replacements: { datasetId } }
            );

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);
            expect(res.body.deleted).toBe(true);
            /* It never packaged anything, so there was no file -- which is reported as
               false rather than as a failure. */
            expect(res.body.archive_removed).toBe(false);
        });

        /**
         * A cancelled build lands in `draft`, which is finished rather than running. It
         * must not be caught by the guard that refuses a build in flight, or cancelling
         * would make a dataset permanently undeletable -- a worse version of the bug
         * being fixed.
         */
        it('deletes a dataset whose build was cancelled', async () => {
            const { jobId, datasetId } = await seedBuild({ name: 'jest-delete-cancelled', state: 'queued' });

            await db.sequelize.query(
                "UPDATE gpu_jobs SET state = 'cancelled' WHERE id = :jobId",
                { replacements: { jobId } }
            );

            await buildRepository.settleCancelledBuilds();

            const [row] = await db.sequelize.query(
                'SELECT status FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(row.status).toBe('draft');

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);
        });

        /**
         * And the refusal is not special-cased away for them. A failed dataset will not
         * normally have a training run, but the rule is the rule -- an exception carved
         * for a state is how it stops being true later.
         */
        it('still refuses a failed dataset a model was trained from', async () => {
            const { datasetId } = await seedBuild({ name: 'jest-delete-failed-trained', state: 'failed' });

            await db.sequelize.query(
                "UPDATE datasets SET status = 'failed' WHERE id = :datasetId",
                { replacements: { datasetId } }
            );

            const [model] = await db.sequelize.query(
                `INSERT INTO ml_models (name, model_type, status, preferred, created_at, updated_at)
                 VALUES (:name, 'detection', 'registered', false, NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-model-failed-${stamp}` }, type: QueryTypes.SELECT }
            );

            models.push(model.id);

            const [run] = await db.sequelize.query(
                `INSERT INTO training_runs (dataset_id, model_id, notes, created_at, updated_at)
                 VALUES (:datasetId, :modelId, 'seeded by tests/dataset-build-progress', NOW(), NOW())
                 RETURNING id`,
                { replacements: { datasetId, modelId: model.id }, type: QueryTypes.SELECT }
            );

            runs.push(run.id);

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(409);
        });

        /**
         * **A build whose dataset is gone is not a build this screen can show.**
         *
         * Nothing links `gpu_jobs` to `datasets` by a foreign key -- the association is
         * `spec->>'dataset_id'` -- so deleting a dataset leaves its build job behind, and
         * the builds route went on serving it. The delete route's own description claimed
         * such a job "simply stops appearing" here; it did not, and three of them were
         * being served on the development database.
         *
         * The job row is deliberately kept: it is the record that the work happened, with
         * its attempt, its failure reason and the spec saying what was asked for. It
         * belongs on the Jobs screen. It does not belong on a screen about datasets,
         * where it is a row that cannot be opened, downloaded or deleted.
         */
        it('stops serving a build once its dataset is deleted', async () => {
            const { jobId, datasetId } = await seedBuild({ name: 'jest-orphan', state: 'failed' });

            /* Asked through the route, which is the tier the screen reads. */
            const seen = async () => {
                const res = await global.api.get('/api/v2/dataset/builds');

                expect(res.status).toBe(200);

                return res.body.some((row) => row.job_id === jobId);
            };

            expect(await seen()).toBe(true);

            await db.sequelize.query(
                "UPDATE datasets SET status = 'failed' WHERE id = :datasetId",
                { replacements: { datasetId } }
            );

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);

            /* **The job goes with it now, and this assertion is the reverse of what it
               was.** It used to pin the opposite -- that a job survives its dataset as the
               record that work happened. Isaac objected twice: once when the Datasets
               summary counted the orphans, and again when he deleted a dataset here and
               met its build still listed on the Jobs screen. The reasoning for keeping
               them was sound and his workflow outvoted it. */
            const [job] = await db.sequelize.query(
                'SELECT id FROM gpu_jobs WHERE id = :jobId',
                { replacements: { jobId }, type: QueryTypes.SELECT }
            );

            expect(job).toBeUndefined();
            expect(res.body.jobs_deleted).toContain(jobId);

            /* And the join still earns its place: a job that *cannot* be deleted --
               one holding an artifact -- must still not be served here. */
            expect(await seen()).toBe(false);
        });

        /**
         * **A job holding an artifact refuses, and the dataset goes anyway.**
         *
         * `artifacts.job_id` is `RESTRICT`, so that job cannot be deleted. The caller
         * asked to remove a *dataset*; failing the whole thing because of a job row they
         * cannot see would be the complaint this change exists to answer, arriving in a
         * new form. So the refusal is reported and the delete succeeds.
         *
         * The savepoint is what makes that possible: a foreign-key violation aborts the
         * transaction it happens in, so without one the refusal would take the dataset
         * delete down with it.
         */
        it('keeps a build job that holds an artifact, and still deletes the dataset', async () => {
            const { jobId, datasetId } = await seedBuild({ name: 'jest-delete-artifact', state: 'failed' });

            await db.sequelize.query(
                "UPDATE datasets SET status = 'failed' WHERE id = :datasetId",
                { replacements: { datasetId } }
            );

            const [artifact] = await db.sequelize.query(
                `INSERT INTO artifacts (job_id, artifact_type, path, created_at, updated_at)
                 VALUES (:jobId, 'weights', :path, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: { jobId, path: `jest/${stamp}-weights.pt` },
                    type: QueryTypes.SELECT,
                }
            );

            made.artifacts.push(artifact.id);

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);
            expect(res.body.deleted).toBe(true);
            expect(res.body.jobs_kept).toContain(jobId);
            expect(res.body.jobs_deleted).not.toContain(jobId);

            const [dataset] = await db.sequelize.query(
                'SELECT id FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            const [job] = await db.sequelize.query(
                'SELECT id FROM gpu_jobs WHERE id = :jobId',
                { replacements: { jobId }, type: QueryTypes.SELECT }
            );

            // The dataset is gone; the job that could not go is still there.
            expect(dataset).toBeUndefined();
            expect(job).toBeDefined();
        });

        /**
         * The attempts, their events and their progress samples go with the job, by
         * cascade rather than by this code deleting them. Asserted because a migration
         * that quietly changed one of those rules would otherwise leave rows nobody looks
         * for, pointing at a job that no longer exists.
         */
        it('takes the attempts, events and progress samples with the job', async () => {
            const worker = await seedWorker();
            const { jobId, datasetId } = await seedBuild({ name: 'jest-delete-cascade', state: 'failed' });
            const attemptId = await seedAttempt({ jobId, workerId: worker, epoch: 1, done: 5, total: 10 });

            await db.sequelize.query(
                `INSERT INTO gpu_job_events (attempt_id, seq, at, kind, payload)
                 VALUES (:attemptId, 1, NOW(), 'note', '{}'::jsonb)`,
                { replacements: { attemptId } }
            );

            await db.sequelize.query(
                `INSERT INTO gpu_attempt_progress
                     (attempt_id, at, progress_done, progress_total, progress_unit, job_kind)
                 VALUES (:attemptId, date_trunc('minute', NOW()), 5, 10, 'frames', 'dataset_build')`,
                { replacements: { attemptId } }
            );

            await db.sequelize.query(
                "UPDATE datasets SET status = 'failed' WHERE id = :datasetId",
                { replacements: { datasetId } }
            );

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);

            const [left] = await db.sequelize.query(
                `SELECT (SELECT count(*)::int FROM gpu_job_attempts WHERE job_id = :jobId) AS attempts,
                        (SELECT count(*)::int FROM gpu_job_events WHERE attempt_id = :attemptId) AS events,
                        (SELECT count(*)::int FROM gpu_attempt_progress WHERE attempt_id = :attemptId) AS samples`,
                { replacements: { jobId, attemptId }, type: QueryTypes.SELECT }
            );

            expect(left).toEqual({ attempts: 0, events: 0, samples: 0 });
        });

        /** It writes, so it is not the read permission, and certainly not anonymous. */
        it('refuses a request carrying no principal', async () => {
            const request = require('supertest');
            const app = require('../app');

            const res = await request(app).delete('/api/v2/dataset/1');

            expect(res.status).toBe(401);
        });
    });

    /**
     * Images per split, recorded by the build.
     *
     * Isaac asked the Composition panel for three numbers per split -- percentage,
     * observations, images -- and the third had nowhere to come from.
     * `dataset_observations` records which split an observation went to and nothing about
     * how many frames it became: one observation is a span between keyframes, and 164 of
     * them became 15,020 images in the first large build.
     *
     * **It shipped counting the archive and then stopped.** Walking the tar is honest --
     * it is what a training run reads -- but Isaac's objection settled it: *"i'd rather
     * not have to count the images in each archive everytime we have to load the thing."*
     * The archive is immutable, so the number cannot change after the build, and
     * re-deriving a constant on every panel open is a read nobody needs to pay for. The
     * walk survives in `scripts/backfill-split-images.js`, which does it once.
     */
    describe('images per split', () => {

        /** Writes a recorded count, the way a finished build does. */
        async function recordSplit(datasetId, split, images) {
            await db.sequelize.query(
                `INSERT INTO dataset_splits (dataset_id, split, images, created_at, updated_at)
                 VALUES (:datasetId, :split, :images, NOW(), NOW())`,
                { replacements: { datasetId, split, images } }
            );
        }

        /** A dataset with membership in the splits named, and nothing recorded yet. */
        async function seedMembership(label, counts) {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, created_at, updated_at)
                 VALUES (:name, 'ready', 'ml-dashboard', NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-splits-${stamp}-${label}` }, type: QueryTypes.SELECT }
            );

            made.datasets.push(dataset.id);

            for (const [split, howMany] of Object.entries(counts)) {
                for (let i = 0; i < howMany; i++) {
                    const [observation] = await db.sequelize.query(
                        `INSERT INTO observations ("obsID", "createdAt", "updatedAt")
                         VALUES (0, NOW(), NOW())
                         RETURNING observation_id`,
                        { type: QueryTypes.SELECT }
                    );

                    made.observations.push(observation.observation_id);

                    await db.sequelize.query(
                        `INSERT INTO dataset_observations
                             (dataset_id, observation_id, inclusion_type, selection_method,
                              created_at, updated_at)
                         VALUES (:dataset, :observation, :split, 'jest', NOW(), NOW())`,
                        {
                            replacements: {
                                dataset: dataset.id,
                                observation: observation.observation_id,
                                split,
                            },
                        }
                    );
                }
            }

            return dataset.id;
        }

        /**
         * **The two counts are different quantities and this is the test that says so.**
         * Two observations in train against six images, one in eval against two: the
         * observation split is 2:1 and the image split is 3:1. A panel reading the wrong
         * one would still look plausible, which is why they are made to differ.
         */
        it('serves the recorded image count beside the live observation count', async () => {
            const datasetId = await seedMembership('both', { train: 2, eval: 1 });

            await recordSplit(datasetId, 'train', 6);
            await recordSplit(datasetId, 'eval', 2);

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/composition`);

            expect(res.status).toBe(200);

            const bySplit = Object.fromEntries(res.body.splits.map((s) => [s.split, s]));

            expect(bySplit.train).toMatchObject({ observations: 2, images: 6 });
            expect(bySplit.eval).toMatchObject({ observations: 1, images: 2 });
        });

        /**
         * **Null, not zero, and the distinction is the whole reason the column is
         * nullable.** Every dataset built before `dataset_splits` existed is in this
         * state. Zero images in a split is a fact; not knowing is a different fact, and a
         * panel drawing the second as the first would state a measurement nobody took.
         */
        it('answers null for a split whose count was never recorded', async () => {
            const datasetId = await seedMembership('unrecorded', { train: 2 });

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/composition`);

            expect(res.status).toBe(200);
            expect(res.body.splits).toHaveLength(1);
            expect(res.body.splits[0].observations).toBe(2);
            expect(res.body.splits[0].images).toBeNull();
        });

        /** A split with membership still appears even with nothing recorded against it. */
        it('does not lose a split to the join when only some are recorded', async () => {
            const datasetId = await seedMembership('partial', { train: 2, test: 1 });

            await recordSplit(datasetId, 'train', 9);

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/composition`);
            const bySplit = Object.fromEntries(res.body.splits.map((s) => [s.split, s]));

            expect(Object.keys(bySplit).sort()).toEqual(['test', 'train']);
            expect(bySplit.train.images).toBe(9);
            expect(bySplit.test.images).toBeNull();
        });

        /**
         * A retry replaces what the first attempt recorded rather than adding to it --
         * the same rule the membership and the vocabulary follow in `recordBuild`, and
         * the primary key would refuse the second insert anyway.
         */
        it('replaces the counts when a build records them again', async () => {
            const datasetId = await seedMembership('rebuilt', { train: 1 });

            await recordSplit(datasetId, 'train', 5);

            await buildRepository.recordBuild({
                jobId: null,
                attemptId: null,
                datasetId,
                members: [],
                classes: [],
                archive: { path: null, sha256: null, bytes: null },
                frames: 11,
                observations: 0,
                splitImages: new Map([['train', 11]]),
            });

            const rows = await db.sequelize.query(
                'SELECT split, images FROM dataset_splits WHERE dataset_id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(rows).toEqual([{ split: 'train', images: 11 }]);
        });

        /**
         * The rows go with the dataset, like its membership and its vocabulary. Delete
         * relies on it: a child without `ON DELETE CASCADE` would refuse the delete and
         * turn a working control into a 409 nobody could explain.
         */
        it('goes with the dataset when it is deleted', async () => {
            const datasetId = await seedMembership('cascaded', { train: 1 });

            await recordSplit(datasetId, 'train', 4);

            const res = await global.api.delete(`/api/v2/dataset/${datasetId}`);

            expect(res.status).toBe(200);

            const rows = await db.sequelize.query(
                'SELECT split FROM dataset_splits WHERE dataset_id = :datasetId',
                { replacements: { datasetId }, type: QueryTypes.SELECT }
            );

            expect(rows).toEqual([]);
        });
    });

    /**
     * The queries a dataset was built from, so another can be set up the same way.
     *
     * *"Sets up a new dataset with the same queries as the old one, and just makes it so
     * the user can then queue it up, or make changes to the old query before queuing it
     * up."* The spec is on the job rather than the dataset -- `queueBuild` writes the
     * filters into `gpu_jobs.spec` because a saved query can be edited afterwards and a
     * build has to stay a record of what it ran -- so this route is the only way a
     * finished dataset can say what made it.
     */
    describe('GET /api/v2/dataset/:id/build-setup', () => {

        /** A dataset with a job carrying the spec given. */
        async function seedSpec(label, spec, state = 'succeeded') {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, description, status, source, created_at, updated_at)
                 VALUES (:name, 'seeded by tests/dataset-build-progress', 'ready', 'ml-dashboard', NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-setup-${stamp}-${label}` }, type: QueryTypes.SELECT }
            );

            made.datasets.push(dataset.id);

            const [job] = await db.sequelize.query(
                `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                       created_at, updated_at)
                 VALUES ('dataset_build', :name, :spec, :state, 0, 1, 3, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: {
                        name: `Build jest-setup-${stamp}-${label}`,
                        spec: JSON.stringify({ ...spec, dataset_id: dataset.id }),
                        state,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            made.jobs.push(job.id);

            return { datasetId: dataset.id, jobId: job.id };
        }

        it('hands back the subsets and shares the build actually ran', async () => {
            const subsets = [{
                shares: { train: 70, validation: 20, test: 10 },
                filters: {
                    species: [775],
                    confidence: { from: 0.5, to: 1 },
                    trainingDisposition: ['promoted'],
                },
            }];

            const { datasetId, jobId } = await seedSpec('full', { subsets, splits: { train: 0.8, eval: 0.2 } });

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/build-setup`);

            expect(res.status).toBe(200);
            expect(res.body.jobId).toBe(jobId);
            expect(res.body.subsets).toEqual(subsets);
            expect(res.body.splits).toEqual({ train: 0.8, eval: 0.2 });
            /* The new dataset is named by the screen, but the old name has to arrive for
               it to be named *after* it. */
            expect(res.body.name).toContain('jest-setup');
        });

        /**
         * **The succeeded job wins**, and a dataset having several is ordinary: a retry
         * opens a second, and a cancelled attempt followed by a successful one leaves
         * two. The succeeded one is the only spec known to have produced this dataset --
         * the other may be the reason it had to be retried.
         */
        it('takes the succeeded job when a dataset has more than one', async () => {
            /* **The succeeded one is seeded first, so it is also the oldest.** Written
               the other way round this test passed with the ordering deleted -- the
               newest job happened to be the succeeded one, so `ORDER BY id DESC` alone
               found it and the clause under test was never exercised. The cancelled
               attempt after a success is the real shape anyway: Isaac cancels a build,
               queues it again, and the second one is the newer row. */
            const { datasetId, jobId: good } = await seedSpec('retried',
                { subsets: [{ split: 'train', filters: { confidence: { from: 0.9, to: 1 } } }] },
                'succeeded');

            const [later] = await db.sequelize.query(
                `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                       created_at, updated_at)
                 VALUES ('dataset_build', :name, :spec, 'cancelled', 0, 1, 3, NOW(), NOW())
                 RETURNING id`,
                {
                    replacements: {
                        name: `Build jest-setup-${stamp}-abandoned`,
                        spec: JSON.stringify({
                            dataset_id: datasetId,
                            subsets: [{ split: 'train', filters: { confidence: { from: 0.1, to: 1 } } }],
                        }),
                    },
                    type: QueryTypes.SELECT,
                }
            );

            made.jobs.push(later.id);

            expect(later.id).toBeGreaterThan(good);

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/build-setup`);

            expect(res.status).toBe(200);
            expect(res.body.jobId).toBe(good);
            expect(res.body.subsets[0].filters.confidence.from).toBe(0.9);
        });

        /**
         * **404 rather than an empty form.** A build can carry `filters: {}` with nothing
         * in `subsets`, and a Duplicate that opened a blank build flow would look exactly
         * like one that had worked -- then queue a dataset built from no query at all.
         */
        it('refuses when the spec carries no queries', async () => {
            const { datasetId } = await seedSpec('empty', { subsets: [], filters: {} });

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/build-setup`);

            expect(res.status).toBe(404);
            expect(res.body.error.message).toMatch(/queries/i);
        });

        /** A build that named filters without subsets is still worth copying. */
        it('hands back plain filters when the build used no subsets', async () => {
            const { datasetId } = await seedSpec('plain', {
                subsets: [],
                filters: { confidence: { from: 0.7, to: 1 } },
            });

            const res = await global.api.get(`/api/v2/dataset/${datasetId}/build-setup`);

            expect(res.status).toBe(200);
            expect(res.body.filters).toEqual({ confidence: { from: 0.7, to: 1 } });
            expect(res.body.subsets).toEqual([]);
        });

        /**
         * `rockfish5` and everything else the desktop packager made has no job at all.
         * That is the common case, not an error, and the control says so.
         */
        it('refuses a dataset that was never built here', async () => {
            const [dataset] = await db.sequelize.query(
                `INSERT INTO datasets (name, status, source, created_at, updated_at)
                 VALUES (:name, 'ready', 'legacy import', NOW(), NOW())
                 RETURNING id`,
                { replacements: { name: `jest-setup-legacy-${stamp}` }, type: QueryTypes.SELECT }
            );

            made.datasets.push(dataset.id);

            const res = await global.api.get(`/api/v2/dataset/${dataset.id}/build-setup`);

            expect(res.status).toBe(404);
        });

        /** It reads what was queried, which is survey data, so it is not anonymous. */
        it('refuses a request carrying no principal', async () => {
            const request = require('supertest');
            const app = require('../app');

            const res = await request(app).get('/api/v2/dataset/1/build-setup');

            expect(res.status).toBe(401);
        });
    });

    /**
     * Reordering the build queue.
     *
     * *"If multiple items are queued, it should be possible to change the order of what
     * job is queued."* The order was already real -- `claimBuild` selects
     * `ORDER BY priority DESC, created_at ASC, id ASC`, so the queue has always been a
     * priority queue -- and nothing served the priority or set it.
     *
     * **Every assertion here is scoped to this file's own jobs.** A real build queued on
     * the machine running the suite is ordinary, so asserting the length of the queue
     * would pass on an idle database and fail on a busy one.
     */
    describe('the build queue and its order', () => {

        /** Three queued builds, oldest first, all at the default priority. */
        async function seedQueue(labels) {
            const made = [];

            for (const label of labels) {
                const seeded = await seedBuild({ name: `jest-queue-${label}`, state: 'queued' });

                made.push(seeded);
            }

            return made;
        }

        /** This file's jobs, in claim order, out of whatever else is waiting. */
        async function mineInOrder(jobIds) {
            const queue = await buildRepository.getQueuedBuilds();
            const wanted = new Set(jobIds);

            return queue.filter((row) => wanted.has(row.job_id)).map((row) => row.job_id);
        }

        it('lists queued builds in the order claimBuild would take them', async () => {
            const [first, second, third] = await seedQueue(['a', 'b', 'c']);
            const order = await mineInOrder([first.jobId, second.jobId, third.jobId]);

            /* All at priority 0, so the tie-break decides and the oldest goes first --
               which is what the queue has always done and what the screen must show. */
            expect(order).toEqual([first.jobId, second.jobId, third.jobId]);
        });

        it('moves a build sooner, and back again', async () => {
            const [first, second, third] = await seedQueue(['d', 'e', 'f']);
            const ids = [first.jobId, second.jobId, third.jobId];

            await buildRepository.moveQueuedBuild(third.jobId, 'up');

            expect(await mineInOrder(ids)).toEqual([first.jobId, third.jobId, second.jobId]);

            await buildRepository.moveQueuedBuild(third.jobId, 'down');

            expect(await mineInOrder(ids)).toEqual(ids);
        });

        /**
         * **The reason this renumbers rather than swaps.** Every build is priority 0
         * until something changes it, so swapping a pair's priorities is 0 for 0 and the
         * `created_at` tie-break puts the row straight back where it was. A move that
         * silently does nothing is the failure mode worth a test of its own.
         */
        it('moves a build that is tied with every other on priority', async () => {
            const [first, second] = await seedQueue(['g', 'h']);

            const [before] = await db.sequelize.query(
                'SELECT priority FROM gpu_jobs WHERE id = :id',
                { replacements: { id: second.jobId }, type: QueryTypes.SELECT }
            );

            expect(before.priority).toBe(0);

            await buildRepository.moveQueuedBuild(second.jobId, 'up');

            const order = await mineInOrder([first.jobId, second.jobId]);

            expect(order).toEqual([second.jobId, first.jobId]);
        });

        /**
         * **And the numbers stay bounded.** The other way to write this -- give the moved
         * job `max + 1` -- works and then climbs for ever, so a queue reordered a hundred
         * times carries priorities in the hundreds and still ties underneath. Positions
         * N..1 across the queued set means the largest value is the length of the queue,
         * however many times it has been shuffled.
         */
        it('keeps the priority numbers bounded by the length of the queue', async () => {
            const seeded = await seedQueue(['i', 'j', 'k']);
            const ids = seeded.map((one) => one.jobId);

            for (let i = 0; i < 20; i++) {
                await buildRepository.moveQueuedBuild(ids[i % ids.length], i % 2 ? 'down' : 'up');
            }

            const rows = await db.sequelize.query(
                'SELECT priority FROM gpu_jobs WHERE id IN (:ids)',
                { replacements: { ids }, type: QueryTypes.SELECT }
            );

            const queue = await buildRepository.getQueuedBuilds();

            for (const row of rows) {
                expect(row.priority).toBeGreaterThan(0);
                expect(row.priority).toBeLessThanOrEqual(queue.length);
            }
        });

        it('answers moved: false at the top rather than failing', async () => {
            await seedQueue(['l', 'm']);

            /* **Whatever is actually first, not this file's first.** Earlier cases here
               leave their builds queued until `afterAll`, and a real build waiting on the
               machine running the suite is ordinary -- so "the one I just seeded" is
               somewhere in the middle and moving it up succeeds. The job at the head of
               the whole queue is the only one for which up is a no-op. */
            const queue = await buildRepository.getQueuedBuilds();

            expect(queue.length).toBeGreaterThan(0);

            const result = await buildRepository.moveQueuedBuild(queue[0].job_id, 'up');

            expect(result.moved).toBe(false);
        });

        /**
         * **It must not reach a worker's queue.** `priority` is a `gpu_jobs` column and
         * `selectClaimableJobRow` orders inference, tracking, training and diagnostic work
         * by it. A renumber that was not scoped by kind would reorder somebody's GPU
         * queue from a screen about datasets.
         */
        it('leaves jobs of other kinds untouched', async () => {
            const [queued] = await seedQueue(['n', 'o']);

            const [inference] = await db.sequelize.query(
                `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                       created_at, updated_at)
                 VALUES ('inference', :name, '{}'::jsonb, 'queued', 0, 0, 3, NOW(), NOW())
                 RETURNING id, priority`,
                { replacements: { name: `jest-queue-inference-${stamp}` }, type: QueryTypes.SELECT }
            );

            made.jobs.push(inference.id);

            await buildRepository.moveQueuedBuild(queued.jobId, 'down');

            const [after] = await db.sequelize.query(
                'SELECT priority FROM gpu_jobs WHERE id = :id',
                { replacements: { id: inference.id }, type: QueryTypes.SELECT }
            );

            expect(after.priority).toBe(inference.priority);
        });

        it('refuses a job that is not waiting in the queue', async () => {
            const { jobId } = await seedBuild({ name: 'jest-queue-leased', state: 'leased' });

            await expect(buildRepository.moveQueuedBuild(jobId, 'up')).rejects.toMatchObject({ status: 404 });
        });

        it('refuses a direction that is not up or down', async () => {
            const [first] = await seedQueue(['p']);

            await expect(buildRepository.moveQueuedBuild(first.jobId, 'sideways'))
                .rejects.toMatchObject({ status: 400 });
        });

        /**
         * **`starts_next` is a set, not a row.** Builds run several at a time now, so the
         * front of the queue all begin together and a screen implying one next job would
         * be wrong about what pressing nothing does.
         */
        it('marks as many as would start now, not just the first', async () => {
            const seeded = await seedQueue(['q', 'r', 's']);
            const ids = seeded.map((one) => one.jobId);

            const res = await global.api.get('/api/v2/dataset/build-queue');

            expect(res.status).toBe(200);
            expect(res.body.concurrency).toBeGreaterThanOrEqual(1);

            const mine = res.body.queue.filter((row) => ids.includes(row.job_id));

            expect(mine.length).toBe(3);

            /* Positions are over the whole queue, so this file's three are consecutive
               rather than necessarily 1, 2, 3 -- another build may be waiting too. */
            expect(mine[1].position).toBe(mine[0].position + 1);
            expect(mine[2].position).toBe(mine[1].position + 1);

            for (const row of res.body.queue) {
                expect(row.starts_next).toBe(row.position <= res.body.concurrency - res.body.running);
            }
        });

        it('refuses a reorder from a request carrying no principal', async () => {
            const request = require('supertest');
            const app = require('../app');

            const res = await request(app).post('/api/v2/dataset/build-queue/1/move').send({ direction: 'up' });

            expect(res.status).toBe(401);
        });
    });

    it('refuses a request carrying no principal', async () => {
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/v2/dataset/builds');

        expect(res.status).toBe(401);
    });
});
