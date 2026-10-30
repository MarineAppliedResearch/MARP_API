/**
 * The database half of a dataset build.
 *
 * Queueing one, claiming it, reporting how far it has got, and recording what it
 * produced. The slow work -- cutting frames, writing labels, packaging -- is
 * `service/dataset-build.service.js`; the planning is `service/dataset-build-plan.js`.
 *
 * **A build is a `gpu_jobs` row that no GPU touches.** What it needs is a queue, a state
 * machine, attempts, progress, cancellation and a row the Jobs screen can already draw,
 * and that is what this table is. `LEASABLE_JOB_KINDS` keeps `dataset_build` out of what
 * `POST /gpu/poll` offers, so the pool never sees one.
 *
 * **The API is enrolled as a worker to run them.** `gpu_job_attempts.worker_id` is NOT
 * NULL, and the alternative was making it nullable on a table holding tens of thousands
 * of rows so that one kind of attempt could have no machine. Enrolling the API instead
 * costs one row, needs no migration, and is true: the API is the machine doing the work,
 * and the Jobs screen's Worker column says so rather than showing a blank.
 *
 * @fileoverview Queue, claim, report and record for dataset builds.
 * @author Isaac Travers
 * @module repository/dataset-build.repository
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const logger = require('../logger/api.logger');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');

/** What the API's own worker row is called. Stable, because it is looked up by name. */
const API_WORKER_NAME = 'marp-api';

/** Its `local_id`, which the enrolment flow would otherwise supply. */
const API_WORKER_LOCAL_ID = 'marp-api-internal';

/**
 * The API's worker row, created once.
 *
 * `state` is `paused` deliberately: a paused worker is one the pool will not hand work
 * to, which is exactly right for a row that exists only so internal attempts have a
 * machine to belong to. Nothing polls as it, so its heartbeat never arrives and an
 * `online` row would be reported offline within the minute -- a red machine on the
 * Workers screen that nobody can fix.
 *
 * @async
 * @returns {Promise<number>} Its id.
 */
async function apiWorkerId() {
    /* Found by `local_id`, not by name. `name` is what a person calls the machine and
       can be renamed from the Workers screen; `local_id` is unique and is what the
       enrolment flow identifies a machine by, so it is the only safe handle here. */
    const [existing] = await db.sequelize.query(
        'SELECT id FROM gpu_workers WHERE local_id = :localId',
        { replacements: { localId: API_WORKER_LOCAL_ID }, type: QueryTypes.SELECT }
    );

    if (existing) return existing.id;

    const [created] = await db.sequelize.query(
        `INSERT INTO gpu_workers (name, local_id, state, slot_count, enrolled_at, update_state)
         VALUES (:name, :localId, 'paused', 1, NOW(), 'current')
         ON CONFLICT (local_id) DO UPDATE SET local_id = EXCLUDED.local_id
         RETURNING id`,
        {
            replacements: { name: API_WORKER_NAME, localId: API_WORKER_LOCAL_ID },
            type: QueryTypes.SELECT,
        }
    );

    return created.id;
}

/**
 * Create the dataset row and the job that will build it, together.
 *
 * **One transaction, because a dataset with no job is a row that says `building` for
 * ever** and a job with no dataset has nothing to write into. The dataset exists before
 * the build starts so the Datasets screen can show it as building, which is what
 * `datasets.status` was added for.
 *
 * The job's `spec` carries the filters rather than a reference to them: a saved query can
 * be edited afterwards, and a build has to remain a record of what was actually asked
 * for. The same reason the archive is content-addressed.
 *
 * @async
 * @param {Object} request - `{name, description, filters, splits, createdBy}`.
 * @returns {Promise<{dataset: Object, job: Object}>} Both rows.
 * @throws {Error} Re-throws any database failure.
 */
