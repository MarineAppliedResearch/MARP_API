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
async function queueBuild({ name, description = null, filters = {}, subsets = null, image = null, splits, createdBy = null }) {
    const transaction = await db.sequelize.transaction();

    try {
        const [dataset] = await db.sequelize.query(
            `INSERT INTO datasets (name, description, status, source, created_at, updated_at)
             VALUES (:name, :description, 'building', 'ml-dashboard', NOW(), NOW())
             RETURNING *`,
            { replacements: { name, description }, type: QueryTypes.SELECT, transaction }
        );

        const [job] = await db.sequelize.query(
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts,
                                   created_by, created_at, updated_at)
             VALUES ('dataset_build', :name, :spec, 'queued', 0, 0, 3, :createdBy, NOW(), NOW())
             RETURNING *`,
            {
                replacements: {
                    name: `Build ${name}`,
                    spec: JSON.stringify({ dataset_id: dataset.id, filters, subsets, image, splits }),
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
                       j.attempts_made < j.max_attempts AS retryable
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
                       failure_reason = 'The API stopped while this build was running, so it was abandoned.'
                  FROM abandoned ab
                 WHERE a.id = ab.attempt_id
                 RETURNING ab.job_id, ab.retryable
         ),
         requeued AS (
                UPDATE gpu_jobs j
                   SET state = CASE WHEN c.retryable THEN 'queued' ELSE 'failed' END,
                       finished_at = CASE WHEN c.retryable THEN NULL ELSE NOW() END,
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

        const epoch = Number(job.attempts_made) + 1;

        const [attempt] = await db.sequelize.query(
            `INSERT INTO gpu_job_attempts
                 (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at)
             VALUES (:jobId, :workerId, 0, :epoch, 'running', NOW(), NOW() + INTERVAL '1 hour')
             RETURNING *`,
            { replacements: { jobId: job.id, workerId, epoch }, type: QueryTypes.SELECT, transaction }
        );

        await db.sequelize.query(
            `UPDATE gpu_jobs
                SET state = 'leased', attempts_made = :epoch, updated_at = NOW()
              WHERE id = :jobId`,
            { replacements: { jobId: job.id, epoch }, transaction }
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
                lease_expires_at = NOW() + INTERVAL '1 hour'
          WHERE id = :attemptId`,
        {
            replacements: {
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
async function recordBuild({ jobId, attemptId, datasetId, members, classes, archive, frames, observations }) {
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
                `INSERT INTO dataset_classes (dataset_id, species_id, class_index, created_at, updated_at)
                 VALUES (:datasetId, :speciesId, :classIndex, NOW(), NOW())`,
                {
                    replacements: {
                        datasetId,
                        speciesId: entry.species_id,
                        classIndex: entry.class_index,
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
                },
                transaction,
            }
        );

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

module.exports = {
    API_WORKER_NAME,
    apiWorkerId,
    claimBuild,
    failBuild,
    isCancelled,
    queueBuild,
    reclaimAbandonedBuilds,
    recordBuild,
    reportProgress,
    settleCancelledBuilds,
    recordSelection,
    sampleProgress,
};
