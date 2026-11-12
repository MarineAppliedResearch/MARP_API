/**
 * A habitat segment's picture: its middle frame with the habitat crop, cut when first asked
 * for and kept (#287, A21).
 *
 * Settled with Isaac on 2026-11-12. A segment is worked out when the Mosaic's query runs and
 * has no row, so it has no observation thumbnail; its picture is kept by the video, the
 * moment and the crop instead (`habitat_segment_pictures`). The cut is the observation
 * thumbnails' own: the video resolved and probed through the media server, one frame
 * decoded, the crop squared and padded by `cropToTile` -- so a segment's picture looks like a
 * habitat stretch's.
 *
 * - **Its own folder**, inside the thumbnails' storage. Files there are named for their bytes
 *   and removed when no observation thumbnail names them; a segment picture is named by none,
 *   so it is kept apart where that rule cannot reach it.
 * - **At most two cut at once**, and one cut per picture however many tiles ask for it: a page
 *   of segments asks for every picture together, and each cut is a stream opened on the media
 *   server.
 * - **A failure is kept and not tried again for a while** (`RETRY_AFTER_MS`), so a page of
 *   segments in a video the media server cannot find does not ask it again on every scroll.
 *
 * @fileoverview Cutting, keeping and finding habitat segment pictures.
 * @module service/habitat-segment-picture
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');
const extraction = require('./thumbnail-extraction.service');
const { HABITAT_BOX } = require('../db/habitat-keyframes');
const { STORAGE_DIR, MIN_MATCH_SCORE } = require('../config/thumbnails');

const { QueryTypes } = db.Sequelize;

/** Where segment pictures are kept: beside the observation thumbnails, apart from them. */
const SEGMENT_DIR = path.join(STORAGE_DIR, 'habitat-segments');

/** The habitat crop as it is recorded with each picture: x0,y0,x1,y1. */
const CROP = [
    HABITAT_BOX.x - HABITAT_BOX.width / 2, HABITAT_BOX.y - HABITAT_BOX.height / 2,
    HABITAT_BOX.x + HABITAT_BOX.width / 2, HABITAT_BOX.y + HABITAT_BOX.height / 2,
].join(',');

/** How long a failed cut is left before it is tried again. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/** How many pictures are cut at once. */
const MAX_CUTTING = 2;

/** Who the media server is told is asking, as the thumbnail extractor tells it. */
const MEDIA_CLIENT_IDENTITY = { client: 'MARP API', device: 'habitat-segment-picture' };

/** Cuts under way, by picture, so two tiles asking for one picture share one cut. */
const cutting = new Map();

/** Cuts waiting for a turn. */
const waiting = [];
let running = 0;

/**
 * Run `work` when fewer than `MAX_CUTTING` are running.
 *
 * @async
 * @param {Function} work
 * @returns {Promise<*>} What `work` returns.
 */
async function inTurn(work) {
    if (running >= MAX_CUTTING) await new Promise((resolve) => waiting.push(resolve));
    running += 1;
    try {
        return await work();
    } finally {
        running -= 1;
        const next = waiting.shift();
        if (next) next();
    }
}

/**
 * The picture's row, if there is one.
 *
 * @async
 * @param {string} videoSource
 * @param {number} mediaMs
 * @returns {Promise<?Object>}
 */
async function findPicture(videoSource, mediaMs) {
    const [row] = await db.sequelize.query(
        `SELECT status, filename, last_error, updated_at FROM habitat_segment_pictures
          WHERE video_source = :videoSource AND media_ms = :mediaMs AND crop = :crop`,
        { replacements: { videoSource, mediaMs, crop: CROP }, type: QueryTypes.SELECT }
    );
    return row || null;
}

/**
 * Record what a cut came to.
 *
 * @async
 * @param {string} videoSource
 * @param {number} mediaMs
 * @param {{filename?: string, error?: string}} outcome
 * @returns {Promise<void>}
 */
