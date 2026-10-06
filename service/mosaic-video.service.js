/**
 * What the Mosaic's video page draws: every observation in one video that the Mosaic's query
 * matches, and their keyframes a time window at a time (#181).
 *
 * Two reads, because of size. The busiest video holds 2,798 observations and 47,736
 * keyframes -- about 4 MB, too much to load at once on a phone. So the page loads the
 * observations once, each with the span its keyframes cover, which tells it which are on
 * screen when; and asks for keyframes around the playhead as it moves. Isaac, 2026-10-05
 * (A9).
 *
 * **Every time is in seconds, decided here**, by the rule `mosaic-video-context.service.js`
 * states: a GUI row's frame number counts at an assumed 25, a GPU row's at the video's nominal
 * rate (#231). The page never sees a frame number.
 *
 * @fileoverview The Mosaic video page's observations and windowed keyframes.
 * @module service/mosaic-video
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');
const mosaicRepository = require('../repository/mosaic.repository');
const { resolveVideo } = require('./mosaic-video-context.service');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { ASSUMED_FPS, parseTimeSpan } = require('../db/timecode');
const { PROXY_PATH } = require('../middleware/jellyfin-proxy.middleware');

/** Observations one video's answer may hold: three times the busiest video today. */
const MAX_VIDEO_OBSERVATIONS = 10000;

/** Observations one window may name. */
const MAX_WINDOW_OBSERVATIONS = 2000;

/** The longest window, in seconds. */
const MAX_WINDOW_SECONDS = 600;

/**
 * A number to a fixed count of decimals.
 *
 * @param {number} value - The number.
 * @param {number} places - Decimals kept.
 * @returns {number}
 */
function round(value, places) {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

/**
 * A 400 for a request that cannot be answered as asked.
 *
 * @param {string} message - Why.
 * @returns {ApiError}
 */
function invalid(message) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message);
}

/**
 * The video an observation is in, resolved, and its rate.
 *
 * @async
 * @param {string|null} source - `video_source`.
 * @returns {Promise<Object>} `{ video, nominal }`.
 */
async function videoOf(source) {
    const resolved = source ? await resolveVideo(source) : { itemId: null, reason: 'The observation records no video_source.' };
    const nominal = resolved.frameRate || ASSUMED_FPS;
    return {
        nominal,
        video: {
            video_source: source || null,
            jellyfin_item_id: resolved.itemId,
            unresolved_reason: resolved.itemId ? null : resolved.reason,
            frame_rate: resolved.itemId ? nominal : null,
        },
    };
}

/**
 * Every observation in the opened observation's video that the Mosaic's query matches.
 *
 * @async
 * @param {Object} body - `{ observation_id, filters }`.
 * @returns {Promise<Object>} `{ jellyfin_server, video, opened, observations, truncated }`.
 * @throws {ApiError} 400 for a malformed request, 404 for an observation that does not exist.
 */
