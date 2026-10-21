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

            const res = await global.api
                .get('/api/v2/gpu/throughput/series')
                .query({ kind: 'dataset_build', bucket: 'minute' });

            expect(res.status).toBe(200);

            /* Scoped to the figure this test seeded rather than to the whole answer: a real
               build on the machine running the suite is an ordinary thing, and an assertion
               about the total would pass on an idle database and fail on a busy one. The
               difference is 1456 - 400, which is the work done between the two readings. */
            const differences = (res.body.points || []).map((p) => Number(p.units_done));

            expect(differences).toContain(1056);
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
    it('refuses a request carrying no principal', async () => {
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/v2/dataset/builds');

        expect(res.status).toBe(401);
    });
});