async function queueBuild({
    name, description = null, filters = {}, subsets = null, image = null, splits,
    createdBy = null, task = 'detection', sampling = null,
}) {
    const transaction = await db.sequelize.transaction();

    try {
        const [dataset] = await db.sequelize.query(
            /* **The task is written when the row is created, not when the build
               finishes.** A dataset sits at `building` for minutes or hours, and the
               screen shows it the whole time -- so a row that only learns what kind
               of dataset it is at the end reads as a detection dataset until it
               succeeds, and as a detection dataset for ever if it fails. */
            `INSERT INTO datasets (name, description, status, source, task, created_at, updated_at)
             VALUES (:name, :description, 'building', 'ml-dashboard', :task, NOW(), NOW())
             RETURNING *`,
            { replacements: { name, description, task }, type: QueryTypes.SELECT, transaction }
        );

        const [job] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                   created_by, created_at, updated_at)
             VALUES ('dataset_build', :name, :spec, 'queued', 0, 0, 3, :createdBy, NOW(), NOW())
             RETURNING *`,
            {
                replacements: {
                    name: `Build ${name}`,
                    spec: JSON.stringify({ dataset_id: dataset.id, filters, subsets, image, splits, task, sampling }),
                    createdBy,
                },
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        await transaction.commit();

        return { dataset, job };
    } catch (error) {
        await transaction.rollback();
        logger.error('Error::' + error);
        throw error;
    }
}

/**
 * Take the next queued build, and open an attempt at it.
 *
 * `FOR UPDATE SKIP LOCKED` for the same reason the pool's claim uses it: two API
 * processes behind a load balancer must not both take the same build, and a second one
 * arriving at the same instant should move on rather than wait.
 *
 * @async
 * @returns {Promise<?{job: Object, attempt: Object}>} The claimed build, or null.
 * @throws {Error} Re-throws any database failure.
 */
/**
 * How long a build's lease lasts without being renewed, in seconds (#292).
 *
 * It was an hour, so a build an API restart killed sat looking alive for up to an hour
 * before anything noticed. The runner now renews it every 30 seconds on a timer as well as
 * on every progress report, so two minutes is four missed renewals: a dead process is
 * noticed within about two minutes, and a live one never lapses. Still decided by the
 * lease rather than by "this process just started", so a second API process stays safe.
 *
 * @constant
 * @type {number}
 */
const BUILD_LEASE_SECONDS = 120;

/**
 * Return builds whose runner is gone to the queue.
 *
 * **A build does not survive the API restarting, and nothing noticed.** The process
 * holding it dies, the attempt row stays `running`, the dataset stays `building`, and
 * nobody is working on either -- for ever. Found during the first build long enough for
 * it to happen: `npm run dev` restarted three times on file changes during a fifty-minute
 * run, and each restart silently abandoned the work.
 *
 * **Decided by the lease, not by "this process just started".** A second API process
 * would make startup a lie -- its own fresh start says nothing about whether another
 * machine is mid-build -- whereas a lease that has not been extended for an hour means
 * nobody is reporting progress on it, whichever process that was. `reportProgress`
 * extends the lease on every pass, so a live build never looks abandoned.
 *
 * A reclaimed build goes back to `queued` and starts again from the beginning, because
 * its staging directory went with the process that died. The attempt is kept, marked
 * `abandoned` -- a state this table already had and which is exactly the word -- so the
 * history shows the build was tried and lost rather than never run.
 * Once the attempts are spent the job fails for good and says why.
 *
 * @async
 * @returns {Promise<number>} How many were reclaimed.
 */
async function reclaimAbandonedBuilds() {
    const [reclaimed] = await db.sequelize.query(
        `WITH abandoned AS (
                SELECT j.id AS job_id, a.id AS attempt_id,
                       /* **A restart is not a failure** (#292): the attempt it cost is
                          given back below, so the build is always worth resuming. */
                       TRUE AS retryable
                  FROM gpu_jobs j
                  JOIN gpu_job_attempts a ON a.job_id = j.id
                 WHERE j.kind = 'dataset_build'
                   AND j.state = 'leased'
                   AND a.state = 'running'
                   AND a.lease_expires_at < NOW()
                   FOR UPDATE OF j SKIP LOCKED
         ),
         closed AS (
                UPDATE gpu_job_attempts a
                   SET state = 'abandoned',
                       finished_at = NOW(),
                       failure_reason = 'The API stopped while this build was running; it resumes from where it got to.'
                  FROM abandoned ab
                 WHERE a.id = ab.attempt_id
                 RETURNING ab.job_id, ab.retryable
         ),
         requeued AS (
                UPDATE gpu_jobs j
                   SET state = CASE WHEN c.retryable THEN 'queued' ELSE 'failed' END,
                       finished_at = CASE WHEN c.retryable THEN NULL ELSE NOW() END,
                       attempts_made = GREATEST(0, j.attempts_made - 1),
                       updated_at = NOW()
                  FROM closed c
                 WHERE j.id = c.job_id
                 RETURNING j.id, j.spec->>'dataset_id' AS dataset_id, c.retryable
         )
         UPDATE datasets d
            SET status = CASE WHEN r.retryable THEN 'building' ELSE 'failed' END,
                updated_at = NOW()
           FROM requeued r
          WHERE d.id = (r.dataset_id)::int
          RETURNING d.id`,
        { type: db.Sequelize.QueryTypes.SELECT }
    );

    const count = Array.isArray(reclaimed) ? reclaimed.length : (reclaimed ? 1 : 0);

    if (count) logger.info(`Reclaimed ${count} dataset build(s) abandoned by a restart.`);

    return count;
}

async function claimBuild() {
    const workerId = await apiWorkerId();
    const transaction = await db.sequelize.transaction();

    try {
        const [job] = await db.sequelize.query(
            `SELECT * FROM gpu_jobs
              WHERE kind = 'dataset_build'
                AND state = 'queued'
                AND attempts_made < max_attempts
              ORDER BY priority DESC, created_at ASC, id ASC
              LIMIT 1
                FOR UPDATE SKIP LOCKED`,
            { type: QueryTypes.SELECT, transaction }
        );

        if (!job) {
            await transaction.commit();

            return null;
        }

        const tries = Number(job.attempts_made) + 1;

        /* **The epoch counts every attempt the job has had; `attempts_made` counts only the
           real tries** (#292). A restart gives its attempt back, so the two part company
           -- and an epoch taken from `attempts_made` would repeat one already on record. */
        const [attempt] = await db.sequelize.query(
            `INSERT INTO gpu_job_attempts
                 (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at)
             VALUES (:jobId, :workerId, 0,
                     (SELECT COALESCE(MAX(lease_epoch), 0) + 1 FROM gpu_job_attempts WHERE job_id = :jobId),
                     'running', NOW(), NOW() + (:leaseSeconds * INTERVAL '1 second'))
             RETURNING *`,
            { replacements: { jobId: job.id, workerId, leaseSeconds: BUILD_LEASE_SECONDS }, type: QueryTypes.SELECT, transaction }
        );

        await db.sequelize.query(
            `UPDATE gpu_jobs
                SET state = 'leased', attempts_made = :tries, updated_at = NOW()
              WHERE id = :jobId`,
            { replacements: { jobId: job.id, tries }, transaction }
        );

        await transaction.commit();

        return { job, attempt };
    } catch (error) {
        await transaction.rollback();
        logger.error('Error::' + error);
        throw error;
    }
}

/**
 * Say how far a build has got.
 *
 * **The lease is extended on every report**, the same way a worker's heartbeat does it. A
 * build runs for hours and a lease that expired mid-way would have the job requeued
 * underneath it.
 *
 * **Two writes, because they answer two different questions.** The attempt row holds where
 * the build is *now*, which is what the Datasets screen reads while somebody watches it;
 * `gpu_attempt_progress` keeps a reading per minute, which is the only way a *rate* can be
 * worked out afterwards. A rate needs two readings, and the attempt row has one -- every
 * report overwrites it. The pool's heartbeat has written both since `20261020130000`; a
 * build reported onto the attempt and nothing else, so the Build activity panel had no
 * series to draw and said so on screen.
 *
 * **The dataset row is touched too, so `Updated` moves while the build runs.** It used to
 * be written only when the build finished, so the Datasets table showed a frame count
 * climbing and an elapsed clock ticking beside a timestamp frozen at the moment the build
 * was queued -- which reads as a row that has stopped being maintained rather than one
 * that is being worked on. Isaac found it watching dataset 381: created 22:19:27, updated
 * 22:25:06, and 22:25:06 was the instant it completed.
 *
 * **Derived from the attempt rather than passed in**, which is the same join
 * `getBuildsInFlight` makes. A `datasetId` parameter would be one more thing six call
 * sites have to remember, and forgetting it brings this exact defect back silently.
 *
 * @async
 * @param {number} attemptId - The attempt.
 * @param {Object} progress - `{done, total, unit, phase}`.
 * @returns {Promise<void>}
 */
async function reportProgress(attemptId, progress) {
    await db.sequelize.query(
        `UPDATE gpu_job_attempts
            SET progress_done = COALESCE(:done, progress_done),
                progress_total = COALESCE(:total, progress_total),
                progress_unit = COALESCE(:unit, progress_unit),
                progress_phase = COALESCE(:phase, progress_phase),
                last_heartbeat_at = NOW(),
                lease_expires_at = NOW() + (:leaseSeconds * INTERVAL '1 second')
          WHERE id = :attemptId`,
        {
            replacements: {
                leaseSeconds: BUILD_LEASE_SECONDS,
                attemptId,
                done: progress.done ?? null,
                total: progress.total ?? null,
                unit: progress.unit ?? null,
                phase: progress.phase ?? null,
            },
        }
    );

    /* Safe against the table's ordering, and that was checked rather than assumed: the
       Datasets screen sorts on `created_at` with the id breaking ties, precisely so a row
       reporting progress does not shuffle under somebody reading it. `GET /dataset` itself
       returns no order at all, so an unsorted reader was already at the mercy of physical
       order -- this does not make that worse, but it is why the client sort exists. */
    await db.sequelize.query(
        `UPDATE datasets d
            SET updated_at = NOW()
           FROM gpu_job_attempts a
           JOIN gpu_jobs j ON j.id = a.job_id
          WHERE a.id = :attemptId
            AND j.kind = 'dataset_build'
            AND d.id = (j.spec->>'dataset_id')::int`,
        { replacements: { attemptId } }
    );

    await sampleProgress(attemptId, progress);
}

/**
 * Record what the selection found, as soon as it has found it.
 *
 * **These two are known when `selecting` ends, not when the build does.** Resolving the
 * filters produces the observations and the class vocabulary; cutting frames out of video
 * is everything after that and takes the hours. Writing them at the end left the
 * Observations and Classes columns blank for the whole of a long build, next to a frame
 * count that was climbing -- the screen had somewhere to put the answer and the server was
 * not sending it.
 *
 * **Not `num_samples`.** That column means images, and the only honest image count during
 * a build is how many have actually been cut -- which the Frames cell already shows live
 * off the attempt row. Writing the *planned* total here would make one column mean
 * "intended" on a running row and "written" on a finished one, with nothing to tell them
 * apart, which is the ambiguity `AGENTS.md` counts as loss.
 *
 * @async
 * @param {Object} selection - What the selecting phase resolved.
 * @param {number} selection.datasetId - The dataset being built.
 * @param {number} selection.observations - How many observations it will include.
 * @param {number} selection.classes - How many classes their species make up.
 * @returns {Promise<void>}
 */
async function recordSelection({ datasetId, observations, classes }) {
    await db.sequelize.query(
        `UPDATE datasets
            SET num_observations = :observations,
                num_classes = :classes,
                updated_at = NOW()
          WHERE id = :datasetId`,
        { replacements: { datasetId, observations, classes } }
    );
}

/**
 * Keep this reading, so the rate can be worked out later.
 *
 * One row per attempt per minute, upserted -- the same grain and the same conflict rule
 * the pool's heartbeat uses, because `GET /gpu/throughput/series` differences these rows
 * and cannot tell one writer from another. `job_kind` is what lets that route answer for
 * dataset builds apart from inference.
 *
 * **Only a reading with a count.** The *selecting* phase reports a phase and no numbers --
 * the total is not knowable until the observations and their videos are resolved -- and a
 * row claiming zero there would be read as "no frames in that minute" rather than "not
 * counting yet", which is a flat line at the floor instead of no line at all.
 *
 * **A failure here never fails the build.** This is a sample for a chart; the build is
 * hours of extraction, and losing a point off a graph is not a reason to throw it away.
 * The attempt row above is the record a reader actually depends on, and it is already
 * written by the time this runs.
 *
 * @async
 * @param {number} attemptId - The attempt this reading belongs to.
 * @param {Object} progress - `{done, total, unit}`; a null `done` is not sampled.
 * @returns {Promise<void>}
 */
async function sampleProgress(attemptId, progress) {
    if (progress.done === undefined || progress.done === null) return;

    try {
        await db.sequelize.query(
            `INSERT INTO gpu_attempt_progress
                    (attempt_id, at, progress_done, progress_total, progress_unit, job_kind)
             VALUES (:attemptId, date_trunc('minute', NOW()), :done, :total, :unit, 'dataset_build')
             ON CONFLICT (attempt_id, at)
             DO UPDATE SET progress_done = EXCLUDED.progress_done,
                           progress_total = EXCLUDED.progress_total,
                           progress_unit = EXCLUDED.progress_unit,
                           job_kind = EXCLUDED.job_kind`,
            {
                replacements: {
                    attemptId,
                    done: progress.done,
                    total: progress.total ?? null,
                    unit: progress.unit ?? null,
                },
            }
        );
    } catch (error) {
        logger.error(`Dataset build progress sample for attempt ${attemptId}: ${error && error.message}`);
    }
}

/**
 * Whether somebody cancelled this build while it was running.
 *
 * Polled between videos rather than watched, because the thing being interrupted is an
 * ffmpeg pass and the useful place to stop is between two of them -- stopping mid-pass
 * leaves a half-written frame to clean up and saves seconds.
 *
 * @async
 * @param {number} jobId - The job.
 * @returns {Promise<boolean>} True when it should stop.
 */
async function isCancelled(jobId) {
    const [row] = await db.sequelize.query(
        'SELECT state FROM gpu_jobs WHERE id = :jobId',
        { replacements: { jobId }, type: QueryTypes.SELECT }
    );

    return !row || row.state === 'cancelled';
}

/**
 * The queued builds, in the order they will actually be claimed.
 *
 * `claimBuild` takes `ORDER BY priority DESC, created_at ASC, id ASC`, so that clause is
 * the queue and this is the same clause asked as a question. Only `queued` jobs: a leased
 * one is already running and reordering it means nothing.
 *
 * @async
 * @returns {Promise<Array<Object>>} `{job_id, dataset_id, priority, name}`, first to run first.
 */
async function getQueuedBuilds() {
    return db.sequelize.query(
        `SELECT j.id AS job_id,
                (j.spec->>'dataset_id')::int AS dataset_id,
                j.priority,
                d.name
           FROM gpu_jobs j
           LEFT JOIN datasets d ON d.id = (j.spec->>'dataset_id')::int
          WHERE j.kind = 'dataset_build'
            AND j.state = 'queued'
            AND j.attempts_made < j.max_attempts
          ORDER BY j.priority DESC, j.created_at ASC, j.id ASC`,
        { type: QueryTypes.SELECT }
    );
}

/**
 * How many builds are running right now.
 *
 * Counted from the database rather than from the poller's own `inFlight`, because the
 * screen asking is not in that process -- and on a machine running two API instances
 * neither one's counter is the answer. A leased job with a live attempt is a build
 * somebody is doing.
 *
 * @async
 * @returns {Promise<number>}
 */
async function countRunningBuilds() {
    const [row] = await db.sequelize.query(
        `SELECT count(*)::int AS running
           FROM gpu_jobs j
          WHERE j.kind = 'dataset_build'
            AND j.state = 'leased'
            AND EXISTS (
                SELECT 1 FROM gpu_job_attempts a
                 WHERE a.job_id = j.id
                   AND a.state = 'running'
                   AND a.lease_expires_at > NOW()
            )`,
        { type: QueryTypes.SELECT }
    );

    return row ? row.running : 0;
}

/**
 * Move one queued build up or down the queue.
 *
 * **Move rather than set a number**, because *"change the order of what job is queued"* is
 * what a person means and it keeps them out of deciding what priority 5 versus 10 is
 * worth. The number is an implementation detail of the ordering and stays one.
 *
 * **The whole queue is renumbered on every move, and that is what keeps the values sane.**
 * Swapping with a neighbour does not work: every job is priority 0 until something changes
 * it, and swapping 0 with 0 moves nothing -- the tie is broken by `created_at` and the row
 * sits where it was. Handing the moved job `max + 1` works once and then drifts upward for
 * ever, leaving a column of ever-larger numbers that still ties underneath. Writing
 * positions N..1 across the queued set each time means: no ties after the first move, the
 * largest value is the length of the queue, and nothing to compact later.
 *
 * **Scoped to `dataset_build` throughout.** `priority` is a `gpu_jobs` column and the
 * worker pool orders its own queue by it, so a renumber that reached further would silently
 * reorder somebody's inference work. The two queues are disjoint by kind --
 * `LEASABLE_JOB_KINDS` excludes `dataset_build` -- and this keeps it that way.
 *
 * @async
 * @param {number|string} jobId - The queued build to move.
 * @param {string} direction - `up` (sooner) or `down` (later).
 * @returns {Promise<{moved: boolean, queue: Array<Object>}>} The queue after the move.
 * @throws {ApiError} 404 when the job is not a queued build, 400 for an unknown direction.
 */
async function moveQueuedBuild(jobId, direction) {
    if (direction !== 'up' && direction !== 'down') {
        throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR,
            `direction must be "up" or "down", not "${direction}"`);
    }

    const transaction = await db.sequelize.transaction();

    try {
        /* Locked for the length of the renumber, so two people moving at once cannot
           interleave and produce an order neither asked for. `claimBuild` uses SKIP
           LOCKED, so a runner claiming meanwhile steps over these rather than waiting. */
        const queue = await db.sequelize.query(
            `SELECT j.id
               FROM gpu_jobs j
              WHERE j.kind = 'dataset_build'
                AND j.state = 'queued'
                AND j.attempts_made < j.max_attempts
              ORDER BY j.priority DESC, j.created_at ASC, j.id ASC
                FOR UPDATE`,
            { type: QueryTypes.SELECT, transaction }
        );

        const order = queue.map((row) => Number(row.id));
        const at = order.indexOf(Number(jobId));

        if (at === -1) {
            await transaction.rollback();

            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND,
                `Build job ${jobId} is not waiting in the queue. Only a queued build can be reordered -- `
                + 'one that is already running cannot be moved behind anything.');
        }

        const to = direction === 'up' ? at - 1 : at + 1;

        /* Already at the end it is being asked to move toward. Not an error -- pressing
           up on the first row is a reasonable thing to do and the honest answer is that
           nothing changed. */
        if (to < 0 || to >= order.length) {
            await transaction.commit();

            return { moved: false, queue: await getQueuedBuilds() };
        }

        order.splice(to, 0, order.splice(at, 1)[0]);

        /* Positions N..1, highest first, so the array order is the claim order. One
           statement rather than a write per row: the queue is short, but a partial
           renumber would be an order nobody chose. */
        await db.sequelize.query(
            `UPDATE gpu_jobs AS j
                SET priority = v.priority, updated_at = NOW()
               FROM (
                    SELECT * FROM unnest(
                        string_to_array(:ids, ',')::int[],
                        string_to_array(:priorities, ',')::int[]
                    ) AS t(id, priority)
               ) AS v
              WHERE j.id = v.id
                AND j.kind = 'dataset_build'`,
            {
                /* **Joined into strings and split by Postgres.** Sequelize expands an
                   array replacement into a comma-separated list of literals, so `:ids::int[]`
                   arrived as `1,2::int[]` and the cast applied to the last element only --
                   `function unnest(integer) does not exist`. Every value here is already a
                   number, so the round trip through text is safe and the cast is explicit. */
                replacements: {
                    ids: order.join(','),
                    priorities: order.map((unused, index) => order.length - index).join(','),
                },
                transaction,
            }
        );

        await transaction.commit();

        return { moved: true, queue: await getQueuedBuilds() };
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();

        throw error;
    }
}

/**
 * The queries a dataset was built from, so another can be set up the same way.
 *
 * *"Sets up a new dataset with the same queries as the old one, and just makes it so the
 * user can then queue it up, or make changes to the old query before queuing it up."*
 * Nothing is created here -- this reads, and the screen fills its form from the answer.
 *
 * **The spec is the only record of what was asked for**, and it is on the job rather than
 * the dataset: `queueBuild` writes the filters into `gpu_jobs.spec` deliberately, because
 * a saved query can be edited afterwards and a build has to stay a record of what it
 * actually ran. So this is reachable from a dataset only through
 * `spec->>'dataset_id'` -- the same join the builds route makes.
 *
 * **The succeeded job wins when there are several**, and there often are: a retry opens a
 * second, and a cancelled attempt followed by a successful one leaves two. The one that
 * succeeded is the only one known to have produced the dataset being copied; the others
 * are specs that did not finish, and one of them may be the reason it was retried.
 * Failing that, the newest -- a dataset still building has no succeeded job and its spec
 * is still the right thing to copy.
 *
 * @async
 * @param {number|string} datasetId - The dataset to copy the setup of.
 * @returns {Promise<?Object>} `{name, description, subsets, filters, splits, image, jobId}`,
 * or null when no job carries queries worth reusing.
 */
async function getBuildSetup(datasetId) {
    const [job] = await db.sequelize.query(
        `SELECT j.id, j.spec, d.name, d.description
           FROM gpu_jobs j
           JOIN datasets d ON d.id = (j.spec->>'dataset_id')::int
          WHERE j.kind = 'dataset_build'
            AND d.id = :datasetId
          ORDER BY (j.state = 'succeeded') DESC, j.id DESC
          LIMIT 1`,
        { replacements: { datasetId }, type: QueryTypes.SELECT }
    );

    if (!job) return null;

    const spec = job.spec || {};
    const subsets = Array.isArray(spec.subsets) ? spec.subsets.filter(Boolean) : [];
    const filters = spec.filters && Object.keys(spec.filters).length ? spec.filters : null;

    /* **Nothing to copy is a real answer, and a common one.** `rockfish5` predates the
       dashboard builder entirely, and even a dashboard-built dataset can carry
       `filters: {}` when its queries all live in `subsets`. A Duplicate that opened an
       empty build flow would look like it had worked and would quietly be a new dataset
       from no query at all, so the caller is told there is nothing rather than handed a
       blank. */
    if (!subsets.length && !filters) return null;

    return {
        jobId: job.id,
        name: job.name,
        description: job.description,
        subsets,
        filters,
        splits: spec.splits || null,
        image: spec.image || null,
        /* Null is every frame: a build from before #296, or one that asked for it. */
        sampling: spec.sampling || null,
    };
}

/**
 * Remove the build jobs that belong to a dataset.
 *
 * **There is no foreign key to do this.** A build job names its dataset in
 * `spec->>'dataset_id'`, which is a value rather than a reference, so nothing cascades
 * and the lookup is deliberate. Scoped to `dataset_build` throughout: no other kind of
 * job carries that key and none is in scope.
 *
 * **The attempts, their events and their progress samples go on their own.**
 * `gpu_job_attempts` cascades from the job, and `gpu_job_events` and
 * `gpu_attempt_progress` cascade from the attempt, so deleting the job row is the whole
 * of it -- checked against the schema rather than assumed.
 *
 * **An artifact stops a job, and must not stop the dataset.** `artifacts.job_id` is
 * `RESTRICT`, so a job that produced one cannot be deleted. The caller is removing a
 * *dataset*; failing that because of a job row they cannot see would be the same
 * complaint in a new form. So each job is attempted on its own and the ones that refuse
 * are reported rather than thrown.
 *
 * @async
 * @param {number|string} datasetId - The dataset whose jobs should go.
 * @param {Object} [transaction] - Join the caller's transaction, when there is one.
 * @returns {Promise<{deleted: number[], kept: number[]}>} Which job ids went, and which
 * would not.
 */
async function deleteBuildJobsFor(datasetId, transaction = undefined) {
    const jobs = await db.sequelize.query(
        `SELECT id FROM gpu_jobs
          WHERE kind = 'dataset_build'
            AND (spec->>'dataset_id')::int = :datasetId
          ORDER BY id`,
        { replacements: { datasetId }, type: QueryTypes.SELECT, transaction }
    );

    const deleted = [];
    const kept = [];

    for (const job of jobs) {
        /* One at a time, and each in its own savepoint, because a `RESTRICT` violation
           aborts the transaction it happens in -- taking the dataset delete with it if
           they shared one. A savepoint lets the refusal be caught and the rest continue. */
        const savepoint = await db.sequelize.transaction({ transaction });

        try {
            await db.sequelize.query(
                "DELETE FROM gpu_jobs WHERE id = :id AND kind = 'dataset_build'",
                { replacements: { id: job.id }, transaction: savepoint }
            );

            await savepoint.commit();
            deleted.push(job.id);
        } catch (error) {
            await savepoint.rollback();

            /* The only expected refusal. Anything else is a real failure and is raised,
               because silently keeping a job for a reason nobody named is how the next
               orphan goes unexplained. */
            if (error && /artifacts?_job_id_fkey|violates foreign key constraint/i.test(String(error.message || error))) {
                kept.push(job.id);

                continue;
            }

            throw error;
        }
    }

    return { deleted, kept };
}

/**
 * Delete a dataset, and say what is in the way when something is.
 *
 * **"Delete everything, but refuse if a model was trained from that dataset."** That rule
 * is the schema's already: `dataset_observations` and `dataset_classes` cascade, and
 * `training_runs.dataset_id` is `NO ACTION`, so PostgreSQL itself refuses while a run
 * points at the row. A dataset is the answer to *what was this model trained on*, and
 * that `NO ACTION` is the guard rather than an oversight -- it is not to be relaxed.
 *
 * **The training runs are looked up first anyway**, because a foreign key violation
 * reaching a reader is a 500 and a crash is not a refusal. The check produces the
 * sentence; the delete inside a transaction is still the thing that enforces it, and the
 * caught violation below is the backstop for a run created between the two.
 *
 * **The row goes, and the caller removes the file afterwards.** Deliberately not both
 * here: if the delete is refused the archive must still be on disk, and a dataset whose
 * archive is gone but whose row survives is worse than either outcome on its own.
 *
 * `gpu_jobs` rows are left alone and that is a decision. A job is the record that the
 * work happened, nothing references the dataset by a foreign key, and the two settle
 * functions above simply match no rows once the dataset is gone.
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @returns {Promise<{deleted: boolean, archivePath: ?string}>} What to unlink, if
 * anything.
 * @throws {ApiError} 404 when there is no such dataset, 409 when it is still building or
 * a training run was made from it.
 */
async function deleteDataset(datasetId) {
    const [dataset] = await db.sequelize.query(
        'SELECT id, name, status, archive_path FROM datasets WHERE id = :datasetId',
        { replacements: { datasetId }, type: QueryTypes.SELECT }
    );

    if (!dataset) {
        throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `No dataset ${datasetId}.`);
    }

    /* **A building dataset is refused rather than cancelled for them.** There is a runner
       holding a staging directory and about to write this row; deleting underneath it
       makes its own completion the error. Cancelling first is one press and the build
       stops within a pass, so the honest answer is to say so rather than to do two things
       behind one button and leave twenty seconds where the dataset still exists. */
    if (dataset.status === 'building') {
        throw new ApiError(409, ERROR_CODES.CONFLICT,
            `"${dataset.name}" is still building. Cancel the build first, then delete it.`);
    }

    /* **The model's name, not the run's -- `training_runs` has no name of its own.**
       Which is just as well: *which model was trained on this* is the useful half, and it
       is what somebody needs in order to decide whether the run still matters. */
    const runs = await db.sequelize.query(
        `SELECT t.id, m.name AS model_name
           FROM training_runs t
           LEFT JOIN ml_models m ON m.id = t.model_id
          WHERE t.dataset_id = :datasetId
          ORDER BY t.id LIMIT 5`,
        { replacements: { datasetId }, type: QueryTypes.SELECT }
    );

    if (runs.length) {
        const named = runs.map((run) => `#${run.id}${run.model_name ? ` ${run.model_name}` : ''}`).join(', ');

        throw new ApiError(409, ERROR_CODES.CONFLICT,
            `"${dataset.name}" was used to train ${runs.length === 1 ? 'a model' : 'models'} `
            + `(${named}), so it is the record of what that training saw and cannot be deleted.`);
    }

    try {
        const removed = await db.sequelize.query(
            'DELETE FROM datasets WHERE id = :datasetId RETURNING id',
            { replacements: { datasetId }, type: QueryTypes.SELECT }
        );

        /* **After the row, not before.** If the dataset refuses -- a training run points
           at it -- its build job must still be there; a dataset that survived while its
           job did not would be the orphan problem inverted and harder to see. */
        const jobs = removed.length
            ? await deleteBuildJobsFor(datasetId)
            : { deleted: [], kept: [] };

        return {
            deleted: Boolean(removed.length),
            archivePath: removed.length ? dataset.archive_path : null,
            jobsDeleted: jobs.deleted,
            jobsKept: jobs.kept,
        };
    } catch (error) {
        /* The race the check above cannot close: a training run written between the two.
           Postgres refuses, and this turns its message into the same sentence rather than
           letting a 500 out. */
        if (error && /training_runs_dataset_id_fkey/.test(String(error.message || error))) {
            throw new ApiError(409, ERROR_CODES.CONFLICT,
                `"${dataset.name}" was used to train a model, so it cannot be deleted.`);
        }

        throw error;
    }
}

