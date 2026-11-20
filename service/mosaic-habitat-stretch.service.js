/**
 * Changing when a habitat stretch starts and ends, from the video page's habitat timeline
 * (#287, R5).
 *
 * Settled with Isaac on 2026-11-20 (`.marp/task.md` on `287-trial-fixes`):
 *
 * - **Every column that states the time moves together** (`retimedColumns`), for a model's
 *   stretch and an annotator's alike. A model's start and end keyframes move with them.
 * - **A stretch keeps its review** (A3): fixing the times is part of reviewing it.
 * - **Dragging into a neighbour of the same substrate merges the two** (A4). The stretch dragged
 *   survives and grows to cover both; the neighbour is deleted, as the Mosaic's merge deletes
 *   one -- with its keyframes, picture and reviews. Only a neighbour the drag *reached* is
 *   merged: one the stretch already overlapped before is left alone, so an old overlap in the
 *   record is never merged by a drag that went nowhere near it.
 * - **The Mosaic picture is left as it is** (A5); *Use this picture* replaces it.
 *
 * @fileoverview Retiming habitat stretches for the Mosaic video page.
 * @module service/mosaic-habitat-stretch
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { HABITAT_SESSION_TYPE, derivedKeyframes, retimedColumns } = require('../db/habitat-keyframes');
const { ASSUMED_FPS } = require('../db/timecode');
const { rateOf, invalid, notFound } = require('./mosaic-video-edit.service');
const keys = require('../repository/observation-ingest.repository');
const thumbnails = require('../repository/observation-thumbnail.repository');

/* The columns a stretch's times are read from, for itself and for its neighbours. */
const STRETCH_COLUMNS = `o.observation_id, o.session_id, o.species_id, o.video_source, o.gpu_job_id,
       o."mediaPosition", o."actualPosition", o.tc, o.etc, o.frame, o.observed_at, o.version`;

/**
 * Where a stretch is in the video, as the page reads it: from its keyframes when it has
 * them, else from the two worked out from its times.
 *
 * @param {Object} row - A stretch, with `STRETCH_COLUMNS`.
 * @param {Array<Object>} keyframes - Its keyframes rows.
 * @param {number} rate - The rate a keyed stretch's frames count at.
 * @returns {{start: number, end: number, hasEnd: boolean, keyed: boolean}} In seconds.
 */
function spanOf(row, keyframes, rate) {
    if (keyframes.length) {
        const frames = keyframes.map((k) => Number(k.framenum));
        return {
            start: Math.min(...frames) / rate,
            end: Math.max(...frames) / rate,
            hasEnd: keyframes.some((k) => k.type === 'end'),
            keyed: true,
        };
    }
    const derived = derivedKeyframes(row);
    if (!derived.length) return null;
    return {
        start: derived[0].framenum / ASSUMED_FPS,
        end: derived[derived.length - 1].framenum / ASSUMED_FPS,
        hasEnd: derived.some((k) => k.type === 'end'),
        keyed: false,
    };
}

async function keyframesOf(ids, transaction) {
    const rows = await db.sequelize.query(
        'SELECT keyframe_id, observation_id, type, framenum FROM keyframes WHERE observation_id IN (:ids) ORDER BY framenum, keyframe_id',
        { replacements: { ids }, type: QueryTypes.SELECT, transaction }
    );
    const byObservation = new Map(ids.map((id) => [id, []]));
    for (const row of rows) byObservation.get(row.observation_id).push(row);
    return byObservation;
}

/**
 * The neighbours a stretch absorbs when it is given a new span (A4): those of the same
 * substrate the new span overlaps and the old one did not, and any the grown span then
 * reaches in turn.
 *
 * @param {{start: number, end: number}} before - The stretch's span before.
 * @param {{start: number, end: number}} after - The span asked for.
 * @param {Array<{id: number, start: number, end: number}>} neighbours
 * @returns {{span: {start: number, end: number}, absorbed: Array<number>}}
 */
