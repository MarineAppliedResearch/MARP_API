/**
 * The thumbnail record: the queue, the outcomes, and the extractor's run state.
 *
 * **The queue is the `queued` rows in this table, not an in-memory list** (R18).
 * That is what makes a restart resume rather than strand every tile at PREPARING
 * for ever, and it is why claiming is a conditional `UPDATE` with a lease rather
 * than a `SELECT` followed by a decision. A row claimed by an extraction that
 * then died becomes claimable again after {@link CLAIM_TIMEOUT_SECONDS}.
 *
 * Raw SQL throughout rather than the model, for two reasons that have already
 * cost time in this repository: Sequelize's optimistic locking works only on
 * instance `save`/`destroy` and never on a static `Model.update`, so a
 * claim-by-update through the model would not be atomic; and a named replacement
 * holding an array expands to `(1,2,3)`, which makes `= ANY(:ids)` a syntax
 * error -- so every array here is a `$n` bind parameter.
 *
 * Refs #118.
 *
 * @fileoverview Queue, outcome and run-state persistence for observation thumbnails.
 * @author Isaac Travers
 * @module repository/observation-thumbnail
 */

'use strict';

const db = require('../model');
const {
    CLAIM_TIMEOUT_SECONDS,
    CLAIM_BATCH_SIZE,
    SWEEP_BATCH_SIZE,
    SWEEP_MAX_ATTEMPTS,
    SWEEP_BACKOFF_BASE_MINUTES,
    SWEEP_BACKOFF_MAX_MINUTES,
} = require('../config/thumbnails');

const { QueryTypes } = db.Sequelize;

/**
 * Every column a caller ever wants back from one row.
 *
 * Written out rather than `*` so that a column added later does not silently
 * join a response body.
 *
 * @constant
 * @type {string}
 */
const ROW_COLUMNS = `
    observation_thumbnail_id,
    observation_id,
    status,
    permanent,
    framenum,
    subset,
    filename,
    content_type,
    byte_size,
    width,
    height,
    source_width,
    source_height,
    generation,
    attempts,
    sweep_attempts,
    swept_at,
    request_priority,
    candidate_index,
    last_error,
    requested_at,
    claimed_at,
    completed_at,
    thumbnail_accessed_at,
    thumbnail_evicted_at,
    full_frame_status,
    full_frame_permanent,
    full_frame_framenum,
    full_frame_subset,
    full_frame_box,
    full_frame_filename,
    full_frame_content_type,
    full_frame_byte_size,
    full_frame_width,
    full_frame_height,
    full_frame_generation,
    full_frame_last_error,
    full_frame_requested_at,
    full_frame_claimed_at,
    full_frame_completed_at,
    full_frame_accessed_at,
    full_frame_evicted_at`;

/**
 * Enqueues a thumbnail for every observation on this page that has no record.
 *
 * **This is the backstop, not the primary trigger, and the difference is the whole
 * of A3.** The primary trigger is `keyframes_enqueue_thumbnail_trigger` on
 * `keyframes` (`migrations/20260910120000-...`), so by the time anybody looks the
 * work is normally already done or in flight -- which is what makes *"the user
 * never has to wait"* true. This catches what slipped through: the ~440,000
 * observations that predate the trigger, and anything an interrupted extraction
 * left with no row at all.
 *
 * The human's words, 2026-09-10: *"If a page tries to view something and those
 * thumbnails aren't available, that page should enqueue the observations that are
 * trying to be seen."* So `POST /api/mosaic/observations/pages` does have a side
 * effect, deliberately, and A10's answer to that stands: the concurrency constant
 * bounds it, not the permission.
 *
 * `ON CONFLICT DO NOTHING` is what makes two triggers safe rather than a race. A
 * row that is already `ready` is **never** reset to `queued` by a page view, and a
 * row recorded as permanently failed is never re-enqueued -- which is the whole
 * reason permanence is recorded. A page of hopeless legacy rows would otherwise
 * ask the media server again on every page view, for ever, on a button the page
 * invites the reviewer to press.
 *
 * @async
 * @param {Array<number>} observationIds - Observations on the page being served.
 * @param {Object} [transaction] - Transaction to run inside.
 * @returns {Promise<number>} How many rows were newly enqueued.
 */