/**
 * Settle a dataset whose build was cancelled with nobody running it.
 *
 * **The hole cancellation had.** `POST /gpu/jobs/:id/cancel` sets the job to `cancelled`,
 * and a *running* build notices within a pass and calls `failBuild`, which is what puts
 * the dataset back to `draft` and tidies the staging. A build that was still **queued**
 * has no runner to notice: `claimBuild` only ever selects `state = 'queued'`, so the job
 * is never picked up, `failBuild` is never reached, and the dataset sits at `building`
 * for ever with nothing building it. It looks exactly like a hang and is a dead row.
 *
 * {@link reclaimAbandonedBuilds} cannot see it either -- that one wants a `leased` job
 * with an expired attempt, and this has neither.
 *
 * **Judged by the lease, not by the absence of an attempt**, which is the same rule
 * reclaiming uses and is what covers the second case: a build cancelled while leased
 * whose runner then died leaves an attempt stuck `running`, and the job is `cancelled`
 * rather than `leased`, so nothing else would ever close it. A runner that is alive is
 * still extending its lease, and it owns the tidying because it is the only thing that
 * can delete the staging directory it opened.
 *
 * @async
 * @returns {Promise<number>} How many datasets were settled.
 */
async function settleCancelledBuilds() {
    const [settled] = await db.sequelize.query(
        `WITH stranded AS (
                SELECT j.id AS job_id, (j.spec->>'dataset_id')::int AS dataset_id
                  FROM gpu_jobs j
                 WHERE j.kind = 'dataset_build'
                   AND j.state = 'cancelled'
                   /* Nobody live is working on it. A fresh lease means a runner is
                      mid-build and about to do this itself, properly. */
                   AND NOT EXISTS (
                       SELECT 1 FROM gpu_job_attempts a
                        WHERE a.job_id = j.id
                          AND a.state = 'running'
                          AND a.lease_expires_at > NOW()
                   )
                   /* And there is actually something left to settle, so this is a cheap
                      no-op once it has run rather than a lock taken every fifteen
                      seconds on every build anybody has ever cancelled. */
                   AND (
                       EXISTS (
                           SELECT 1 FROM gpu_job_attempts a
                            WHERE a.job_id = j.id AND a.state = 'running'
                       )
                       OR EXISTS (
                           SELECT 1 FROM datasets d
                            WHERE d.id = (j.spec->>'dataset_id')::int
                              AND d.status = 'building'
                       )
                   )
                   FOR UPDATE OF j SKIP LOCKED
         ),
         closed AS (
                UPDATE gpu_job_attempts a
                   SET state = 'cancelled',
                       finished_at = NOW(),
                       failure_reason = COALESCE(a.failure_reason,
                           'Cancelled, and the process running it did not report back.')
                  FROM stranded s
                 WHERE a.job_id = s.job_id
                   AND a.state = 'running'
         )
         UPDATE datasets d
            SET status = 'draft',
                /* Back to null with the status, for the reason failBuild clears them:
                   membership is written by recordBuild and it never ran, so a count here
                   would describe rows that do not exist. */
                num_observations = NULL,
                num_classes = NULL,
                updated_at = NOW()
           FROM stranded s
          WHERE d.id = s.dataset_id
            AND d.status = 'building'
          RETURNING d.id`,
        { type: db.Sequelize.QueryTypes.SELECT }
    );

    const count = Array.isArray(settled) ? settled.length : (settled ? 1 : 0);

    if (count) logger.info(`Settled ${count} dataset(s) whose build was cancelled before it ran.`);

    return count;
}

