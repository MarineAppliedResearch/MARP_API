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
    const made = { datasets: [], jobs: [], attempts: [], workers: [], observations: [] };

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

    it('refuses a request carrying no principal', async () => {
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/v2/dataset/builds');

        expect(res.status).toBe(401);
    });
});