async function enqueueMissing(observationIds, transaction) {
    const ids = (observationIds || []).filter((id) => Number.isInteger(id));

    if (ids.length === 0) {
        return 0;
    }

    // `$1` rather than a named replacement: a named replacement holding an array
    // is expanded to `(1,2,3)`, which is a syntax error against `= ANY(...)`.
    const inserted = await db.sequelize.query(
        `INSERT INTO observation_thumbnails
             (observation_id, status, permanent, generation, attempts, requested_at, created_at, updated_at)
         SELECT o.observation_id, 'queued', false, 1, 0, NOW(), NOW(), NOW()
           FROM observations o
          WHERE o.observation_id = ANY($1::int[])
         ON CONFLICT (observation_id) DO NOTHING
         RETURNING observation_id`,
        { bind: [ids], type: QueryTypes.SELECT, transaction }
    );

    // An evicted thumbnail is absent from disk by policy, not a terminal
    // extraction failure. Seeing its page requests it again just as seeing an
    // observation with no row does.
    await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET status = 'queued', claimed_at = NULL, requested_at = NOW(),
                last_error = NULL, thumbnail_evicted_at = NULL, updated_at = NOW()
          WHERE observation_id = ANY($1::int[])
            AND thumbnail_evicted_at IS NOT NULL`,
        { bind: [ids], type: QueryTypes.UPDATE, transaction }
    );

    return inserted.length;
}

/**
 * Puts a set of observations back in the queue, whatever they hold now.
 *
 * The retry route's write (R14). A **permanent** failure is refused rather than
 * re-queued -- that is what `permanent` is for -- and a row that is already
 * `ready` is left alone, because a retry is a request for a picture and one
 * exists. Everything else, including a transient failure and a row that never had
 * a record, becomes `queued`.
 *
 * Answers per observation, never by position: the rule #106's R3 established, and
 * a caller matching a response array against a request array by index is a defect
 * that hides until the two lengths differ.
 *
 * @async
 * @param {Array<number>} observationIds - Observations to retry.
 * @returns {Promise<Array<Object>>} One row per requested observation that exists.
 */
async function requeue(observationIds) {
    const ids = (observationIds || []).filter((id) => Number.isInteger(id));

    if (ids.length === 0) {
        return [];
    }

    return db.sequelize.transaction(async (transaction) => {
        await db.sequelize.query(
            `INSERT INTO observation_thumbnails
                 (observation_id, status, permanent, generation, attempts, request_priority,
                  candidate_index, requested_at, created_at, updated_at)
             SELECT o.observation_id, 'queued', false, 1, 0, 1, 0, NOW(), NOW(), NOW()
               FROM observations o
              WHERE o.observation_id = ANY($1::int[])
             ON CONFLICT (observation_id) DO NOTHING`,
            { bind: [ids], type: QueryTypes.INSERT, transaction }
        );

        await db.sequelize.query(
            `UPDATE observation_thumbnails
                SET status       = 'queued',
                    request_priority = 1,
                    candidate_index = candidate_index
                        + CASE WHEN framenum IS NULL THEN 0 ELSE 1 END,
                    claimed_at   = NULL,
                    completed_at = NULL,
                    requested_at = NOW(),
                    updated_at   = NOW()
              WHERE observation_id = ANY($1::int[])
                AND status         = 'failed'
                AND permanent      = false`,
            { bind: [ids], type: QueryTypes.UPDATE, transaction }
        );

        return db.sequelize.query(
            `SELECT ${ROW_COLUMNS}
               FROM observation_thumbnails
              WHERE observation_id = ANY($1::int[])`,
            { bind: [ids], type: QueryTypes.SELECT, transaction }
        );
    });
}

/**
 * Queues a reviewer-requested replacement, including for a ready picture.
 *
 * Repeated clicks while work is queued only raise its priority; they do not skip
 * a candidate that has not yet been attempted.
 *
 * @async
 * @param {number} observationId - Observation whose crop should be replaced.
 * @returns {Promise<Object|undefined>} Current row, or undefined when absent.
 */
async function requestReplacement(observationId) {
    return db.sequelize.transaction(async (transaction) => {
        await db.sequelize.query(
            `INSERT INTO observation_thumbnails
                 (observation_id, status, permanent, generation, attempts, request_priority,
                  candidate_index, requested_at, created_at, updated_at)
             SELECT o.observation_id, 'queued', false, 1, 0, 1, 0, NOW(), NOW(), NOW()
               FROM observations o
              WHERE o.observation_id = :observationId
             ON CONFLICT (observation_id) DO NOTHING`,
            { replacements: { observationId }, type: QueryTypes.INSERT, transaction }
        );

        await db.sequelize.query(
            `UPDATE observation_thumbnails
                SET status = 'queued',
                    request_priority = 1,
                    candidate_index = candidate_index
                        + CASE WHEN status IN ('ready', 'failed') AND framenum IS NOT NULL
                               THEN 1 ELSE 0 END,
                    permanent = false,
                    claimed_at = CASE WHEN status = 'queued' THEN claimed_at ELSE NULL END,
                    completed_at = NULL,
                    requested_at = CASE WHEN status = 'queued' THEN requested_at ELSE NOW() END,
                    updated_at = NOW()
              WHERE observation_id = :observationId
                AND permanent = false`,
            { replacements: { observationId }, type: QueryTypes.UPDATE, transaction }
        );

        const [row] = await db.sequelize.query(
            `SELECT ${ROW_COLUMNS}
               FROM observation_thumbnails
              WHERE observation_id = :observationId`,
            { replacements: { observationId }, type: QueryTypes.SELECT, transaction }
        );

        return row;
    });
}

/**
 * Queues an observation's thumbnail to be extracted again because its keyframes changed (#181).
 *
 * Unlike {@link requestReplacement}, which moves on to a different candidate because the
 * reviewer did not like the crop, this starts again from the first: the keyframes the crop
 * is cut from are what changed, so the same choice now gives the edited box. A permanent
 * failure is reconsidered too, for the same reason -- what made it permanent may be what was
 * edited.
 *
 * @async
 * @param {number} observationId - Observation whose keyframes were edited.
 * @returns {Promise<void>}
 */
async function requestRefresh(observationId) {
    await db.sequelize.transaction(async (transaction) => {
        await db.sequelize.query(
            `INSERT INTO observation_thumbnails
                 (observation_id, status, permanent, generation, attempts, request_priority,
                  candidate_index, requested_at, created_at, updated_at)
             SELECT o.observation_id, 'queued', false, 1, 0, 1, 0, NOW(), NOW(), NOW()
               FROM observations o
              WHERE o.observation_id = :observationId
             ON CONFLICT (observation_id) DO NOTHING`,
            { replacements: { observationId }, type: QueryTypes.INSERT, transaction }
        );
        await db.sequelize.query(
            `UPDATE observation_thumbnails
                SET status = 'queued',
                    request_priority = 1,
                    candidate_index = 0,
                    permanent = false,
                    claimed_at = NULL,
                    completed_at = NULL,
                    requested_at = NOW(),
                    updated_at = NOW()
              WHERE observation_id = :observationId`,
            { replacements: { observationId }, type: QueryTypes.UPDATE, transaction }
        );
    });
}

/**
 * Whether anything is waiting to be extracted right now (#121 A3).
 *
 * `EXISTS` rather than a count, and it matters: this is asked on every sweep
 * tick, forever, and the two partial indexes on `status = 'queued'` and
 * `full_frame_status = 'queued'` answer it without reading a row. A count would
 * scan the matching rows to produce a number nothing needs.
 *
 * Both kinds count, because both come out of one `claimBatch` and both hold one
 * of the three Jellyfin streams while they run.
 *
 * @async
 * @returns {Promise<boolean>} True while any thumbnail or full frame is queued.
 */
async function hasQueuedWork() {
    const [row] = await db.sequelize.query(
        `SELECT EXISTS (
                    SELECT 1 FROM observation_thumbnails WHERE status = 'queued'
                ) OR EXISTS (
                    SELECT 1 FROM observation_thumbnails WHERE full_frame_status = 'queued'
                ) AS busy`,
        { type: QueryTypes.SELECT }
    );

    return Boolean(row.busy);
}

/**
 * Offers a bounded batch of **transient** failures to the queue again (#121 R2).
 *
 * This is the half of #121 that turned out to matter. The development corpus held
 * 3,567 rows that are `failed` with `permanent = false` -- Jellyfin refusing a
 * connection, ffmpeg timing out after two minutes -- and nothing retried any of
 * them. `permanent` already drew the line; this is the first thing to act on it.
 *
 * Three exclusions, each of which is the whole reason a column exists:
 *
 * - **`permanent`** is never offered. That is what the flag is for, and without it
 *   an observation with no keyframes is asked for every five minutes for ever.
 * - **`thumbnail_evicted_at IS NOT NULL` is never offered, and this one nearly
 *   became a loop.** `markFileEvicted` leaves exactly the shape this query looks
 *   for -- `failed`, not permanent -- because an evicted picture *is* re-derivable
 *   and a reviewer who opens its page does get it back. But a sweeper that
 *   re-extracts it would undo the eviction that freed the disk, and the evictor
 *   would free it again, and the two would trade the same bytes against the media
 *   server the concurrency bound exists to protect. Eviction is a decision; the
 *   sweeper does not get to overrule it.
 * - **`sweep_attempts` at the cap** is given up on (R4). A reviewer pressing *Ask
 *   again* still works: `requeue` reads neither of these columns and writes
 *   neither.
 *
 * The wait doubles from {@link SWEEP_BACKOFF_BASE_MINUTES}, capped at
 * {@link SWEEP_BACKOFF_MAX_MINUTES}. Measured from `swept_at` rather than
 * `completed_at` **because the reviewer path writes `completed_at`** -- a backoff
 * read from it would restart its clock every time somebody pressed the button, so
 * the wait would never actually grow.
 *
 * `request_priority` is left at 0. #134 already declares 0 as ordinary
 * page/background work and 1 as a reviewer waiting, and `claimBatch` already
 * orders by it -- so R3 needed no schema change and no change to the claim query.
 * `candidate_index` is deliberately **not** advanced: a connection refused says
 * nothing about the frame that was chosen, and moving off a good candidate because
 * the network was down is how a tile ends up showing the wrong moment.
 *
 * @async
 * @param {number} [limit] - How many rows this pass may offer.
 * @returns {Promise<Array<number>>} The observation ids put back in the queue.
 */
async function sweepRetryable(limit = SWEEP_BATCH_SIZE, transaction) {
    const rows = await db.sequelize.query(
        `WITH due AS (
             SELECT observation_thumbnail_id
               FROM observation_thumbnails
              WHERE status = 'failed'
                AND permanent = false
                AND thumbnail_evicted_at IS NULL
                AND sweep_attempts < :maxAttempts
                AND (swept_at IS NULL
                     OR swept_at < NOW() - make_interval(mins => LEAST(
                            :base * (2 ^ sweep_attempts), :maxMinutes)::int))
              ORDER BY swept_at NULLS FIRST, observation_id
              LIMIT :limit
                FOR UPDATE SKIP LOCKED
         )
         UPDATE observation_thumbnails t
            SET status         = 'queued',
                claimed_at     = NULL,
                completed_at   = NULL,
                requested_at   = NOW(),
                sweep_attempts = t.sweep_attempts + 1,
                swept_at       = NOW(),
                updated_at     = NOW()
           FROM due d
          WHERE t.observation_thumbnail_id = d.observation_thumbnail_id
      RETURNING t.observation_id`,
        {
            replacements: {
                limit,
                maxAttempts: SWEEP_MAX_ATTEMPTS,
                base: SWEEP_BACKOFF_BASE_MINUTES,
                maxMinutes: SWEEP_BACKOFF_MAX_MINUTES,
            },
            type: QueryTypes.SELECT,
            transaction,
        }
    );

    return rows.map((row) => row.observation_id);
}

/**
 * Enqueues a bounded batch of observations that have no thumbnail record at all
 * (#121 R5).
 *
 * **Finding nothing is the normal outcome and is not a failure.** Two mechanisms
 * already cover this: `keyframes_enqueue_thumbnail_trigger` writes a row when a
 * keyframe is written, and `mosaic.repository.js` enqueues what a served page is
 * missing. On the development corpus all 114,924 observations already had a row.
 *
 * It is kept because neither mechanism is exhaustive. `discardQueue()` -- the
 * `stop` control -- *deletes* queued rows; a corpus restored by
 * `scripts/load-corpus.js` carries whatever rows its dump held; and an observation
 * whose keyframes were written before the trigger existed has never been offered
 * to anything but a page view. This is the guard that notices, rather than the
 * thing that does the work.
 *
 * `ON CONFLICT DO NOTHING` for the same reason `enqueueMissing` has it: two
 * producers must be safe rather than a race, and a `ready` row must never be reset
 * by one.
 *
 * @async
 * @param {number} [limit] - How many rows this pass may enqueue.
 * @returns {Promise<Array<number>>} The observation ids newly enqueued.
 */
async function sweepBackfill(limit = SWEEP_BATCH_SIZE, transaction) {
    const rows = await db.sequelize.query(
        `INSERT INTO observation_thumbnails
             (observation_id, status, permanent, generation, attempts,
              requested_at, created_at, updated_at)
         SELECT o.observation_id, 'queued', false, 1, 0, NOW(), NOW(), NOW()
           FROM observations o
          WHERE NOT EXISTS (
                    SELECT 1 FROM observation_thumbnails t
                     WHERE t.observation_id = o.observation_id
                )
          ORDER BY o.observation_id
          LIMIT :limit
         ON CONFLICT (observation_id) DO NOTHING
         RETURNING observation_id`,
        { replacements: { limit }, type: QueryTypes.SELECT, transaction }
    );

    return rows.map((row) => row.observation_id);
}

/**
 * One sweep: offer retryable failures, then backfill what has no record (#121).
 *
 * Both halves in **one transaction**, so a pass is all or nothing. A sweeper that
 * died between them would leave rows re-queued with nothing recording that the
 * backfill half never ran -- harmless once, and the kind of thing that is
 * impossible to reason about when it happens on the night somebody is debugging
 * something else.
 *
 * The transaction is also the seam the tests use. The two queries are deliberately
 * **unscoped** -- a sweeper that only swept rows it was handed would not be a
 * sweeper -- so a test that ran one against the development database would offer
 * every real failure in it. Running them inside a transaction the test rolls back
 * is what makes them assertable without touching the corpus (#142).
 *
 * @async
 * @param {number} [limit] - How many rows each half may enqueue.
 * @returns {Promise<Object>} `{ retried, backfilled }` counts.
 */
async function sweep(limit = SWEEP_BATCH_SIZE) {
    return db.sequelize.transaction(async (transaction) => ({
        retried: (await sweepRetryable(limit, transaction)).length,
        backfilled: (await sweepBackfill(limit, transaction)).length,
    }));
}

/**
 * Claims a batch of queued work for one extraction pass (R18).
 *
 * One statement, so two API processes -- or one restarted next to itself -- cannot
 * both take the same row. `FOR UPDATE SKIP LOCKED` is what lets a second claimer
 * take different rows rather than waiting behind the first.
 *
 * A row is claimable when it is `queued` and either has never been claimed or was
 * claimed longer ago than the lease. That second half is the reclaim: an
 * extraction whose process died leaves a claimed row behind, and without it that
 * tile says PREPARING until somebody notices.
 *
 * Reviewer requests first, then oldest within each class. R19 is backpressure by **dropping priority, never by
 * rejecting** -- a long queue makes a reviewer wait behind a PREPARING tile,
 * which the client already draws, rather than producing a state it has no
 * rendering for.
 *
 * @async
 * @param {number} [limit] - How many rows to claim.
 * @returns {Promise<Array<Object>>} The claimed rows, joined to what extraction needs.
 */
async function claimBatch(limit = CLAIM_BATCH_SIZE) {
    return db.sequelize.query(
        `WITH choices AS (
             SELECT t.observation_thumbnail_id, 'thumbnail'::text AS artifact_kind,
                    t.request_priority AS priority, t.requested_at
               FROM observation_thumbnails t
              WHERE t.status = 'queued'
                AND (t.claimed_at IS NULL
                     OR t.claimed_at < NOW() - make_interval(secs => $2::int))
             UNION ALL
             SELECT t.observation_thumbnail_id, 'full_frame'::text AS artifact_kind,
                    1 AS priority, t.full_frame_requested_at AS requested_at
               FROM observation_thumbnails t
              WHERE t.full_frame_status = 'queued'
                AND (t.full_frame_claimed_at IS NULL
                     OR t.full_frame_claimed_at < NOW() - make_interval(secs => $2::int))
         ), ranked AS (
             SELECT DISTINCT ON (observation_thumbnail_id)
                    observation_thumbnail_id, artifact_kind, priority, requested_at
               FROM choices
              ORDER BY observation_thumbnail_id, priority DESC, requested_at NULLS FIRST,
                       artifact_kind
         ), claimable AS (
             SELECT r.*
               FROM ranked r
               JOIN observation_thumbnails t USING (observation_thumbnail_id)
              ORDER BY r.priority DESC, r.requested_at NULLS FIRST, t.observation_id
              LIMIT $1
                FOR UPDATE OF t SKIP LOCKED
         ),
         claimed AS (
             UPDATE observation_thumbnails t
                SET claimed_at = CASE WHEN c.artifact_kind = 'thumbnail'
                                      THEN NOW() ELSE t.claimed_at END,
                    attempts = t.attempts + CASE WHEN c.artifact_kind = 'thumbnail'
                                                 THEN 1 ELSE 0 END,
                    full_frame_claimed_at = CASE WHEN c.artifact_kind = 'full_frame'
                                                 THEN NOW() ELSE t.full_frame_claimed_at END,
                    updated_at = NOW()
               FROM claimable c
              WHERE t.observation_thumbnail_id = c.observation_thumbnail_id
              RETURNING t.observation_thumbnail_id, t.observation_id, t.attempts,
                        c.artifact_kind, c.priority, c.requested_at
         )
         SELECT c.observation_thumbnail_id,
                c.observation_id,
                c.attempts,
                c.artifact_kind,
                t.request_priority,
                t.candidate_index,
                t.filename AS thumbnail_filename,
                t.full_frame_framenum,
                t.full_frame_subset,
                t.full_frame_filename,
                o.video_source,
                o."mediaPosition",
                -- Who wrote the row decides what its frame numbers mean (#231).
                o.gpu_job_id
           FROM claimed c
           JOIN observation_thumbnails t
             ON t.observation_thumbnail_id = c.observation_thumbnail_id
           JOIN observations o ON o.observation_id = c.observation_id
          ORDER BY c.priority DESC, c.requested_at NULLS FIRST, c.observation_id`,
        { bind: [limit, CLAIM_TIMEOUT_SECONDS], type: QueryTypes.SELECT }
    );
}

/**
 * Reads every keyframe of a set of observations, for the box choice.
 *
 * One statement for the whole batch rather than one per observation: a page is 45
 * tiles and 45 round trips to answer a question one query answers is the kind of
 * cost that is invisible until the corpus is real.
 *
 * @async
 * @param {Array<number>} observationIds - Observations to read keyframes for.
 * @returns {Promise<Map<number, Array<Object>>>} observation_id to its keyframes.
 */
async function keyframesFor(observationIds) {
    const ids = (observationIds || []).filter((id) => Number.isInteger(id));

    if (ids.length === 0) {
        return new Map();
    }

    const rows = await db.sequelize.query(
        `SELECT observation_id, subset, framenum, x, y, width, height
           FROM keyframes
          WHERE observation_id = ANY($1::int[])
          ORDER BY observation_id, framenum`,
        { bind: [ids], type: QueryTypes.SELECT }
    );

    const byObservation = new Map(ids.map((id) => [id, []]));

    for (const row of rows) {
        byObservation.get(row.observation_id).push(row);
    }

    return byObservation;
}

/**
 * Records a finished thumbnail.
 *
 * `generation` is bumped rather than set, because the URL is stable per
 * observation: without it a re-extracted picture would sit invisible behind a
 * cached copy in every reviewer's browser.
 *
 * @async
 * @param {number} observationId - Whose thumbnail.
 * @param {Object} result - What was produced.
 * @param {string} result.filename - Relative to the storage directory.
 * @param {string} result.contentType - MIME type of the stored file.
 * @param {number} result.byteSize - Size on disk.
 * @param {number} result.width - Stored tile width.
 * @param {number} result.height - Stored tile height.
 * @param {number} result.sourceWidth - Decoded frame width (R6).
 * @param {number} result.sourceHeight - Decoded frame height (R6).
 * @param {number} result.framenum - The frame it was cut from (R8).
 * @param {string|null} result.subset - Which track the box came from.
 * @returns {Promise<Object|undefined>} The updated row.
 */
async function recordReady(observationId, result) {
    const [row] = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET status        = 'ready',
                permanent     = false,
                filename      = :filename,
                content_type  = :contentType,
                byte_size     = :byteSize,
                width         = :width,
                height        = :height,
                source_width  = :sourceWidth,
                source_height = :sourceHeight,
                framenum      = :framenum,
                subset        = :subset,
                request_priority = 0,
                generation    = generation + 1,
                last_error    = NULL,
                claimed_at    = NULL,
                completed_at  = NOW(),
                thumbnail_accessed_at = NOW(),
                thumbnail_evicted_at = NULL,
                full_frame_status = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                         THEN NULL ELSE full_frame_status END,
                full_frame_permanent = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                            THEN false ELSE full_frame_permanent END,
                full_frame_framenum = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                           THEN NULL ELSE full_frame_framenum END,
                full_frame_subset = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                         THEN NULL ELSE full_frame_subset END,
                full_frame_box = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                      THEN NULL ELSE full_frame_box END,
                full_frame_filename = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                           THEN NULL ELSE full_frame_filename END,
                full_frame_content_type = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                               THEN NULL ELSE full_frame_content_type END,
                full_frame_byte_size = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                            THEN NULL ELSE full_frame_byte_size END,
                full_frame_width = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                        THEN NULL ELSE full_frame_width END,
                full_frame_height = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                         THEN NULL ELSE full_frame_height END,
                full_frame_last_error = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                             THEN NULL ELSE full_frame_last_error END,
                full_frame_accessed_at = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                              THEN NULL ELSE full_frame_accessed_at END,
                full_frame_evicted_at = CASE WHEN full_frame_status IS NOT NULL AND full_frame_framenum IS DISTINCT FROM :framenum
                                             THEN NOW() ELSE full_frame_evicted_at END,
                updated_at    = NOW()
          WHERE observation_id = :observationId
        RETURNING ${ROW_COLUMNS}`,
        {
            replacements: {
                observationId,
                filename: result.filename,
                contentType: result.contentType,
                byteSize: result.byteSize,
                width: result.width,
                height: result.height,
                sourceWidth: result.sourceWidth,
                sourceHeight: result.sourceHeight,
                framenum: result.framenum,
                subset: result.subset == null ? null : String(result.subset),
            },
            type: QueryTypes.SELECT,
        }
    );

    return row;
}