function absorbing(before, after, neighbours) {
    const overlaps = (a, b) => a.start < b.end && a.end > b.start;
    // Already overlapping before the drag: not something the drag reached.
    const candidates = neighbours.filter((n) => !overlaps(n, before));
    const span = { ...after };
    const absorbed = [];
    let grew = true;
    while (grew) {
        grew = false;
        for (const n of candidates) {
            if (absorbed.includes(n.id) || !overlaps(n, span)) continue;
            absorbed.push(n.id);
            span.start = Math.min(span.start, n.start);
            span.end = Math.max(span.end, n.end);
            grew = true;
        }
    }
    return { span, absorbed: absorbed.sort((a, b) => a - b) };
}

/**
 * Give a habitat stretch a new start and end (R5), merging any neighbour of the same
 * substrate it is dragged into (A4).
 *
 * @async
 * @param {number} observationId - The stretch.
 * @param {Object} body - `{ start_s, end_s, version }`: the new span in seconds of the video,
 *   and the version the page read, so a stretch that changed since is refused.
 * @returns {Promise<Object>} `{ observation_id, start_s, end_s, version, merged }`: where it
 *   now is, as the page reads it, and the ids of the neighbours merged into it.
 * @throws {ApiError} 400 for a malformed request or a stretch that cannot be retimed, 404 for
 *   one that does not exist, 409 for one that changed since the page read it.
 */
async function setStretchTimes(observationId, body = {}) {
    if (!Number.isInteger(observationId)) throw invalid('observation_id must be an integer.');
    const { start_s: start, end_s: end, version } = body;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw invalid('start_s and end_s must be seconds into the video, with start_s before end_s.');
    }
    if (!Number.isInteger(version)) throw invalid('version must be the version the page read.');

    return db.sequelize.transaction(async (transaction) => {
        const [row] = await db.sequelize.query(
            `SELECT ${STRETCH_COLUMNS}, s.type AS session_type
               FROM observations o LEFT JOIN sessions s ON s.session_id = o.session_id
              WHERE o.observation_id = :observationId FOR UPDATE OF o`,
            { replacements: { observationId }, type: QueryTypes.SELECT, transaction }
        );
        if (!row) throw notFound(`Observation ${observationId} does not exist.`);
        if (row.session_type !== HABITAT_SESSION_TYPE) {
            throw invalid(`Observation ${observationId} is not a habitat stretch.`);
        }
        if (row.version !== version) {
            throw new ApiError(409, ERROR_CODES.CONFLICT,
                `Observation ${observationId} changed since the page read it. Open it again and drag again.`);
        }

        // Its neighbours of the same substrate in the same session and video, locked in id
        // order beside it, so two drags meeting cannot deadlock or merge one stretch twice.
        const neighbours = await db.sequelize.query(
            `SELECT ${STRETCH_COLUMNS} FROM observations o
              WHERE o.session_id = :session AND o.species_id = :species AND o.video_source = :video
                AND o.observation_id <> :observationId
              ORDER BY o.observation_id FOR UPDATE OF o`,
            {
                replacements: { session: row.session_id, species: row.species_id, video: row.video_source, observationId },
                type: QueryTypes.SELECT, transaction,
            }
        );
        const keyframes = await keyframesOf([observationId, ...neighbours.map((n) => n.observation_id)], transaction);
        // A model's rows count at the video's rate, an annotator's at 25; the video is one.
        const rates = new Map();
        const rateFor = async (r) => {
            const machine = r.gpu_job_id != null;
            if (!rates.has(machine)) rates.set(machine, await rateOf(r));
            return rates.get(machine);
        };
        const rate = await rateFor(row);
        const before = spanOf(row, keyframes.get(observationId), rate);
        if (!before || !before.hasEnd) {
            throw invalid(`Observation ${observationId} has no end yet, so its times cannot be dragged.`);
        }
        const spans = [];
        for (const n of neighbours) {
            const span = spanOf(n, keyframes.get(n.observation_id), await rateFor(n));
            if (span) spans.push({ id: n.observation_id, start: span.start, end: span.end });
        }
        const { span, absorbed } = absorbing(before, { start, end }, spans);

        const { columns, startFrame, endFrame } = retimedColumns(row, {
            startMs: Math.round(span.start * 1000), endMs: Math.round(span.end * 1000),
            keyed: before.keyed, fps: before.keyed ? rate : ASSUMED_FPS,
        });
        const names = Object.keys(columns);
        await db.sequelize.query(
            `UPDATE observations SET ${names.map((name) => `"${name}" = :${name}`).join(', ')}, "updatedAt" = NOW()
              WHERE observation_id = :observationId`,
            { replacements: { ...columns, observationId }, transaction }
        );

        // A model's stretch carries its span in its keyframes too.
        if (before.keyed) {
            const own = keyframes.get(observationId);
            const middles = own.filter((k) => k.type !== 'start' && k.type !== 'end');
            if (middles.some((k) => Number(k.framenum) <= startFrame || Number(k.framenum) >= endFrame)) {
                throw invalid(`Observation ${observationId} has boxes between its start and end that the new span would leave outside it.`);
            }
            for (const [type, framenum] of [['start', startFrame], ['end', endFrame]]) {
                await db.sequelize.query(
                    `UPDATE keyframes SET framenum = :framenum, "updatedAt" = NOW()
                      WHERE observation_id = :observationId AND type = :type`,
                    { replacements: { framenum, observationId, type }, transaction }
                );
            }
        }

        // The neighbours dragged into go, as the Mosaic's merge removes one: with their
        // keyframes, picture row and reviews, by cascade.
        if (absorbed.length) {
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:absorbed)', {
                replacements: { absorbed }, transaction,
            });
        }

        const [after] = await db.sequelize.query(
            `SELECT ${STRETCH_COLUMNS} FROM observations o WHERE o.observation_id = :observationId`,
            { replacements: { observationId }, type: QueryTypes.SELECT, transaction }
        );
        const now = spanOf(after, (await keyframesOf([observationId], transaction)).get(observationId), rate);
        return {
            observation_id: observationId,
            start_s: now.start,
            end_s: now.end,
            version: after.version,
            merged: absorbed,
        };
    });
}

