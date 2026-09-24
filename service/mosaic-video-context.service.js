/**
 * What the Mosaic's source-video inspector needs to show a page's observations (#181).
 *
 * The Mosaic row carries no video: no Jellyfin item, no position, and a keyframe count
 * rather than keyframes. This answers all three for a page's worth of observations in one
 * request, grouped by video, so opening a tile is a seek in a player that already has what
 * it needs rather than a round trip per box.
 *
 * **Every time is in seconds, decided here**, because what a frame number means depends on
 * who wrote the row. A frame number is playback time times a rate (#231): the annotation
 * GUI's rate is an assumed 25 (VIDEO_PROCESSING_GUI#221), so its `framenum / 25` is the
 * millisecond it recorded, on any video; a GPU row's rate is the video's nominal rate. The
 * page should not have to know that.
 *
 * **The video is resolved from `video_source`**, as the thumbnail pass resolves it, and a
 * match below the same score is reported unresolved rather than guessed at: a player open
 * on the wrong dive looks like a bad detection, not like a bug.
 *
 * @fileoverview Video, moment and keyframes for a set of Mosaic observations.
 * @author Isaac Travers
 * @module service/mosaic-video-context
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { MIN_MATCH_SCORE } = require('../config/thumbnails');
const { ASSUMED_FPS, parseTimeSpan } = require('../db/timecode');

/** How many observations one request may name: a page, with room to spare. */
const MAX_OBSERVATIONS = 1000;

/** How long a resolved video is kept, so reopening a page costs no Jellyfin search. */
const RESOLUTION_TTL_MS = 10 * 60 * 1000;

/** Who the media server sees asking, in its session list. */
const CLIENT_IDENTITY = { client: 'MARP API', device: 'Mosaic video inspector' };

/** `video_source` to `{ at, promise }`, so concurrent pages share one search. */
const resolutions = new Map();

/**
 * Resolve one `video_source` to a Jellyfin item and its nominal rate, or say why not.
 *
 * @async
 * @param {string} videoSource - The filename an observation records.
 * @returns {Promise<Object>} `{ itemId, frameRate }` or `{ itemId: null, reason }`.
 */
function resolveVideo(videoSource) {
    const cached = resolutions.get(videoSource);

    if (cached && Date.now() - cached.at < RESOLUTION_TTL_MS) {
        return cached.promise;
    }

    const promise = (async () => {
        let resolved;

        try {
            resolved = await jellyfinRepository.resolveVideoSource(videoSource, 1, CLIENT_IDENTITY);
        } catch (error) {
            return { itemId: null, reason: `No Jellyfin video matched ${JSON.stringify(videoSource)}.` };
        }

        if (!resolved || resolved.score < MIN_MATCH_SCORE) {
            return {
                itemId: null,
                reason: `The best Jellyfin match for ${JSON.stringify(videoSource)} scored `
                    + `${resolved ? resolved.score : 0}, below the ${MIN_MATCH_SCORE} a picture is trusted at.`,
            };
        }

        // The nominal rate, which turns a GPU row's frame number into its time.
        let frameRate = null;

        try {
            const rates = await jellyfinRepository.getVideoFrameRate(resolved.item.id, CLIENT_IDENTITY);
            frameRate = rates && rates.realFrameRate ? rates.realFrameRate : null;
        } catch (error) {
            frameRate = null;
        }

        return { itemId: resolved.item.id, frameRate };
    })();

    resolutions.set(videoSource, { at: Date.now(), promise });

    // A failure to reach Jellyfin is not remembered; the next page asks again.
    promise.then((result) => {
        if (!result.itemId && !/scored/.test(result.reason)) {
            resolutions.delete(videoSource);
        }
    });

    return promise;
}

/**
 * The observations named, with their keyframes, one row per keyframe.
 *
 * @async
 * @param {Array<number>} ids - Observation ids.
 * @returns {Promise<Array<Object>>} Rows ordered by observation, subset and frame.
 */
function readRows(ids) {
    return db.sequelize.query(
        `SELECT o.observation_id, o.comname, sp.comname AS species_comname, o.video_source,
                o."mediaPosition" AS media_position, o.gpu_job_id,
                k.framenum, k.subset, k.type, k.x, k.y, k.width, k.height
           FROM observations o
           LEFT JOIN species sp ON sp.id = o.species_id
           LEFT JOIN keyframes k ON k.observation_id = o.observation_id
          WHERE o.observation_id IN (:ids)
          ORDER BY o.observation_id, k.subset, k.framenum`,
        { replacements: { ids }, type: QueryTypes.SELECT }
    );
}

/**
 * The video context for a set of observations.
 *
 * @async
 * @param {Object} body - `{ observation_ids: number[] }`.
 * @returns {Promise<Object>} `{ jellyfin_server, videos: [...] }`.
 * @throws {ApiError} 400 for a request that does not name observations properly.
 */
async function videoContext(body) {
    const ids = body && body.observation_ids;

    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
        throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'observation_ids must be a non-empty array of integers.');
    }

    if (ids.length > MAX_OBSERVATIONS) {
        throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, `At most ${MAX_OBSERVATIONS} observations per request.`);
    }

    const rows = await readRows(ids);
    const byVideo = new Map();

    for (const row of rows) {
        const source = row.video_source || '';

        if (!byVideo.has(source)) {
            byVideo.set(source, new Map());
        }

        const observations = byVideo.get(source);

        if (!observations.has(row.observation_id)) {
            const ms = parseTimeSpan(row.media_position);

            observations.set(row.observation_id, {
                observation_id: row.observation_id,
                comname: row.species_comname || row.comname,
                machine: row.gpu_job_id != null,
                moment_s: ms === null ? null : ms / 1000,
                keyframes: [],
            });
        }

        if (row.framenum != null) {
            observations.get(row.observation_id).keyframes.push({
                framenum: Number(row.framenum),
                subset: row.subset,
                type: row.type,
                x: Number(row.x),
                y: Number(row.y),
                width: Number(row.width),
                height: Number(row.height),
            });
        }
    }

    const videos = [];

    for (const [source, observations] of byVideo) {
        const video = source ? await resolveVideo(source) : { itemId: null, reason: 'The observation records no video_source.' };
        const nominal = video.frameRate || ASSUMED_FPS;

        videos.push({
            video_source: source || null,
            jellyfin_item_id: video.itemId,
            unresolved_reason: video.itemId ? null : video.reason,
            frame_rate: video.itemId ? nominal : null,
            observations: [...observations.values()].map(({ machine, keyframes, ...observation }) => ({
                ...observation,
                // GUI rows count at 25, GPU rows at the video's nominal rate (#231).
                keyframes: keyframes.map(({ framenum, ...box }) => ({
                    ...box,
                    t: framenum / (machine ? nominal : ASSUMED_FPS),
                })),
            })),
        });
    }

    return { jellyfin_server: jellyfinRepository.baseUrl || null, videos };
}

module.exports = { videoContext, MAX_OBSERVATIONS };