/**
 * Records a failed extraction, permanently or not.
 *
 * **Permanent means retrying cannot help**, and the honesty of that flag is what
 * protects the media server: a permanent row is never re-enqueued by a page view,
 * never re-enqueued by a later keyframe, and never re-queued by the retry route --
 * so neither paging nor the *Ask again* button the page invites the reviewer to
 * press is a way to hammer Jellyfin.
 *
 * `lastError` reaches an operator and a reviewer-facing diagnostic, so a caller
 * must never put a stream URL in it -- `buildDirectStreamUrl` embeds the Jellyfin
 * access token as `api_key`.
 *
 * @async
 * @param {number} observationId - Whose thumbnail.
 * @param {string} lastError - Why, in words.
 * @param {boolean} [permanent] - Whether retrying could ever help.
 * @param {Object} [candidate] - Frame and subset actually attempted.
 * @returns {Promise<Object|undefined>} The updated row.
 */
async function recordFailure(observationId, lastError, permanent = false, candidate = null) {
    const [row] = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET status       = 'failed',
                permanent    = :permanent,
                last_error   = :lastError,
                framenum     = COALESCE(:framenum, framenum),
                subset       = COALESCE(:subset, subset),
                request_priority = 0,
                claimed_at   = NULL,
                completed_at = NOW(),
                updated_at   = NOW()
          WHERE observation_id = :observationId
        RETURNING ${ROW_COLUMNS}`,
        {
            replacements: {
                observationId,
                lastError,
                permanent: Boolean(permanent),
                framenum: candidate && Number.isInteger(Number(candidate.frame))
                    ? Number(candidate.frame) : null,
                subset: candidate && candidate.subset != null ? String(candidate.subset) : null,
            },
            type: QueryTypes.SELECT,
        }
    );

    return row;
}

/**
 * Releases a claim without deciding an outcome.
 *
 * Used when the extractor is asked to pause or stop while a batch is in hand: the
 * row goes back to being plain `queued` rather than being marked failed for
 * something that was never tried.
 *
 * @async
 * @param {Array<number>} observationIds - Observations to release.
 * @returns {Promise<number>} How many rows were released.
 */
async function releaseClaims(observationIds) {
    const ids = (observationIds || []).filter((id) => Number.isInteger(id));

    if (ids.length === 0) {
        return 0;
    }

    const released = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET claimed_at = NULL,
                full_frame_claimed_at = NULL,
                updated_at = NOW()
          WHERE observation_id = ANY($1::int[])
            AND (status = 'queued' OR full_frame_status = 'queued')
        RETURNING observation_id`,
        { bind: [ids], type: QueryTypes.SELECT }
    );

    return released.length;
}

