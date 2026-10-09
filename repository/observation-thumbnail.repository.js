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
const { CLAIM_TIMEOUT_SECONDS, CLAIM_BATCH_SIZE } = require('../config/thumbnails');

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
    requestFullFrame,
    requeue,
    statusCounts,
    writeRunState,
};