/**
 * The mosaic tile each of these observations has, where there is one.
 *
 * **A classification build is made of these files, so what it can build is decided
 * here.** Every observation carries at most one thumbnail row, and 3,514 of the
 * 114,925 on the development corpus are `failed` -- a video that could not be
 * resolved, a frame rate that disagreed -- so about 3% of any selection has no
 * picture and never will without another extraction pass.
 *
 * **`thumbnail_evicted_at` is checked, not just `status`.** Tiles are evictable: the
 * row stays `ready` and the JPEG is deleted. Nothing on this corpus is evicted today,
 * which is exactly why a build that trusted the status would pass here and fail on a
 * machine where the sweep has run.
 *
 * @async
 * @param {Array<number>} observationIds - The observations a build selected.
 * @returns {Promise<Map<number, {filename: string, framenum: number, subset: string}>>}
 * Keyed by observation id; an observation with no usable tile is absent, which is the
 * caller's cue to count it rather than to write a picture that is not there.
 */
async function thumbnailsFor(observationIds) {
    const found = new Map();

    if (!observationIds.length) return found;

    /* Chunked for the same reason the membership insert is batched: a build can select
       tens of thousands of observations, and one parameter each exceeds what the
       driver will bind in a single statement. */
    const BATCH = 1000;

    for (let at = 0; at < observationIds.length; at += BATCH) {
        const slice = observationIds.slice(at, at + BATCH);

        const rows = await db.sequelize.query(
            `SELECT observation_id, filename, framenum, subset
               FROM observation_thumbnails
              WHERE observation_id IN (:ids)
                AND status = 'ready'
                AND thumbnail_evicted_at IS NULL
                AND filename IS NOT NULL`,
            { replacements: { ids: slice }, type: QueryTypes.SELECT }
        );

        for (const row of rows) {
            found.set(Number(row.observation_id), {
                filename: row.filename,
                framenum: row.framenum,
                subset: row.subset,
            });
        }
    }

    return found;
}
/**
 * Record what a build produced, and mark everything finished.
 *
 * **One transaction over membership, vocabulary, the archive and both states.** A dataset
 * recorded as ready whose membership did not write is the exact failure #268 exists to
 * end -- `dataset_observations` empty for a dataset that says it has 11 classes.
 *
 * Membership and vocabulary are deleted first so a retry is not additive. A second
 * attempt at the same dataset replaces what the first one got to, rather than doubling
 * every row it had already written.
 *
 * @async
 * @param {Object} result - `{jobId, attemptId, datasetId, members, classes, archive,
 * frames, observations}`. Two different counts: `frames` is images written, which is
 * what `num_samples` has always meant, and `observations` is how many were selected.
 * @returns {Promise<void>}
 * @throws {Error} Re-throws any database failure.
 */