/**
 * One observation's thumbnail record, or undefined.
 *
 * @async
 * @param {number} observationId - Which observation.
 * @returns {Promise<Object|undefined>} The row.
 */
async function findByObservationId(observationId) {
    const [row] = await db.sequelize.query(
        `SELECT ${ROW_COLUMNS}
           FROM observation_thumbnails
          WHERE observation_id = :observationId`,
        { replacements: { observationId }, type: QueryTypes.SELECT }
    );

    return row;
}

/** Queue the complete frame currently backing a ready square thumbnail. */
async function requestFullFrame(observationId) {
    const [row] = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET full_frame_status = CASE
                    WHEN full_frame_status = 'ready'
                     AND full_frame_framenum = framenum
                     AND full_frame_filename IS NOT NULL THEN 'ready'
                    WHEN full_frame_status = 'failed'
                     AND full_frame_permanent
                     AND full_frame_framenum = framenum THEN 'failed'
                    ELSE 'queued' END,
                full_frame_permanent = CASE
                    WHEN full_frame_status = 'failed'
                     AND full_frame_permanent
                     AND full_frame_framenum = framenum THEN true
                    ELSE false END,
                full_frame_framenum = framenum,
                full_frame_subset = subset,
                full_frame_last_error = CASE
                    WHEN full_frame_status = 'failed'
                     AND full_frame_permanent
                     AND full_frame_framenum = framenum THEN full_frame_last_error
                    ELSE NULL END,
                full_frame_claimed_at = CASE
                    WHEN full_frame_status = 'queued'
                     AND full_frame_framenum = framenum THEN full_frame_claimed_at
                    ELSE NULL END,
                full_frame_requested_at = CASE
                    WHEN full_frame_status = 'ready'
                     AND full_frame_framenum = framenum
                     AND full_frame_filename IS NOT NULL THEN full_frame_requested_at
                    WHEN full_frame_status = 'failed'
                     AND full_frame_permanent
                     AND full_frame_framenum = framenum THEN full_frame_requested_at
                    WHEN full_frame_status = 'queued'
                     AND full_frame_framenum = framenum THEN full_frame_requested_at
                    ELSE NOW() END,
                full_frame_evicted_at = NULL,
                updated_at = NOW()
          WHERE observation_id = :observationId
            AND status = 'ready' AND framenum IS NOT NULL
      RETURNING ${ROW_COLUMNS}`,
        { replacements: { observationId }, type: QueryTypes.SELECT }
    );
    return row;
}

async function recordFullFrameReady(observationId, result) {
    const [row] = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET full_frame_status = 'ready', full_frame_permanent = false,
                full_frame_filename = :filename, full_frame_content_type = :contentType,
                full_frame_byte_size = :byteSize, full_frame_width = :width,
                full_frame_height = :height, full_frame_box = CAST(:box AS jsonb),
                full_frame_generation = full_frame_generation + 1,
                full_frame_last_error = NULL, full_frame_claimed_at = NULL,
                full_frame_completed_at = NOW(), full_frame_accessed_at = NOW(),
                full_frame_evicted_at = NULL, updated_at = NOW()
          WHERE observation_id = :observationId
      RETURNING ${ROW_COLUMNS}`,
        { replacements: {
            observationId, filename: result.filename, contentType: result.contentType,
            byteSize: result.byteSize, width: result.width, height: result.height,
            box: JSON.stringify(result.box)
        }, type: QueryTypes.SELECT }
    );
    return row;
}