async function recordPicture(videoSource, mediaMs, { filename = null, error = null }) {
    await db.sequelize.query(
        `INSERT INTO habitat_segment_pictures (video_source, media_ms, crop, status, filename, last_error, created_at, updated_at)
         VALUES (:videoSource, :mediaMs, :crop, :status, :filename, :error, NOW(), NOW())
         ON CONFLICT (video_source, media_ms, crop)
         DO UPDATE SET status = EXCLUDED.status, filename = EXCLUDED.filename,
                       last_error = EXCLUDED.last_error, updated_at = NOW()`,
        {
            replacements: { videoSource, mediaMs, crop: CROP, status: filename ? 'ready' : 'failed', filename, error },
            type: QueryTypes.INSERT,
        }
    );
}

/**
 * Cut one segment picture: one frame at `mediaMs`, the habitat crop, kept in `SEGMENT_DIR`.
 *
 * @async
 * @param {string} videoSource
 * @param {number} mediaMs
 * @returns {Promise<string>} The kept file's name.
 * @throws {Error} When the video cannot be found or the frame does not decode.
 */
async function cut(videoSource, mediaMs) {
    const resolved = await jellyfinRepository.resolveVideoSource(videoSource, 1, MEDIA_CLIENT_IDENTITY);
    if (!resolved || resolved.score < MIN_MATCH_SCORE) {
        throw new Error(`No exact Jellyfin match for video_source ${JSON.stringify(videoSource)}.`);
    }
    const streamUrl = await jellyfinRepository.buildDirectStreamUrl(resolved.item.id, MEDIA_CLIENT_IDENTITY);
    const probe = await extraction.probeStream(streamUrl);
    if (!probe.fps) throw new Error(`${videoSource} reported no frame rate, so its frames cannot be addressed.`);

    // The moment at the video's own rate: a segment's middle is a time, not a frame count.
    const frame = Math.round((mediaMs * probe.fps) / 1000);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-segment-'));
    try {
        const { files } = await extraction.extractFrames(streamUrl, [frame], probe.fps, workDir);
        if (!files || !files[0]) throw new Error(`Frame ${frame} did not decode from ${videoSource}.`);
        const tile = await extraction.cropToTile(files[0], HABITAT_BOX);
        fs.mkdirSync(SEGMENT_DIR, { recursive: true });
        fs.renameSync(path.join(STORAGE_DIR, tile.filename), path.join(SEGMENT_DIR, tile.filename));
        return tile.filename;
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

/**
 * A segment's picture, cut now if it has not been.
 *
 * @async
 * @param {string} videoSource - The video, as observations record it.
 * @param {number} mediaMs - The segment's middle, in the file's own time.
 * @returns {Promise<{path?: string, filename?: string, error?: string}>} The file to serve, or
 *   why there is none.
 */
async function segmentPicture(videoSource, mediaMs) {
    const ms = Math.round(mediaMs);
    const known = await findPicture(videoSource, ms);
    if (known && known.status === 'ready' && fs.existsSync(path.join(SEGMENT_DIR, known.filename))) {
        return { filename: known.filename, path: path.join(SEGMENT_DIR, known.filename) };
    }
    if (known && known.status === 'failed' && Date.now() - new Date(known.updated_at).getTime() < RETRY_AFTER_MS) {
        return { error: known.last_error };
    }

    const key = `${videoSource}|${ms}`;
    if (!cutting.has(key)) {
        cutting.set(key, inTurn(async () => {
            try {
                const filename = await cut(videoSource, ms);
                await recordPicture(videoSource, ms, { filename });
                return { filename, path: path.join(SEGMENT_DIR, filename) };
            } catch (error) {
                const message = String(error && error.message ? error.message : error).slice(0, 2000);
                await recordPicture(videoSource, ms, { error: message });
                return { error: message };
            }
        }).finally(() => cutting.delete(key)));
    }
    return cutting.get(key);
}

module.exports = { SEGMENT_DIR, CROP, RETRY_AFTER_MS, segmentPicture };
