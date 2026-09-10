/**
 * The numbers, paths and vocabularies Phase 6 thumbnail extraction is built on.
 *
 * Gathered in one file for the reason `config/gpu-orchestration.js` gives about
 * its own: these are the parts most likely to be tuned, and a constant written
 * into three places drifts. R16 asks for exactly this -- the concurrency bound in
 * particular has to be one number in one file, because the observation that
 * changes it ("a reviewer's video stuttered while a page loaded") arrives from a
 * person rather than from a test.
 *
 * **The migration deliberately does not read this file.** Its check constraint
 * spells the status vocabulary out, so a change here that is not accompanied by a
 * migration shows up as a database error rather than as silence. Same rule, same
 * reason.
 *
 * Refs #118.
 *
 * @fileoverview Limits, paths and vocabularies for thumbnail extraction.
 * @author Isaac Travers
 * @module config/thumbnails
 */

'use strict';

const path = require('path');

/**
 * How many Jellyfin streams extraction may hold open at once (A7, R16).
 *
 * Three, answered by the human. **The ceiling is shared with people**: Jellyfin
 * sustains roughly five or six concurrent streams and a reviewer watching a clip
 * is one of them, so extraction taking all of it means a reviewer's own video
 * stalls while their own thumbnails are made. Three leaves at least half of it.
 *
 * The figure it is derived from -- "five or six" -- is an estimate nobody has
 * measured, which is why R20 asks for the measurement and why this is one
 * constant rather than a number scattered through the service.
 *
 * @constant
 * @type {number}
 */
const MAX_CONCURRENT_STREAMS = 3;

/**
 * Minimum video match score that may attach a picture to a scientific record (A8).
 *
 * Answered by the human, taking the recommendation: the exact-match band only.
 * `resolveVideoSource` scores an exact display-name, path-stem or full-filename
 * match at 100/98/96 and its own default `minScore` is 60 -- and a match at 60 can
 * produce a confident, plausible picture of **the wrong dive**, which a reviewer
 * reads as a bad detection and may delete. The failure mode is silent corruption
 * of the review, not a missing tile, so anything below this is recorded as a
 * permanent failure carrying the score, and the bar can be lowered later against
 * evidence.
 *
 * @constant
 * @type {number}
 */
const MIN_MATCH_SCORE = 96;

/**
 * Padding applied to each side of the box before the square expansion (A5).
 *
 * 10%, answered by the human after F32: the worker's `_apply_directional_pad`
 * already widens every machine-written box by local track velocity before it is
 * stored, so this is a **second, deliberate** application rather than the first.
 * 10% rather than the 20% originally recommended for that reason, and it still
 * hedges the legacy and hand-drawn boxes, which carry no velocity padding.
 *
 * @constant
 * @type {number}
 */
const PAD_FRACTION = 0.10;

/**
 * Edge of the finished tile, in pixels (A5).
 *
 * 320 rather than the fixture's 512, on a measurement rather than an estimate:
 * F35 found five of six real crops are *smaller than 320 px at source*, so
 * raising the output would buy nothing -- the limit is the detection's size at
 * 1920x1080, not the tile. 320 also covers a 132 px tile at 2x device pixel
 * ratio, and at 440,000 observations it is roughly 5 GB rather than 20.
 *
 * @constant
 * @type {number}
 */
const THUMBNAIL_SIZE = 320;

/**
 * JPEG quality for a stored tile. Matches what the spike produced and the human
 * looked at.
 *
 * @constant
 * @type {number}
 */
const THUMBNAIL_QUALITY = 88;

/**
 * MIME type every stored thumbnail carries. One format, so the served
 * `Content-Type` is a fact rather than a guess.
 *
 * @constant
 * @type {string}
 */
const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

/**
 * How far the source's real frame rate may sit from the rate `db/timecode.js`
 * assumed when it derived the observation's frame, before the extraction is
 * refused (R21).
 *
 * A tolerance rather than an equality test because ffprobe reports a rational --
 * 30000/1001 is 29.97002997... -- and floating point should not be the thing that
 * decides. Anything genuinely 25 comes back as 25.000 exactly.
 *
 * @constant
 * @type {number}
 */
const FPS_TOLERANCE = 0.01;

/**
 * How long a claimed extraction may run before the row is available again (R18).
 *
 * The queue is the `queued` rows in the table, so a process that died mid-decode
 * would otherwise strand its tiles at PREPARING for ever. This is a lease and it
 * is deliberately the smallest one that works -- a timestamp and a timeout. **If
 * it ever grows heartbeats or workers, that is the signal the GPU job system was
 * the right answer after all**, and this design should be revisited rather than
 * grown into a second copy of one.
 *
 * Two minutes: the spike cut six frames from one stream in 1.5 s, so a batch that
 * has been claimed this long is not slow, it is gone.
 *
 * @constant
 * @type {number}
 */
