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

module.exports = { setStretchTimes, absorbing, spanOf };