async function recordFullFrameFailure(observationId, message, permanent) {
    const [row] = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET full_frame_status = 'failed', full_frame_permanent = :permanent,
                full_frame_last_error = :message, full_frame_claimed_at = NULL,
                full_frame_completed_at = NOW(), updated_at = NOW()
          WHERE observation_id = :observationId
      RETURNING ${ROW_COLUMNS}`,
        { replacements: { observationId, message, permanent: Boolean(permanent) }, type: QueryTypes.SELECT }
    );
    return row;
}

/**
 * Discards the queue (R24, `stop`).
 *
 * The rows return to being **simply absent**, which is what makes the next page
 * view re-enqueue them (R28). So nothing is lost, and no fourth state had to be
 * invented for "was queued and then abandoned".
 *
 * `ready` and `failed` rows are untouched: they are outcomes, not queue.
 *
 * @async
 * @returns {Promise<number>} How many queued rows were discarded.
 */
async function discardQueue() {
    return db.sequelize.transaction(async (transaction) => {
        /* A full-frame record shares this row. Keep that independent state when
           stopping thumbnail work instead of deleting the whole cache record. */
        const preserved = await db.sequelize.query(
            `UPDATE observation_thumbnails
                SET status = 'failed', permanent = false,
                    last_error = 'Queue stopped; this thumbnail will be requested again when viewed.',
                    claimed_at = NULL, thumbnail_evicted_at = NOW(), updated_at = NOW()
              WHERE status = 'queued' AND full_frame_status IS NOT NULL
            RETURNING observation_id`,
            { type: QueryTypes.SELECT, transaction }
        );
        const removed = await db.sequelize.query(
            `DELETE FROM observation_thumbnails
              WHERE status = 'queued'
            RETURNING observation_id`,
            { type: QueryTypes.SELECT, transaction }
        );

        return preserved.length + removed.length;
    });
}

/**
 * How many rows sit in each state (R23).
 *
 * `permanent` is counted separately rather than as a state, because it is a
 * property of a failure rather than a fourth value -- the client's vocabulary is
 * three, and this is what makes A7's constant tunable by observation.
 *
 * @async
 * @returns {Promise<Object>} `{ queued, ready, failed, permanent, inFlight }`.
 */
async function statusCounts() {
    const [row] = await db.sequelize.query(
        `SELECT count(*) FILTER (WHERE status = 'queued')::int                 AS queued,
                count(*) FILTER (WHERE status = 'ready')::int                  AS ready,
                count(*) FILTER (WHERE status = 'failed')::int                 AS failed,
                count(*) FILTER (WHERE status = 'failed' AND permanent)::int   AS permanent,
                count(*) FILTER (WHERE status = 'queued'
                                   AND claimed_at IS NOT NULL)::int            AS claimed
           FROM observation_thumbnails`,
        { type: QueryTypes.SELECT }
    );

    return row;
}

/**
 * The most recent failure, for the status endpoint's "last error" (R23).
 *
 * @async
 * @returns {Promise<Object|undefined>} `{ observation_id, last_error, completed_at }`.
 */
async function lastFailure() {
    const [row] = await db.sequelize.query(
        `SELECT observation_id, last_error, completed_at
           FROM observation_thumbnails
          WHERE status = 'failed' AND last_error IS NOT NULL
          ORDER BY completed_at DESC NULLS LAST, observation_id DESC
          LIMIT 1`,
        { type: QueryTypes.SELECT }
    );

    return row;
}

/**
 * The persisted run state (R25).
 *
 * The row is seeded by the migration, so every reader can assume it exists -- a
 * service that has to cope with its own state being absent has two code paths
 * where one will do.
 *
 * @async
 * @returns {Promise<Object>} `{ run_state, changed_by_user_id, changed_at, note }`.
 */
async function readRunState() {
    const [row] = await db.sequelize.query(
        `SELECT run_state, changed_by_user_id, changed_at, note
           FROM thumbnail_extraction_state
          WHERE id = 1`,
        { type: QueryTypes.SELECT }
    );

    return row;
}

/**
 * Writes the run state, recording who changed it and why.
 *
 * Persisted rather than held in memory because a service paused *because Jellyfin
 * was struggling* must still be paused after an API restart, or the pause
 * silently expires at the worst moment (R25).
 *
 * @async
 * @param {string} runState - `running` or `paused`.
 * @param {number|null} userId - Who asked.
 * @param {string|null} [note] - Why, in the operator's words.
 * @returns {Promise<Object>} The updated row.
 */
async function writeRunState(runState, userId, note = null) {
    const [row] = await db.sequelize.query(
        `UPDATE thumbnail_extraction_state
            SET run_state          = :runState,
                changed_by_user_id = :userId,
                changed_at         = NOW(),
                note               = :note
          WHERE id = 1
        RETURNING run_state, changed_by_user_id, changed_at, note`,
        {
            replacements: { runState, userId: userId == null ? null : userId, note },
            type: QueryTypes.SELECT,
        }
    );

    return row;
}

module.exports = {
    enqueueMissing,
    claimBatch,
    hasQueuedWork,
    sweep,
    sweepBackfill,
    sweepRetryable,
    discardQueue,
    findByObservationId,
    keyframesFor,
    lastFailure,
    readRunState,
    recordFailure,
    recordFullFrameFailure,
    recordFullFrameReady,
    recordReady,
    releaseClaims,
    requestReplacement,
    requestRefresh,
    requestFullFrame,
    requeue,
    statusCounts,
    writeRunState,
};