const CLAIM_TIMEOUT_SECONDS = 120;

/**
 * How many observations one extraction pass claims at a time.
 *
 * A page is 45 tiles, and claiming a page's worth means one drain cycle can serve
 * the page a reviewer is actually looking at.
 *
 * @constant
 * @type {number}
 */
const CLAIM_BATCH_SIZE = 45;

/**
 * How long the drain loop waits when it found nothing, in milliseconds.
 *
 * Repeated looking rather than `LISTEN`/`NOTIFY`, for the reason
 * `config/gpu-orchestration.js` gives about its own poll: work appears when
 * somebody opens a page, and a second of latency on picking it up is invisible
 * next to the decode.
 *
 * @constant
 * @type {number}
 */
const IDLE_POLL_INTERVAL_MS = 1000;

/**
 * Seconds of video decoded before the earliest wanted frame in a batch, so the
 * decoder is settled by the time it matters. The spike's value, which landed all
 * six frames with a pts delta of 0 (F36).
 *
 * @constant
 * @type {number}
 */
const SEEK_LEAD_SECONDS = 2;

/**
 * How long one ffmpeg or ffprobe call may run before it is killed, in
 * milliseconds. A hung decode against a struggling media server must not hold one
 * of the three streams for ever.
 *
 * @constant
 * @type {number}
 */
const FFMPEG_TIMEOUT_MS = 120000;

/**
 * Where the JPEG files live. A sister folder to the species pictures, served the
 * way they are served -- which is settled, not decided here.
 *
 * `storage/` is git-ignored and a thumbnail has no seed set to be re-imported
 * from, so a fresh deployment starts with this directory empty. That is why R10
 * requires the row to carry everything needed to make the picture again.
 *
 * @constant
 * @type {string}
 */
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'observation-thumbnails');

/**
 * The ffmpeg binary, located through configuration (A9).
 *
 * Answered by the human: a system binary the deployment provides, not
 * `ffmpeg-static`. It keeps an ~80 MB platform-specific binary out of every
 * developer's `node_modules`, and it makes "no ffmpeg here" a condition the
 * service reports rather than a surprise on the first thumbnail. The accepted
 * cost is a new deployment prerequisite on the production VM and on every
 * developer machine.
 *
 * @constant
 * @type {string}
 */
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * The ffprobe binary, same rule. R6 and R21 both go through it: the frame's real
 * pixel dimensions and the source's real frame rate are read, never assumed.
 *
 * @constant
 * @type {string}
 */
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

/**
 * Who MARP says it is when it opens a stream for its own purposes.
 *
 * Extraction is the first time the API reads video bytes rather than redirecting
 * a client to them (F28), so it is worth being nameable in Jellyfin's session
 * list -- that list is how R20's "concurrent streams observed" is counted.
 *
 * @constant
 * @type {Object}
 */
const MEDIA_CLIENT_IDENTITY = { client: 'MARP API', device: 'Thumbnail Extractor' };

/**
 * The three states a thumbnail row may hold (R3).
 *
 * Mirrors the migration's check constraint rather than feeding it. `permanent` is
 * a separate flag rather than a fourth state because the client's vocabulary is
 * these three (F9) and it already reads `thumbnail_permanent` alongside them.
 *
 * @constant
 * @type {Array<string>}
 */
const THUMBNAIL_STATUSES = ['queued', 'ready', 'failed'];

/**
 * What the extractor may be doing (R24, R25).
 *
 * `paused` stops *starting* new extractions and lets in-flight ones finish --
 * killing an ffmpeg mid-decode wastes the Jellyfin stream it already paid for.
 * There is no separate `stopped`: stop is pause plus discarding the queue, and the
 * next page view re-enqueues what it discarded, so nothing is lost and no fourth
 * state is needed.
 *
 * @constant
 * @type {Array<string>}
 */
const RUN_STATES = ['running', 'paused'];

/**
 * What `POST .../thumbnails/control` accepts (R24).
 *
 * @constant
 * @type {Array<string>}
 */
const CONTROL_ACTIONS = ['pause', 'resume', 'stop'];

module.exports = {
    MAX_CONCURRENT_STREAMS,
    MIN_MATCH_SCORE,
    PAD_FRACTION,
    THUMBNAIL_SIZE,
    THUMBNAIL_QUALITY,
    THUMBNAIL_CONTENT_TYPE,
    FPS_TOLERANCE,
    CLAIM_TIMEOUT_SECONDS,
    CLAIM_BATCH_SIZE,
    IDLE_POLL_INTERVAL_MS,
    SEEK_LEAD_SECONDS,
    FFMPEG_TIMEOUT_MS,
    STORAGE_DIR,
    FFMPEG_PATH,
    FFPROBE_PATH,
    MEDIA_CLIENT_IDENTITY,
    THUMBNAIL_STATUSES,
    RUN_STATES,
    CONTROL_ACTIONS,
};
