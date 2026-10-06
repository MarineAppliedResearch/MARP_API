/**
 * Box edits from the Mosaic's video page (#181): the annotation GUI's controls, in a browser.
 *
 * Isaac, 2026-10-05: the GUI's box controls, saved as they are made, the last save winning,
 * for a user holding `keyframes:write`, and the observation's thumbnail extracted again
 * afterwards. What each does, and where it follows the GUI (`AnnotationRectangle.xaml.cs`):
 *
 * - **Move or resize** a keyframe's box: its box changes; its frame and type do not.
 * - **Add** a keyframe -- the GUI's drag of an in-between box, or its double-click "pin" --
 *   as a `middle` at the moment the reviewer is on.
 * - **Set as end**: that keyframe becomes the end; the one that was becomes a middle. Not the
 *   start: the GUI allows it and leaves the observation with no start, which Isaac ruled out.
 * - **Delete** a keyframe. Deleting the start promotes the earliest remaining to start, as the
 *   GUI does; deleting the end promotes the latest remaining to end, so an observation keeps
 *   one start and one end (Isaac: "an observation is made of at least 1 start, 1 end"). The
 *   last keyframe of a track is not deleted this way: that is deleting the observation.
 *
 * **Times arrive in seconds and are turned into frame numbers here**, by the rule the reads
 * use (`mosaic-video-context.service.js`): an annotation-GUI row counts at 25, a GPU row at
 * the video's nominal rate. The page never sees a frame number.
 *
 * @fileoverview Keyframe edits for the Mosaic video page.
 * @module service/mosaic-video-edit
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const thumbnails = require('../repository/observation-thumbnail.repository');
const { resolveVideo } = require('./mosaic-video-context.service');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { ASSUMED_FPS } = require('../db/timecode');

const KEYFRAME_COLUMNS = 'keyframe_id, observation_id, subset, type, framenum, x, y, width, height';

function invalid(message) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message);
}

function notFound(message) {
    return new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, message);
}

/**
 * A box, checked: four finite numbers, a positive size. Boxes may run a little off the
 * picture -- recorded ones do, from -0.01 to 1.03 -- so only the absurd is refused.
 *
 * @param {Object} body - `{ x, y, width, height }`.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function boxOf(body = {}) {
    const box = {};
    for (const key of ['x', 'y', 'width', 'height']) {
        const value = body[key];
        if (!Number.isFinite(value) || value < -1 || value > 2) {
            throw invalid(`${key} must be a number near 0..1 of the picture.`);
        }
        box[key] = value;
    }
    if (box.width <= 0 || box.height <= 0) {
        throw invalid('width and height must be more than 0.');
    }
    return box;
}

/**
 * The rate an observation's frame numbers count at: 25 for a GUI row, the video's nominal
 * rate for a GPU row.
 *
 * @async
 * @param {Object} observation - `{ gpu_job_id, video_source }`.
 * @returns {Promise<number>}
 */
async function rateOf(observation) {
    if (observation.gpu_job_id == null) return ASSUMED_FPS;
    const video = observation.video_source ? await resolveVideo(observation.video_source) : null;
    return (video && video.frameRate) || ASSUMED_FPS;
}

/**
 * A keyframe as the page has it: seconds, not a frame number.
 *
 * @param {Object} row - A keyframes row.
 * @param {number} rate - Its observation's rate.
 * @returns {Object}
 */
function asSeconds(row, rate) {
    return {
        keyframe_id: row.keyframe_id,
        observation_id: row.observation_id,
        subset: row.subset,
        type: row.type,
        t: Math.round((Number(row.framenum) / rate) * 1e4) / 1e4,
        x: Number(row.x),
        y: Number(row.y),
        width: Number(row.width),
        height: Number(row.height),
    };
}

/**
 * One keyframe and its observation, locked for the edit.
 *
 * @async
 * @param {number} keyframeId
 * @param {Object} transaction
 * @returns {Promise<{keyframe: Object, observation: Object}>}
 */