async function recordBuild({
    jobId, attemptId, datasetId, members, classes, archive, frames, observations,
    splitImages, splitClassImages,
    /* **Defaulted to detection rather than required**, because every caller that
       existed before classification builds is one, and a required argument would
       make them all pass a constant. `cropSource` has no default worth having: a
       detection dataset crops nothing, and a classification build that forgot to
       say how it cut its pictures should leave the column visibly empty rather
       than claim a method. */
    task = 'detection', cropSource = null,
}) {
    const transaction = await db.sequelize.transaction();

    try {
        await db.sequelize.query(
            'DELETE FROM dataset_observations WHERE dataset_id = :datasetId',
            { replacements: { datasetId }, transaction }
        );
        await db.sequelize.query(
            'DELETE FROM dataset_classes WHERE dataset_id = :datasetId',
            { replacements: { datasetId }, transaction }
        );

        for (const entry of classes) {
            await db.sequelize.query(
                `INSERT INTO dataset_classes (dataset_id, species_id, class_index, folder, created_at, updated_at)
                 VALUES (:datasetId, :speciesId, :classIndex, :folder, NOW(), NOW())`,
                {
                    replacements: {
                        datasetId,
                        speciesId: entry.species_id,
                        classIndex: entry.class_index,
                        /* **The handle the model will report, written where the mapping
                           back lives.** A classify model takes its class names from the
                           folder names and keeps no other list, so this is the string that
                           comes back on a confusion matrix. Recorded here rather than
                           parsed out of the handle later: the build generated it and
                           re-deriving it would be a round trip through a lossy format.

                           Null for a detection dataset, which has no class folders -- its
                           data.yaml names classes by the index that is already in the row. */
                        folder: entry.folder === undefined ? null : entry.folder,
                    },
                    transaction,
                }
            );
        }

        /* Inserted in batches: a build can include tens of thousands of observations and
           a statement each is minutes of round trips for rows that are all the same
           shape. */
        const BATCH = 500;

        for (let at = 0; at < members.length; at += BATCH) {
            const slice = members.slice(at, at + BATCH);
            const values = slice.map((unused, i) =>
                `(:datasetId, :o${i}, :t${i}, 'ml-dashboard query', NOW(), NOW())`).join(', ');
            const replacements = { datasetId };

            slice.forEach((member, i) => {
                replacements[`o${i}`] = member.observation_id;
                replacements[`t${i}`] = member.split;
            });

            await db.sequelize.query(
                `INSERT INTO dataset_observations
                     (dataset_id, observation_id, inclusion_type, selection_method, created_at, updated_at)
                 VALUES ${values}`,
                { replacements, transaction }
            );
        }

        await db.sequelize.query(
            `UPDATE datasets
                SET status = 'ready',
                    /* num_samples is images, as it has been since before MARP built
                       datasets -- package-dataset.js writes the image count and that is
                       why rockfish5 is known as 11,845 images. Redefining it would leave
                       one column meaning images on legacy rows and observations on new
                       ones, with nothing to tell them apart.

                       num_observations is the new fact: nothing recorded it before #268,
                       because dataset_observations was empty. Counting that table live
                       instead would shrink -- its observation_id cascade removes the
                       membership row when an observation goes, while the archive still
                       holds that observation's frames. */
                    num_samples = :frames,
                    num_observations = :observations,
                    num_classes = :classCount,
                    archive_path = :archivePath,
                    archive_sha256 = :sha256,
                    archive_bytes = :bytes,
                    task = :task,
                    crop_source = :cropSource,
                    updated_at = NOW()
              WHERE id = :datasetId`,
            {
                replacements: {
                    datasetId,
                    frames,
                    observations,
                    classCount: classes.length,
                    archivePath: archive.path,
                    sha256: archive.sha256,
                    bytes: archive.bytes,
                    task,
                    cropSource,
                },
                transaction,
            }
        );

        /* **Per-split image counts, in the same transaction as everything else.** They
           are recorded rather than counted out of the archive on every read: the archive
           is immutable, so the number cannot change after this, and re-deriving a
           constant on each panel open is a read nobody needs to pay for.

           Replaced rather than added to, the way the membership above is, so a second
           attempt at the same dataset does not double them. */
        await db.sequelize.query(
            'DELETE FROM dataset_splits WHERE dataset_id = :datasetId',
            { replacements: { datasetId }, transaction }
        );

        for (const [split, images] of (splitImages || new Map())) {
            await db.sequelize.query(
                `INSERT INTO dataset_splits (dataset_id, split, images, created_at, updated_at)
                 VALUES (:datasetId, :split, :images, NOW(), NOW())`,
                { replacements: { datasetId, split, images }, transaction }
            );
        }

        /* **Per species per split, from class indices the runner counted.** The mapping
           is the `classes` array being written a few lines above, so the index that
           produced a count and the index recorded in `dataset_classes` are the same one
           by construction rather than by a second lookup that could disagree.

           **These do not add up to the split's image count, on purpose.** A frame holding
           two animals carries a label line for each and counts toward both species, so
           summing across species exceeds `dataset_splits.images`. The two are different
           facts and both are recorded. */
        await db.sequelize.query(
            'DELETE FROM dataset_split_species WHERE dataset_id = :datasetId',
            { replacements: { datasetId }, transaction }
        );

        const speciesOfClass = new Map(classes.map((entry) => [entry.class_index, entry.species_id]));

        for (const [split, counts] of (splitClassImages || new Map())) {
            for (const [klass, images] of counts) {
                const speciesId = speciesOfClass.get(klass);

                /* A class the vocabulary does not name cannot be attributed to a species,
                   and inventing one would put a bar under the wrong name. It is dropped
                   and the split total, which is recorded separately, still holds. */
                if (!speciesId || !images) continue;

                await db.sequelize.query(
                    `INSERT INTO dataset_split_species
                         (dataset_id, split, species_id, images, created_at, updated_at)
                     VALUES (:datasetId, :split, :speciesId, :images, NOW(), NOW())
                     ON CONFLICT (dataset_id, split, species_id)
                     DO UPDATE SET images = EXCLUDED.images, updated_at = NOW()`,
                    { replacements: { datasetId, split, speciesId, images }, transaction }
                );
            }
        }

        await db.sequelize.query(
            `UPDATE gpu_job_attempts SET state = 'succeeded', finished_at = NOW() WHERE id = :attemptId`,
            { replacements: { attemptId }, transaction }
        );

        await db.sequelize.query(
            `UPDATE gpu_jobs SET state = 'succeeded', finished_at = NOW(), updated_at = NOW() WHERE id = :jobId`,
            { replacements: { jobId }, transaction }
        );

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        logger.error('Error::' + error);
        throw error;
    }
}