/**
 * What a cut leaves of a stretch (#360): the parts of `target` outside `by`.
 *
 * @param {{start: number, end: number}} target - The stretch being cut.
 * @param {{start: number, end: number}} by - The stretch it is cut with.
 * @returns {?{keep: ?{start: number, end: number}, split: ?{start: number, end: number}}} What it
 *   keeps and, when the cutter is in its middle, the piece after it; null when they do not
 *   overlap, and `keep` null when the cutter covers it all.
 */
function cutSpans(target, by) {
    if (by.end <= target.start || by.start >= target.end) return null;
    const before = by.start > target.start ? { start: target.start, end: by.start } : null;
    const after = by.end < target.end ? { start: by.end, end: target.end } : null;
    if (before && after) return { keep: before, split: after };
    return { keep: before || after, split: null };
}

/* Every column an observation has, for copying one whole: an annotator's row may carry
   columns the ingest never writes, and a split-off piece must not silently lose them. */
async function observationColumns(transaction) {
    const rows = await db.sequelize.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'observations'`,
        { type: QueryTypes.SELECT, transaction }
    );
    return rows.map((row) => row.column_name);
}

/* A stretch given a span: its time columns, and a model's start and end keyframes. */
async function applySpan(row, { keyed, rate }, span, transaction) {
    const { columns, startFrame, endFrame } = retimedColumns(row, {
        startMs: Math.round(span.start * 1000), endMs: Math.round(span.end * 1000),
        keyed, fps: keyed ? rate : ASSUMED_FPS,
    });
    const names = Object.keys(columns);
    await db.sequelize.query(
        `UPDATE observations SET ${names.map((name) => `"${name}" = :${name}`).join(', ')}, "updatedAt" = NOW()
          WHERE observation_id = :id`,
        { replacements: { ...columns, id: row.observation_id }, transaction }
    );
    if (keyed) {
        for (const [type, framenum] of [['start', startFrame], ['end', endFrame]]) {
            await db.sequelize.query(
                'UPDATE keyframes SET framenum = :framenum, "updatedAt" = NOW() WHERE observation_id = :id AND type = :type',
                { replacements: { framenum, id: row.observation_id, type }, transaction }
            );
        }
    }
}

/* The piece of a split stretch after its cutter: the same stretch in every other column, with
   its own keys, its own start and end keyframes when the stretch has them, and its review. */
async function splitOff(target, kind, span, transaction) {
    await keys.lockObservationKeys(transaction);
    const obsID = await keys.nextKey(
        'SELECT COALESCE(MAX("obsID"), 0)::int AS m FROM observations WHERE session_id = :sessionId',
        { sessionId: target.session_id }, transaction
    );
    const PobsID = await keys.nextKey(
        `SELECT COALESCE(MAX(o."PobsID"), 0)::int AS m
           FROM observations o JOIN sessions s ON s.session_id = o.session_id
          WHERE o.project_id = :projectId AND s.type = :type`,
        { projectId: target.project_id, type: target.session_type }, transaction
    );
    const splitId = await keys.nextObservationId(transaction);
    const skip = new Set(['observation_id', 'obsID', 'PobsID', 'version', 'createdAt', 'updatedAt']);
    const list = (await observationColumns(transaction)).filter((name) => !skip.has(name))
        .map((name) => `"${name}"`).join(', ');
    await db.sequelize.query(
        `INSERT INTO observations (observation_id, "obsID", "PobsID", ${list}, "createdAt", "updatedAt")
         SELECT :splitId, :obsID, :PobsID, ${list}, NOW(), NOW() FROM observations WHERE observation_id = :targetId`,
        { replacements: { splitId, obsID, PobsID, targetId: target.observation_id }, transaction }
    );
    if (kind.keyed) {
        await db.sequelize.query(
            `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, confidence, "createdAt", "updatedAt")
             SELECT :splitId, k.subset, k.comname, k.type, k.framenum, k.x, k.y, k.width, k.height, k.confidence, NOW(), NOW()
               FROM keyframes k WHERE k.observation_id = :targetId AND k.type IN ('start', 'end')`,
            { replacements: { splitId, targetId: target.observation_id }, transaction }
        );
    }
    // The original's times as read before the cut, moved onto the piece's span.
    await applySpan({ ...target, observation_id: splitId }, kind, span, transaction);
    // Its review as it stood (A3): a copy of each current decision, as a row of its own.
    const [{ version }] = await db.sequelize.query(
        'SELECT version FROM observations WHERE observation_id = :splitId',
        { replacements: { splitId }, type: QueryTypes.SELECT, transaction }
    );
    await db.sequelize.query(
        `WITH copied AS (
             INSERT INTO observation_reviews (observation_id, purpose, decision, reason, note, reviewer_id,
                    observation_version, reviewed_keyframe_count, reviewed_keyframe_max_updated_at,
                    representative_keyframe_id, decided_at, created_at, updated_at)
             SELECT :splitId, r.purpose, r.decision, r.reason, r.note, r.reviewer_id,
                    :version, r.reviewed_keyframe_count, r.reviewed_keyframe_max_updated_at,
                    NULL, r.decided_at, NOW(), NOW()
               FROM observation_review_current c JOIN observation_reviews r ON r.review_id = c.review_id
              WHERE c.observation_id = :targetId
          RETURNING review_id, observation_id, purpose, decision, reason, note, reviewer_id, decided_at, observation_version)
         INSERT INTO observation_review_current (observation_id, purpose, review_id, decision, reason, note,
                reviewer_id, decided_at, observation_version)
         SELECT observation_id, purpose, review_id, decision, reason, note, reviewer_id, decided_at, observation_version
           FROM copied`,
        { replacements: { splitId, version, targetId: target.observation_id }, transaction }
    );
    return splitId;
}

/**
 * Cut one habitat stretch with another (#360): `targetId` no longer covers the time `by` does.
 *
 * Settled with Isaac on 2026-11-20: the model marks Rock for a whole section, the analyst finds
 * part of it is off bottom and annotates that, and cuts the Rock with it. A cutter at one end
 * trims it; **one in its middle splits it in two** -- it keeps the part before, and a new stretch
 * of the same substrate, every other column copied and a new obs ID, takes the part after.
 * **Both keep its review**, as a drag does (A3). A cutter covering all of it is refused: that is
 * deleting it.
 *
 * @async
 * @param {number} targetId - The stretch being cut.
 * @param {Object} body - `{ by_observation_id, version }`: the cutter, and the version of the
 *   stretch being cut that the page read.
 * @returns {Promise<Object>} `{ observation_id, start_s, end_s, version, split_observation_id }`.
 * @throws {ApiError} 400, 404, or 409 for a stretch that changed since it was read.
 */
async function cutStretch(targetId, body = {}) {
    const byId = body.by_observation_id;
    if (!Number.isInteger(targetId) || !Number.isInteger(byId)) {
        throw invalid('observation_id and by_observation_id must be integers.');
    }
    if (byId === targetId) throw invalid('A stretch cannot be cut with itself.');
    if (!Number.isInteger(body.version)) throw invalid('version must be the version the page read.');

    const result = await db.sequelize.transaction(async (transaction) => {
        // Both locked, in id order, as the merge locks its pair.
        const pair = await db.sequelize.query(
            `SELECT ${STRETCH_COLUMNS}, o.project_id, o.comname, s.type AS session_type
               FROM observations o LEFT JOIN sessions s ON s.session_id = o.session_id
              WHERE o.observation_id IN (:ids) ORDER BY o.observation_id FOR UPDATE OF o`,
            { replacements: { ids: [targetId, byId] }, type: QueryTypes.SELECT, transaction }
        );
        const target = pair.find((row) => row.observation_id === targetId);
        const by = pair.find((row) => row.observation_id === byId);
        if (!target) throw notFound(`Observation ${targetId} does not exist.`);
        if (!by) throw notFound(`Observation ${byId} does not exist.`);
        if (target.session_type !== HABITAT_SESSION_TYPE || by.session_type !== HABITAT_SESSION_TYPE) {
            throw invalid('Only habitat stretches are cut.');
        }
        if (target.video_source !== by.video_source) throw invalid('Only stretches in the same video are cut.');
        if (target.version !== body.version) {
            throw new ApiError(409, ERROR_CODES.CONFLICT,
                `Observation ${targetId} changed since the page read it. Open it again and cut again.`);
        }

        const keyframes = await keyframesOf([targetId, byId], transaction);
        const rate = await rateOf(target);
        const targetSpan = spanOf(target, keyframes.get(targetId), rate);
        const bySpan = spanOf(by, keyframes.get(byId), await rateOf(by));
        if (!targetSpan || !targetSpan.hasEnd || !bySpan || !bySpan.hasEnd) {
            throw invalid('Both stretches need an end before one can cut the other.');
        }
        const name = (row, fallback) => row.comname || fallback;
        const cut = cutSpans(targetSpan, bySpan);
        if (!cut) throw invalid(`${name(by, 'That stretch')} does not overlap ${name(target, 'this one')}, so there is nothing to cut.`);
        if (!cut.keep) throw invalid(`${name(by, 'That stretch')} covers all of ${name(target, 'this one')}; delete it instead.`);

        const kind = { keyed: targetSpan.keyed, rate };
        const splitId = cut.split ? await splitOff(target, kind, cut.split, transaction) : null;
        await applySpan(target, kind, cut.keep, transaction);

        const [after] = await db.sequelize.query(
            `SELECT ${STRETCH_COLUMNS} FROM observations o WHERE o.observation_id = :targetId`,
            { replacements: { targetId }, type: QueryTypes.SELECT, transaction }
        );
        const now = spanOf(after, (await keyframesOf([targetId], transaction)).get(targetId), rate);
        return { observation_id: targetId, start_s: now.start, end_s: now.end, version: after.version, split_observation_id: splitId };
    });

    // The new piece gets a Mosaic picture of its own.
    if (result.split_observation_id) await thumbnails.requestRefresh(result.split_observation_id);
    return result;
}

module.exports = { setStretchTimes, cutStretch, cutSpans, absorbing, spanOf };