async function keyframeForEdit(keyframeId, transaction) {
    if (!Number.isInteger(keyframeId)) {
        throw invalid('keyframe_id must be an integer.');
    }
    const [keyframe] = await db.sequelize.query(
        `SELECT ${KEYFRAME_COLUMNS} FROM keyframes WHERE keyframe_id = :keyframeId FOR UPDATE`,
        { replacements: { keyframeId }, type: QueryTypes.SELECT, transaction }
    );
    if (!keyframe) {
        throw notFound(`Keyframe ${keyframeId} does not exist.`);
    }
    const [observation] = await db.sequelize.query(
        'SELECT observation_id, gpu_job_id, video_source, comname FROM observations WHERE observation_id = :id',
        { replacements: { id: keyframe.observation_id }, type: QueryTypes.SELECT, transaction }
    );
    return { keyframe, observation };
}

/**
 * The keyframes of one track -- an observation's subset -- in frame order.
 *
 * @async
 */
function trackOf(observationId, subset, transaction) {
    return db.sequelize.query(
        `SELECT ${KEYFRAME_COLUMNS} FROM keyframes
          WHERE observation_id = :observationId AND subset = :subset
          ORDER BY framenum, keyframe_id`,
        { replacements: { observationId, subset }, type: QueryTypes.SELECT, transaction }
    );
}

async function setType(keyframeId, type, transaction) {
    const [rows] = await db.sequelize.query(
        `UPDATE keyframes SET type = :type, "updatedAt" = NOW() WHERE keyframe_id = :keyframeId
         RETURNING ${KEYFRAME_COLUMNS}`,
        { replacements: { keyframeId, type }, transaction }
    );
    return rows[0];
}

/**
 * Runs one edit in a transaction, then asks for the observation's thumbnail again: the tile
 * shows the box, and a crop of the old one would be the old answer.
 *
 * @async
 */
async function edit(work, { refresh = true } = {}) {
    const result = await db.sequelize.transaction(work);
    // Not when the caller cuts the picture itself (#181 R6): a queued refresh would be
    // claimed by the extractor and cut the automatic picture over the chosen one.
    if (refresh) await thumbnails.requestRefresh(result.observation_id);
    return result;
}

/** Move or resize a keyframe's box. Its frame and type stay. */
function moveBox(keyframeId, body) {
    const box = boxOf(body);
    return edit(async (transaction) => {
        const { observation } = await keyframeForEdit(keyframeId, transaction);
        const [rows] = await db.sequelize.query(
            `UPDATE keyframes SET x = :x, y = :y, width = :width, height = :height, "updatedAt" = NOW()
              WHERE keyframe_id = :keyframeId RETURNING ${KEYFRAME_COLUMNS}`,
            { replacements: { keyframeId, ...box }, transaction }
        );
        const rate = await rateOf(observation);
        return { observation_id: observation.observation_id, changed: [asSeconds(rows[0], rate)], deleted: [] };
    });
}

/** Add a keyframe at `t` on an observation's track: a pinned or dragged in-between box, or one
    drawn before its start or after its end, which extends it (R2). */