/**
 * Mark a build failed, and say why.
 *
 * **The dataset keeps no archive columns.** A failed build may have written gigabytes
 * before it stopped; those are removed from disk by the service, and a row still naming
 * them would serve a 404 to the next worker that asked.
 *
 * @async
 * @param {Object} failure - `{jobId, attemptId, datasetId, reason, cancelled}`.
 * @returns {Promise<void>}
 */
async function failBuild({ jobId, attemptId, datasetId, reason, cancelled = false }) {
    const transaction = await db.sequelize.transaction();

    try {
        await db.sequelize.query(
            `UPDATE gpu_job_attempts
                SET state = :state, failure_reason = :reason, finished_at = NOW()
              WHERE id = :attemptId`,
            {
                replacements: { attemptId, reason, state: cancelled ? 'cancelled' : 'failed' },
                transaction,
            }
        );

        /* A cancelled job is already cancelled -- the state is how the run found out --
           so only a failure writes the job's state here. */
        if (!cancelled) {
            await db.sequelize.query(
                `UPDATE gpu_jobs SET state = 'failed', finished_at = NOW(), updated_at = NOW()
                  WHERE id = :jobId`,
                { replacements: { jobId }, transaction }
            );
        }

        /* **The selection counts go back to null along with the archive columns.**
           `recordSelection` writes them the moment the filters resolve, so a build that
           then failed at extraction would leave a row saying it holds 115 observations
           and 3 classes when `dataset_observations` is empty -- `recordBuild` is what
           writes the membership and it never ran. The panel counts that table live, so
           the row and the panel it expands into would disagree about the same dataset.
           Blank is what the column means when there is nothing in it. */
        await db.sequelize.query(
            `UPDATE datasets
                SET status = :status,
                    archive_path = NULL, archive_sha256 = NULL, archive_bytes = NULL,
                    num_observations = NULL, num_classes = NULL,
                    updated_at = NOW()
              WHERE id = :datasetId`,
            {
                replacements: { datasetId, status: cancelled ? 'draft' : 'failed' },
                transaction,
            }
        );

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        logger.error('Error::' + error);
        throw error;
    }
}

