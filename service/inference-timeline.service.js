/**
 * When in a video an inference job, or a whole run, found what it found.
 *
 * **Isaac, on the Inference tab:** *"it doesn't tell me much about the video or the range
 * that I ran ... I can't even tell what section of video is ran."* A piece is a frame
 * range of one Jellyfin item and nothing on the screen said which item or which stretch,
 * and #288's counts said how many of each species but not whether they were spread
 * through the video or bunched into one minute (#288, with #293 folded in).
 *
 * So this answers three things at once: the video by name, with its length and frame
 * rate; each piece's range in seconds of that video, with its state; and the species
 * counted per stretch of time, in the database, so a run of thousands of observations
 * is a few dozen rows down the wire rather than every observation.
 *
 * **Every observation records where in the video it was seen**, as `mediaPosition`
 * (`00:10:33.4400000`), in the video's own time rather than the piece's. That is what is
 * bucketed. The range comes from the job's frames at the video's own rate.
 *
 * @fileoverview An inference job's or run's video, range and species over time.
 * @module service/inference-timeline
 */

'use strict';

const jellyfinRepository = require('../repository/jellyfin.repository');
const outcomeRepository = require('../repository/inference-outcome.repository');
const gpuService = require('./gpu.service');
const { fileNameFromPath } = require('./gpu.service');
const logger = require('../logger/api.logger');

/** The rate a lease assumes when a video's own cannot be read, as `gpu.service` does. */
const ASSUMED_FPS = 25;

/** Jellyfin's runtime unit: ten million ticks to the second. */
const TICKS_PER_SECOND = 10_000_000;

/** Bucket widths a timeline may use, in seconds, smallest first. */
const BUCKET_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 1800];

/** At most this many buckets across a timeline: enough to see a bunch, few enough to read. */
const MAX_BUCKETS = 60;

/**
 * The narrowest bucket that keeps a span under {@link MAX_BUCKETS}.
 *
 * @param {number} span - Seconds.
 * @returns {number} Seconds per bucket.
 */
function bucketFor(span) {
    return BUCKET_STEPS.find((step) => span / step <= MAX_BUCKETS) || BUCKET_STEPS[BUCKET_STEPS.length - 1];
}

/**
 * The video a job or a run processed, its pieces, and its species over time.
 *
 * @async
 * @param {Object} which - `{jobId}` for one piece or `{batchId}` for a run.
 * @returns {Promise<Object|null>} `{video, span, bucket_s, pieces, species}`, or null when
 *   there is no such job or run.
 */
async function timeline(which) {
    const pieces = await outcomeRepository.findTimelinePieces(which);

    if (!pieces.length) return null;

    const itemId = pieces.find((piece) => piece.jellyfin_item_id)?.jellyfin_item_id || null;
    let item = null;

    /* **A timeline without Jellyfin is still a timeline.** The name falls back to what
       the observations recorded and the length to the furthest piece, so a media server
       that is down costs the screen a duration, not the chart. */
    if (itemId) {
        try {
            item = await jellyfinRepository.getItem(itemId);
        } catch (error) {
            logger.info(`timeline for ${itemId} without Jellyfin: ${error.message}`);
        }
    }

    /* **The item it answered with, checked to be the one asked for.** Jellyfin given an id
       it cannot parse drops the filter and answers with the first item of the library --
       seen answering "CAMPA2019", a folder, for an id it did not have -- so an unchecked
       answer names the wrong video and times it at the wrong rate. */
    const same = (a, b) => String(a || '').replace(/-/g, '').toLowerCase() === String(b || '').replace(/-/g, '').toLowerCase();
    if (item && !same(item.id, itemId)) item = null;

    /* The rate only from a video Jellyfin really has; otherwise the 25 a lease assumes too,
       and the answer says it was assumed. */
    const fps = item ? await gpuService.frameRateForVideo({ jellyfin_item_id: itemId }) : ASSUMED_FPS;
    const fpsAssumed = !item;
    const duration = item && item.runtimeTicks ? Number(item.runtimeTicks) / TICKS_PER_SECOND : null;
    const seconds = (frame) => (frame === null || frame === undefined || !fps ? null : Number(frame) / fps);

    const shaped = pieces.map((piece) => ({
        job_id: piece.job_id,
        state: piece.state,
        start_frame: piece.start_frame,
        end_frame: piece.end_frame,
        start_s: seconds(piece.start_frame),
        /* A last piece is cut at the end of the video, so its end is never past it. */
        end_s: duration !== null && seconds(piece.end_frame) !== null
            ? Math.min(duration, seconds(piece.end_frame)) : seconds(piece.end_frame),
    }));

    /* One piece covers its own range; a run covers the whole video. */
    const ends = shaped.map((piece) => piece.end_s).filter((value) => value !== null);
    const span = which.jobId
        ? { from_s: shaped[0].start_s ?? 0, to_s: shaped[0].end_s ?? (duration || 0) }
        : { from_s: 0, to_s: duration ?? (ends.length ? Math.max(...ends) : 0) };
    const width = Math.max(1, span.to_s - span.from_s);
    const bucket = bucketFor(width);
    const buckets = Math.max(1, Math.ceil(width / bucket));

    const jobIds = shaped.map((piece) => piece.job_id);
    const rows = await outcomeRepository.countByTime({ jobIds, bucketSeconds: bucket, fromSeconds: span.from_s });

    /* Grouped by species, the corrected one counted under what it is, as #288's counts are. */
    const groups = new Map();
    for (const row of rows) {
        if (row.bucket < 0 || row.bucket >= buckets) continue;
        const key = row.species_id ?? `reported:${row.reported_name ?? ''}`;
        const group = groups.get(key) || {
            species_id: row.species_id,
            name: row.species_name || row.reported_name || 'Species not resolved',
            total: 0,
            counts: new Array(buckets).fill(0),
        };
        group.counts[row.bucket] += row.n;
        group.total += row.n;
        groups.set(key, group);
    }

    const name = (item && (fileNameFromPath(item.path) || item.name))
        || await outcomeRepository.observedVideoName(jobIds)
        || null;

    return {
        video: { jellyfin_item_id: itemId, name, duration_s: duration, fps, fps_assumed: fpsAssumed },
        span,
        bucket_s: bucket,
        pieces: shaped,
        species: [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    };
}

module.exports = { timeline, bucketFor, BUCKET_STEPS, MAX_BUCKETS };