function addKeyframe(body = {}, { refresh = true } = {}) {
    const box = boxOf(body);
    const observationId = body.observation_id;
    const subset = body.subset == null ? '1' : String(body.subset);
    if (!Number.isInteger(observationId)) throw invalid('observation_id must be an integer.');
    if (!Number.isFinite(body.t) || body.t < 0) throw invalid('t must be a time in seconds.');

    return edit(async (transaction) => {
        const [observation] = await db.sequelize.query(
            'SELECT observation_id, gpu_job_id, video_source, comname FROM observations WHERE observation_id = :id FOR UPDATE',
            { replacements: { id: observationId }, type: QueryTypes.SELECT, transaction }
        );
        if (!observation) throw notFound(`Observation ${observationId} does not exist.`);
        const rate = await rateOf(observation);
        const framenum = Math.round(body.t * rate);
        const track = await trackOf(observationId, subset, transaction);
        if (track.length === 0) throw invalid(`Observation ${observationId} has no track ${subset} to add to.`);

        // On a keyframe already: that one is moved instead, as the GUI does.
        const existing = track.find((row) => Number(row.framenum) === framenum);
        if (existing) {
            const [rows] = await db.sequelize.query(
                `UPDATE keyframes SET x = :x, y = :y, width = :width, height = :height, "updatedAt" = NOW()
                  WHERE keyframe_id = :id RETURNING ${KEYFRAME_COLUMNS}`,
                { replacements: { id: existing.keyframe_id, ...box }, transaction }
            );
            return { observation_id: observationId, changed: [asSeconds(rows[0], rate)], deleted: [] };
        }
        // Before the start, the box is the new start; after an end, the new end -- the one it
        // replaces becomes a middle, so the track keeps one of each. After the last keyframe of
        // a track with no end yet it is a middle, as the GUI's "Add To Obs" does (R2).
        const first = Number(track[0].framenum);
        const last = Number(track[track.length - 1].framenum);
        let type = 'middle';
        let replaced = null;
        if (framenum < first) {
            type = 'start';
            replaced = 'start';
        } else if (framenum > last && track.some((row) => row.type === 'end')) {
            type = 'end';
            replaced = 'end';
        }
        const changed = [];
        for (const row of track.filter((k) => replaced && k.type === replaced)) {
            changed.push(asSeconds(await setType(row.keyframe_id, 'middle', transaction), rate));
        }
        const [rows] = await db.sequelize.query(
            `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, "createdAt", "updatedAt")
             VALUES (:observationId, :subset, :comname, :type, :framenum, :x, :y, :width, :height, NOW(), NOW())
             RETURNING ${KEYFRAME_COLUMNS}`,
            { replacements: { observationId, subset, comname: observation.comname || '', type, framenum, ...box }, transaction }
        );
        changed.push(asSeconds(rows[0], rate));
        return { observation_id: observationId, changed, deleted: [] };
    }, { refresh });
}

/** Make a keyframe its track's end; the one that was becomes a middle. */
function setEnd(keyframeId) {
    return edit(async (transaction) => {
        const { keyframe, observation } = await keyframeForEdit(keyframeId, transaction);
        // The start made the end would leave the track without a start (Isaac, 2026-10-05).
        if (keyframe.type === 'start') {
            throw invalid('The start keyframe cannot be made the end: the observation would have no start.');
        }
        const rate = await rateOf(observation);
        const changed = [];
        for (const row of await trackOf(keyframe.observation_id, keyframe.subset, transaction)) {
            if (row.type === 'end' && row.keyframe_id !== keyframeId) {
                changed.push(asSeconds(await setType(row.keyframe_id, 'middle', transaction), rate));
            }
        }
        changed.push(asSeconds(await setType(keyframeId, 'end', transaction), rate));
        return { observation_id: observation.observation_id, changed, deleted: [] };
    });
}

/** Delete a keyframe, keeping the track's start and end. */
function deleteKeyframe(keyframeId) {
    return edit(async (transaction) => {
        const { keyframe, observation } = await keyframeForEdit(keyframeId, transaction);
        const rate = await rateOf(observation);
        const track = await trackOf(keyframe.observation_id, keyframe.subset, transaction);
        if (track.length <= 1) {
            throw invalid('This is the track\'s only keyframe. Delete the observation instead.');
        }
        await db.sequelize.query('DELETE FROM keyframes WHERE keyframe_id = :keyframeId', {
            replacements: { keyframeId }, transaction,
        });
        const rest = track.filter((row) => row.keyframe_id !== keyframeId);
        const changed = [];
        if (keyframe.type === 'start' && !rest.some((row) => row.type === 'start')) {
            changed.push(asSeconds(await setType(rest[0].keyframe_id, 'start', transaction), rate));
        }
        if (keyframe.type === 'end' && !rest.some((row) => row.type === 'end')) {
            changed.push(asSeconds(await setType(rest[rest.length - 1].keyframe_id, 'end', transaction), rate));
        }
        return { observation_id: observation.observation_id, changed, deleted: [keyframeId] };
    });
}

module.exports = {
    moveBox, addKeyframe, setEnd, deleteKeyframe,
    // Shared with the annotation service, which counts frames and checks boxes the same way.
    boxOf, rateOf, asSeconds, invalid, notFound, KEYFRAME_COLUMNS
};