/**
 * Keep a build's lease alive while it works (#292).
 *
 * The runner calls this on a timer, because a lease measured in minutes must not lapse
 * through a stretch with no progress to report -- packaging a 20 GB archive is one.
 *
 * @async
 * @param {number} attemptId - The attempt.
 * @returns {Promise<void>}
 */
async function extendBuildLease(attemptId) {
    await db.sequelize.query(
        `UPDATE gpu_job_attempts
            SET lease_expires_at = NOW() + (:leaseSeconds * INTERVAL '1 second'),
                last_heartbeat_at = NOW()
          WHERE id = :attemptId AND state = 'running'`,
        { replacements: { attemptId, leaseSeconds: BUILD_LEASE_SECONDS } }
    );
}

/**
 * Hand a build back to the queue because the API is shutting down (#292).
 *
 * Not a failure and not a cancel: the attempt is closed as `abandoned`, the job goes back
 * to `queued` with the attempt it cost given back, and the dataset stays `building`. Its
 * staging is left where it is, and the next claim resumes from it.
 *
 * @async
 * @param {Object} args - `{jobId, attemptId}`.
 * @returns {Promise<void>}
 */
async function releaseBuild({ jobId, attemptId }) {
    const transaction = await db.sequelize.transaction();

    try {
        await db.sequelize.query(
            `UPDATE gpu_job_attempts
                SET state = 'abandoned', finished_at = NOW(),
                    failure_reason = 'The API shut down part-way; this build resumes from where it got to.'
              WHERE id = :attemptId`,
            { replacements: { attemptId }, transaction }
        );
        await db.sequelize.query(
            `UPDATE gpu_jobs
                SET state = 'queued', attempts_made = GREATEST(0, attempts_made - 1), updated_at = NOW()
              WHERE id = :jobId AND state = 'leased'`,
            { replacements: { jobId }, transaction }
        );
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        logger.error('Error::' + error);
        throw error;
    }
}

/**
 * The dataset builds still waiting or running, whose staging must be kept.
 *
 * @async
 * @returns {Promise<Set<number>>} Their job ids.
 */
async function liveBuildJobIds() {
    const rows = await db.sequelize.query(
        "SELECT id FROM gpu_jobs WHERE kind = 'dataset_build' AND state IN ('queued', 'leased')",
        { type: QueryTypes.SELECT }
    );

    return new Set(rows.map((row) => Number(row.id)));
}

module.exports = {
    API_WORKER_NAME,
    BUILD_LEASE_SECONDS,
    apiWorkerId,
    claimBuild,
    extendBuildLease,
    liveBuildJobIds,
    releaseBuild,
    failBuild,
    isCancelled,
    queueBuild,
    reclaimAbandonedBuilds,
    recordBuild,
    deleteBuildJobsFor,
    deleteDataset,
    getBuildSetup,
    countRunningBuilds,
    getQueuedBuilds,
    moveQueuedBuild,
    reportProgress,
    settleCancelledBuilds,
    recordSelection,
    sampleProgress,
    thumbnailsFor,
};