async function videoObservations(body = {}) {
    const id = body.observation_id;
    if (!Number.isInteger(id)) {
        throw invalid('observation_id must be an integer.');
    }
    const filters = body.filters == null ? {} : body.filters;
    if (typeof filters !== 'object' || Array.isArray(filters)) {
        throw invalid('filters must be the Mosaic\'s filters object.');
    }

    const [opened] = await db.sequelize.query(
        'SELECT observation_id, video_source, session_id, "mediaPosition" AS media_position FROM observations WHERE observation_id = :id',
        { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!opened) {
        throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Observation ${id} does not exist.`);
    }

    const ms = parseTimeSpan(opened.media_position);
    const { video, nominal } = await videoOf(opened.video_source);
    const answer = {
        jellyfin_server: jellyfinRepository.baseUrl ? PROXY_PATH : null,
        video,
        opened: { observation_id: id, session_id: opened.session_id, moment_s: ms === null ? null : ms / 1000 },
        observations: [],
        truncated: false,
    };
    if (!opened.video_source) {
        return answer;
    }

    let rows;
    try {
        const { sql, bind } = mosaicRepository.buildVideoObservationsQuery({
            filters, videoSource: opened.video_source, include: id, limit: MAX_VIDEO_OBSERVATIONS,
        });
        rows = await db.sequelize.query(sql, { bind, type: QueryTypes.SELECT });
    } catch (error) {
        if (error instanceof mosaicRepository.MosaicRequestError) {
            throw invalid(error.message);
        }
        throw error;
    }

    answer.truncated = rows.length > MAX_VIDEO_OBSERVATIONS;
    // GUI rows count at 25, GPU rows at the video's nominal rate (#231).
    answer.sessions = opened.video_source ? await sessionsInVideo(opened.video_source) : [];
    answer.observations = rows.slice(0, MAX_VIDEO_OBSERVATIONS).map((row) => {
        const rate = row.machine ? nominal : ASSUMED_FPS;
        return {
            observation_id: row.observation_id,
            species_id: row.species_id,
            comname: row.comname,
            obs_id: row.obs_id,
            version: row.version,
            start_s: Number(row.first_framenum) / rate,
            end_s: Number(row.last_framenum) / rate,
        };
    });
    return answer;
}

/**
 * The keyframes of the named observations within a time window, plus each track's nearest
 * keyframe either side of it, so a box crossing the window's edge interpolates across it.
 *
 * @async
 * @param {Object} body - `{ observation_ids, from_s, to_s }`.
 * @returns {Promise<Object>} `{ frame_rate, keyframes }`, ascending by observation, subset, time.
 * @throws {ApiError} 400 for a malformed request, or observations from more than one video.
 */
async function videoKeyframes(body = {}) {
    const ids = body.observation_ids;
    const from = body.from_s;
    const to = body.to_s;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((value) => !Number.isInteger(value))) {
        throw invalid('observation_ids must be a non-empty array of integers.');
    }
    if (ids.length > MAX_WINDOW_OBSERVATIONS) {
        throw invalid(`At most ${MAX_WINDOW_OBSERVATIONS} observations per window.`);
    }
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        throw invalid('from_s and to_s must be numbers with from_s at or before to_s.');
    }
    if (to - from > MAX_WINDOW_SECONDS) {
        throw invalid(`A window is at most ${MAX_WINDOW_SECONDS} seconds.`);
    }

    const rows = await db.sequelize.query(
        'SELECT observation_id, video_source, (gpu_job_id IS NOT NULL) AS machine FROM observations WHERE observation_id IN (:ids)',
        { replacements: { ids }, type: QueryTypes.SELECT }
    );
    const sources = new Set(rows.map((row) => row.video_source));
    if (sources.size > 1) {
        throw invalid('A window is one video\'s: these observations are in more than one.');
    }
    if (rows.length === 0) {
        return { frame_rate: null, keyframes: [] };
    }

    const { nominal, video } = await videoOf([...sources][0]);
    const rateOf = new Map(rows.map((row) => [row.observation_id, row.machine ? nominal : ASSUMED_FPS]));

    // The window in each row's own frame numbers.
    const windowIds = [];
    const lows = [];
    const highs = [];
    for (const row of rows) {
        const rate = rateOf.get(row.observation_id);
        windowIds.push(row.observation_id);
        lows.push(Math.floor(from * rate));
        highs.push(Math.ceil(to * rate));
    }

    const keyframes = await db.sequelize.query(
        `WITH w(observation_id, lo, hi) AS (SELECT * FROM unnest($1::int[], $2::int[], $3::int[]))
         SELECT k.keyframe_id, k.observation_id, k.subset, k.type, k.framenum, k.x, k.y, k.width, k.height
           FROM keyframes k JOIN w USING (observation_id)
          WHERE k.framenum BETWEEN w.lo AND w.hi
         UNION
         SELECT * FROM (
             SELECT DISTINCT ON (k.observation_id, k.subset)
                    k.keyframe_id, k.observation_id, k.subset, k.type, k.framenum, k.x, k.y, k.width, k.height
               FROM keyframes k JOIN w USING (observation_id)
              WHERE k.framenum < w.lo
              ORDER BY k.observation_id, k.subset, k.framenum DESC) before_window
         UNION
         SELECT * FROM (
             SELECT DISTINCT ON (k.observation_id, k.subset)
                    k.keyframe_id, k.observation_id, k.subset, k.type, k.framenum, k.x, k.y, k.width, k.height
               FROM keyframes k JOIN w USING (observation_id)
              WHERE k.framenum > w.hi
              ORDER BY k.observation_id, k.subset, k.framenum ASC) after_window`,
        { bind: [windowIds, lows, highs], type: QueryTypes.SELECT }
    );

    return {
        frame_rate: video.frame_rate,
        keyframes: keyframes
            // Rounded: a 60-second window of the busiest video is 2,800 keyframes, and
            // a box to 0.0001 of the picture is a fifth of a pixel at 1080p, a time to
            // 0.1 ms is a four-hundredth of a frame.
            .map((row) => ({
                keyframe_id: row.keyframe_id,
                observation_id: row.observation_id,
                subset: row.subset,
                type: row.type,
                t: round(Number(row.framenum) / rateOf.get(row.observation_id), 4),
                x: round(Number(row.x), 4),
                y: round(Number(row.y), 4),
                width: round(Number(row.width), 4),
                height: round(Number(row.height), 4),
            }))
            .sort((a, b) => a.observation_id - b.observation_id
                || String(a.subset).localeCompare(String(b.subset))
                || a.t - b.t),
    };
}

/**
 * The sessions with observations in a video: the ones a new observation may join (#181 A8).
 *
 * @async
 * @param {string} videoSource
 * @param {Object} [transaction]
 * @returns {Promise<Array<Object>>} `{ session_id, project_id, dive, line, type, observations }`.
 */
function sessionsInVideo(videoSource, transaction) {
    return db.sequelize.query(
        `SELECT s.session_id, s.project_id, s.dive, s.line, s.type, count(*)::int AS observations
           FROM observations o JOIN sessions s ON s.session_id = o.session_id
          WHERE o.video_source = :videoSource
          GROUP BY s.session_id ORDER BY s.session_id`,
        { replacements: { videoSource }, type: QueryTypes.SELECT, transaction }
    );
}

module.exports = {
    sessionsInVideo,
    videoObservations,
    videoKeyframes,
    MAX_VIDEO_OBSERVATIONS,
    MAX_WINDOW_OBSERVATIONS,
    MAX_WINDOW_SECONDS,
};
