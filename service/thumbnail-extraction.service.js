/**
 * Thumbnail extraction: resolve, decode, crop, store, record.
 *
 * **Extraction runs in the API** (A1, answered by the human: *"for now, let's
 * skip the idea of having the GPU do it. We might do that later."*). The rate
 * limit is Jellyfin's and moving the work does not move it -- what moving it
 * would change is *who queues behind it*, and it would remove the one place that
 * can count. Here the limiter is a semaphore in one process.
 *
 * **The ceiling is shared with people.** The video player and the annotation GUI
 * stream from the same Jellyfin, and a reviewer watching a clip is one of its
 * five or six streams, so extraction takes strictly less than the ceiling --
 * {@link MAX_CONCURRENT_STREAMS}, which is one constant in one file for exactly
 * this reason.
 *
 * The pipeline per batch, and every step is a requirement:
 *
 * 1. **Resolve from `video_source`** -- never from `jellyfin_item_id`, which is
 *    opaque provenance the worker contract says is *"never resolved, parsed or
 *    acted on"*. A match below {@link MIN_MATCH_SCORE} is a **permanent** failure
 *    carrying the score, because a match at 60 can produce a confident, plausible
 *    picture of the wrong dive and the reviewer would read that as a bad
 *    detection rather than as a bug (A8).
 * 2. **Probe** the stream for its real pixel dimensions and its real frame rate.
 *    A rate that disagrees with the 25 `db/timecode.js` used to derive the
 *    observation's frame is **recorded as a failure carrying both rates**, not
 *    warned about and continued (R21): on any other rate the seek silently lands
 *    somewhere else and produces a confident picture of the wrong thing.
 * 3. **Cut every wanted frame of one video from one ffmpeg pass** (R17). The
 *    first real run's six observations were six frames inside eleven seconds of
 *    one video; six connections would be a fifth of Jellyfin's whole ceiling.
 * 4. **Crop** through `service/thumbnail-geometry.js`, against the decoded
 *    frame's own dimensions and never a stored or assumed size (R6).
 * 5. **Record**, so the picture can be traced back to the frame it came from and
 *    remade from the database alone (R8, R10).
 *
 * **Nothing here starts on `require`.** `app.js` is imported directly by every
 * test suite, and a module that began opening Jellyfin streams on import would
 * have the whole suite decoding video. {@link start} is called by `server.js`,
 * the HTTP entry point, which is the same split that keeps `app.listen` out of
 * `app.js`.
 *
 * **No stream URL may ever reach a log, an error message or a stored row.**
 * `buildDirectStreamUrl` embeds the Jellyfin access token as `api_key`, and
 * `last_error` is read by operators and surfaced to reviewers.
 *
 * Refs #118.
 *
 * @fileoverview The bounded in-process thumbnail extractor.
 * @author Isaac Travers
 * @module service/thumbnail-extraction
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sharp = require('sharp');

const logger = require('../logger/api.logger');
const jellyfinRepository = require('../repository/jellyfin.repository');
const thumbnailRepository = require('../repository/observation-thumbnail.repository');
const { parseTimeSpan, absoluteFrame, ASSUMED_FPS } = require('../db/timecode');
const { chooseBox, cropRectangle } = require('./thumbnail-geometry');

const {
    CLAIM_BATCH_SIZE,
    FFMPEG_PATH,
    FFMPEG_TIMEOUT_MS,
    FFPROBE_PATH,
    FPS_TOLERANCE,
    IDLE_POLL_INTERVAL_MS,
    MAX_CONCURRENT_STREAMS,
    MEDIA_CLIENT_IDENTITY,
    MIN_MATCH_SCORE,
    SEEK_LEAD_SECONDS,
    STORAGE_DIR,
    THUMBNAIL_CONTENT_TYPE,
    THUMBNAIL_QUALITY,
    THUMBNAIL_SIZE,
} = require('../config/thumbnails');

/**
 * What the extractor is doing right now, in this process.
 *
 * Deliberately **not** the run state, which is persisted (R25). This is the live
 * half -- whether the loop is turning and how many streams are open -- and the
 * status endpoint reports both because they answer different questions: "has
 * somebody paused it" and "is it actually working".
 *
 * @type {Object}
 */
const live = {
    started: false,
    draining: false,
    inFlight: 0,
    binariesChecked: false,
    binariesAvailable: false,
    binaryError: null,
    lastRunError: null,
    timer: null,
};

/**
 * Removes the Jellyfin access token from anything before it is logged or stored.
 *
 * The token is embedded as `api_key` by `buildDirectStreamUrl`, and ffmpeg echoes
 * the URL it was given into its own stderr -- so the last few lines of a failed
 * decode carry a live credential unless this runs over them first.
 *
 * @param {*} text - Anything that might contain a stream URL.
 * @returns {string} The same text with the token replaced.
 */
function elideToken(text) {
    return String(text == null ? '' : text).replace(/api_key=[^&\s"']*/g, 'api_key=<elided>');
}

/**
 * Runs a native command to completion, capturing both streams.
 *
 * Killed after {@link FFMPEG_TIMEOUT_MS}: a hung decode against a struggling
 * media server must not hold one of the three streams for ever.
 *
 * @async
 * @param {string} bin - Executable.
 * @param {Array<string>} args - Arguments.
 * @returns {Promise<{code: number, stdout: string, stderr: string, timedOut: boolean}>} Exit code and output.
 */
function run(bin, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { windowsHide: true });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, FFMPEG_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, timedOut });
        });
    });
}

/**
 * Checks that ffmpeg and ffprobe are actually there (A9).
 *
 * Answered by the human: a system binary located through configuration, with the
 * API **refusing to start the extractor, and reporting so, when it is absent**.
 * A loud condition the status endpoint reports rather than a run-time surprise on
 * the first thumbnail -- and deliberately not a reason for the API to refuse to
 * start at all, because serving observations does not depend on it.
 *
 * The result is cached: the answer cannot change without a restart, and probing
 * on every drain would spawn two processes a second.
 *
 * @async
 * @returns {Promise<boolean>} Whether both binaries answered.
 */
async function checkBinaries() {
    if (live.binariesChecked) {
        return live.binariesAvailable;
    }

    live.binariesChecked = true;

    for (const bin of [FFMPEG_PATH, FFPROBE_PATH]) {
        try {
            const result = await run(bin, ['-version']);

            if (result.code !== 0) {
                live.binariesAvailable = false;
                live.binaryError = `${bin} exited ${result.code}. Set FFMPEG_PATH and FFPROBE_PATH, or install ffmpeg.`;

                return false;
            }
        } catch (error) {
            live.binariesAvailable = false;
            live.binaryError = `${bin} could not be run (${error.code || error.message}). `
                + 'ffmpeg is a deployment prerequisite for thumbnail extraction (A9): install it, or set FFMPEG_PATH and FFPROBE_PATH.';

            return false;
        }
    }

    live.binariesAvailable = true;
    live.binaryError = null;

    return true;
}

/**
 * Reads a stream's real pixel dimensions and real frame rate.
 *
 * Both are requirements rather than diagnostics. R6: a normalised box multiplied
 * by the wrong dimensions is a silent crop of the wrong part of the seabed. R21:
 * `framenum` becomes a seek time through a frame rate, and the wrong rate seeks
 * to the wrong moment.
 *
 * @async
 * @param {string} streamUrl - Resolved Jellyfin stream URL. Never logged.
 * @returns {Promise<Object>} `{ width, height, fps, duration, codec }`.
 * @throws {Error} If ffprobe fails or reports no video stream.
 */
async function probeStream(streamUrl) {
    const result = await run(FFPROBE_PATH, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name',
        '-show_entries', 'format=duration',
        '-of', 'json',
        streamUrl,
    ]);

    if (result.code !== 0) {
        throw new Error(`ffprobe exited ${result.code}: ${elideToken(result.stderr).trim()}`);
    }

    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams && parsed.streams[0];

    if (!stream) {
        throw new Error('ffprobe returned no video stream for this source.');
    }

    const [num, den] = String(stream.avg_frame_rate || '0/1').split('/').map(Number);

    return {
        width: stream.width,
        height: stream.height,
        codec: stream.codec_name,
        fps: den ? num / den : null,
        duration: parsed.format ? Number(parsed.format.duration) : null,
    };
}

/**
 * Cuts a set of frames from one video in a single ffmpeg pass (R17).
 *
 * The pass seeks to just before the earliest wanted frame and selects the wanted
 * ones by timestamp with `-copyts`, so `t` inside the filter stays absolute
 * source time. `showinfo` prints what actually came out, which is the only way to
 * check the frame that landed is the frame that was asked for -- the spike read
 * back a pts delta of 0 for all six.
 *
 * @async
 * @param {string} streamUrl - Resolved stream URL. Never logged.
 * @param {Array<number>} frames - Absolute frame numbers wanted, ascending.
 * @param {number} fps - The source's real frame rate.
 * @param {string} destination - Directory to write the PNGs into.
 * @returns {Promise<Object>} `{ files, ptsTimes, seconds }`.
 * @throws {Error} If ffmpeg fails.
 */
async function extractFrames(streamUrl, frames, fps, destination) {
    const targets = frames.map((frame) => frame / fps);
    const halfFrame = 1 / (2 * fps);

    const start = Math.max(0, targets[0] - SEEK_LEAD_SECONDS);
    const duration = (targets[targets.length - 1] - start) + 1;

    const selectExpr = targets
        .map((t) => `lt(abs(t-${t.toFixed(6)})\\,${halfFrame.toFixed(6)})`)
        .join('+');

    const args = [
        '-hide_banner',
        '-nostdin',
        '-copyts',
        '-ss', start.toFixed(3),
        '-t', duration.toFixed(3),
        '-i', streamUrl,
        '-vf', `select='${selectExpr}',showinfo`,
        '-fps_mode', 'passthrough',
        '-frames:v', String(frames.length),
        '-f', 'image2',
        path.join(destination, 'frame-%04d.png'),
    ];

    const started = Date.now();
    const result = await run(FFMPEG_PATH, args);
    const seconds = (Date.now() - started) / 1000;

    if (result.code !== 0) {
        const tail = elideToken(result.stderr).split('\n').slice(-8).join('\n').trim();

        throw new Error(
            result.timedOut
                ? `ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s: ${tail}`
                : `ffmpeg exited ${result.code}: ${tail}`
        );
    }

    const ptsTimes = [];

    for (const line of result.stderr.split('\n')) {
        const match = /pts_time:([0-9.]+)/.exec(line);

        if (match) {
            ptsTimes.push(Number(match[1]));
        }
    }

    const files = fs.readdirSync(destination)
        .filter((name) => /^frame-\d+\.png$/.test(name))
        .sort()
        .map((name) => path.join(destination, name));

    return { files, ptsTimes, seconds };
}

/**
 * Why the source's frame rate makes it unsafe to seek, or null (R21).
 *
 * **The rate is read, never assumed, and a disagreement is a failure carrying
 * both rates rather than a warning.** `observation_frame` is derived at
 * `db/timecode.js`'s assumed 25, so on any other rate the seek lands on a
 * different moment and produces a *confident picture of the wrong thing* -- which
 * looks like a bad detection, not like a bug. Added at the human's direction:
 * *"we don't want to assume it's gonna be 25 FPS all the time."*
 *
 * The footage MARP holds today is 25.000 exactly, so this cannot fire on it. That
 * is the reason it is a separate, directly testable function rather than a
 * condition buried in the extraction path: the only evidence it works will be a
 * test until some other footage arrives.
 *
 * @param {number|null} fps - What ffprobe reported.
 * @returns {string|null} The refusal, in words, or null when the rates agree.
 */
function frameRateRefusal(fps) {
    if (Number.isFinite(fps) && Math.abs(fps - ASSUMED_FPS) <= FPS_TOLERANCE) {
        return null;
    }

    return `Source frame rate is ${Number.isFinite(fps) ? fps : 'unreadable'} but the observation frame was derived at `
        + `${ASSUMED_FPS} fps by db/timecode.js. Refusing to seek: the two rates disagree, and seeking at the wrong rate `
        + 'lands on a different moment and produces a confident picture of the wrong thing.';
}

/**
 * Works out which frame and which box one claimed observation wants.
 *
 * Everything that can be decided without touching Jellyfin is decided here, so an
 * observation that can never have a picture -- no keyframes at all, an
 * unparseable `mediaPosition` -- is failed **permanently** before a stream is
 * opened rather than after.
 *
 * @param {Object} claim - A row from `claimBatch`.
 * @param {Array<Object>} keyframes - That observation's keyframes.
 * @returns {Object} `{ ok: true, frame, box, subset, source }` or `{ ok: false, error, permanent }`.
 */
function planObservation(claim, keyframes) {
    if (!keyframes || keyframes.length === 0) {
        // F6: an observation can have no keyframes at all, which means no box,
        // which means no cropped tile, ever. This is the case that makes a
        // permanent state necessary rather than tidy.
        return {
            ok: false,
            permanent: true,
            error: 'The observation has no keyframes, so it has no bounding box and can never have a cropped picture.',
        };
    }

    const mediaMs = parseTimeSpan(claim.mediaPosition);

    if (mediaMs === null) {
        return {
            ok: false,
            permanent: true,
            error: `mediaPosition ${JSON.stringify(claim.mediaPosition)} does not parse as a TimeSpan, so the observation has no moment to cut a picture from.`,
        };
    }

    const observationFrame = absoluteFrame(mediaMs);
    const choice = chooseBox(keyframes, observationFrame);

    if (!choice) {
        return {
            ok: false,
            permanent: true,
            error: `No usable keyframe box for frame ${observationFrame}.`,
        };
    }

    return {
        ok: true,
        frame: choice.framenum,
        box: choice.box,
        subset: choice.subset,
        source: choice.source,
    };
}

/**
 * Crops one decoded frame and writes the tile.
 *
 * **The crop is computed from the decoded frame's own pixel dimensions**, read
 * from the decode itself (R6). `sharp` reporting no dimensions is a failure, not
 * a reason to fall back on the probe's numbers: the probe describes the stream
 * and this describes the picture that actually came out of it.
 *
 * @async
 * @param {string} framePath - PNG of the decoded frame.
 * @param {Object} box - The normalised centre-origin box.
 * @param {number} observationId - Whose thumbnail, for the filename.
 * @returns {Promise<Object>} What {@link thumbnailRepository.recordReady} wants.
 * @throws {Error} If the frame has no readable dimensions.
 */
async function cropToTile(framePath, box, observationId) {
    const metadata = await sharp(framePath).metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error(
            'The decoded frame reported no pixel dimensions, so the normalised box cannot be turned into a crop. '
            + 'Refusing rather than assuming a size.'
        );
    }

    const rectangle = cropRectangle(box, metadata.width, metadata.height);

    // Named by the observation, so the file is derivable from the row and the row
    // from the file. `generation` is not in the name: the URL is stable per
    // observation and the ETag is what makes a replacement visible.
    const filename = `${observationId}.jpg`;

    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    const buffer = await sharp(framePath)
        .extract({
            left: rectangle.clamped.left,
            top: rectangle.clamped.top,
            width: rectangle.clamped.width,
            height: rectangle.clamped.height,
        })
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
        .jpeg({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

    fs.writeFileSync(path.join(STORAGE_DIR, filename), buffer);

    return {
        filename,
        contentType: THUMBNAIL_CONTENT_TYPE,
        byteSize: buffer.length,
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        wasClamped: rectangle.wasClamped,
    };
}

/**
 * Extracts every wanted frame of one video, from one stream.
 *
 * One unit of concurrency: this is what the semaphore counts, because it is what
 * holds a Jellyfin stream open.
 *
 * @async
 * @param {string} videoSource - The `observations.video_source` these share.
 * @param {Array<Object>} claims - Claimed rows for that video.
 * @returns {Promise<Object>} `{ ready, failed, seconds }` counts.
 */
async function extractVideoGroup(videoSource, claims) {
    const ids = claims.map((claim) => claim.observation_id);
    const outcome = { ready: 0, failed: 0, seconds: 0 };

    let resolved;

    try {
        // Resolution goes through `video_source`, which is populated on every row
        // ever recorded. `jellyfin_item_id` is provenance and is deliberately not
        // consulted: the worker contract calls it opaque and never resolved.
        resolved = await jellyfinRepository.resolveVideoSource(videoSource, 1, MEDIA_CLIENT_IDENTITY);
    } catch (error) {
        // No candidate at all. Retrying asks the same question of the same
        // library and gets the same answer, so this is permanent (R9).
        for (const id of ids) {
            await thumbnailRepository.recordFailure(
                id,
                `No Jellyfin video matched video_source ${JSON.stringify(videoSource)}: ${elideToken(error.message)}`,
                true
            );
        }

        outcome.failed = ids.length;

        return outcome;
    }

    if (resolved.score < MIN_MATCH_SCORE) {
        // A8: below the exact-match band is a permanent failure carrying the
        // score, not a lower bar. A picture of the wrong dive is worse than no
        // picture, and recording the score is what lets the bar be lowered later
        // against evidence instead of guessed at again.
        for (const id of ids) {
            await thumbnailRepository.recordFailure(
                id,
                `Best Jellyfin match for video_source ${JSON.stringify(videoSource)} scored ${resolved.score}, `
                + `below the ${MIN_MATCH_SCORE} exact-match threshold. A weaker match can attach a picture of the wrong dive.`,
                true
            );
        }

        outcome.failed = ids.length;

        return outcome;
    }

    const streamUrl = await jellyfinRepository.buildDirectStreamUrl(resolved.item.id, MEDIA_CLIENT_IDENTITY);
    const probe = await probeStream(streamUrl);

    if (!probe.width || !probe.height) {
        for (const id of ids) {
            await thumbnailRepository.recordFailure(
                id,
                'The video stream reported no pixel dimensions, so a normalised box cannot be turned into a crop.',
                false
            );
        }

        outcome.failed = ids.length;

        return outcome;
    }

    // R21. Permanent, because the same video reports the same rate on every
    // retry -- so a retry is a request to Jellyfin that cannot succeed. Clearing
    // these rows is what a fix for variable rates would do.
    const rateRefusal = frameRateRefusal(probe.fps);

    if (rateRefusal) {
        for (const id of ids) {
            await thumbnailRepository.recordFailure(id, rateRefusal, true);
        }

        outcome.failed = ids.length;

        return outcome;
    }

    const keyframes = await thumbnailRepository.keyframesFor(ids);
    const wanted = [];

    for (const claim of claims) {
        const plan = planObservation(claim, keyframes.get(claim.observation_id));

        if (!plan.ok) {
            await thumbnailRepository.recordFailure(claim.observation_id, plan.error, plan.permanent);
            outcome.failed += 1;

            continue;
        }

        // A frame past the end of the video can never be decoded from it (R9).
        if (probe.duration && (plan.frame / probe.fps) > probe.duration) {
            await thumbnailRepository.recordFailure(
                claim.observation_id,
                `Frame ${plan.frame} is ${(plan.frame / probe.fps).toFixed(1)}s into a video that is `
                + `${probe.duration.toFixed(1)}s long, so the moment this observation records is not in this video.`,
                true
            );

            outcome.failed += 1;

            continue;
        }

        wanted.push({ claim, plan });
    }

    if (wanted.length === 0) {
        return outcome;
    }

    wanted.sort((a, b) => a.plan.frame - b.plan.frame);

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-thumbnail-'));

    try {
        const extraction = await extractFrames(
            streamUrl,
            wanted.map((entry) => entry.plan.frame),
            probe.fps,
            workDir
        );

        outcome.seconds = extraction.seconds;

        for (let index = 0; index < wanted.length; index += 1) {
            const { claim, plan } = wanted[index];
            const framePath = extraction.files[index];

            if (!framePath) {
                // Asked for more frames than came back. Transient rather than
                // permanent: a truncated stream is a media-server condition and
                // the next attempt may well get it.
                await thumbnailRepository.recordFailure(
                    claim.observation_id,
                    `ffmpeg returned ${extraction.files.length} frames for ${wanted.length} asked for, `
                    + `so frame ${plan.frame} did not arrive.`,
                    false
                );

                outcome.failed += 1;

                continue;
            }

            try {
                const tile = await cropToTile(framePath, plan.box, claim.observation_id);

                await thumbnailRepository.recordReady(claim.observation_id, {
                    ...tile,
                    framenum: plan.frame,
                    subset: plan.subset,
                });

                outcome.ready += 1;
            } catch (error) {
                await thumbnailRepository.recordFailure(
                    claim.observation_id,
                    elideToken(error.message),
                    false
                );

                outcome.failed += 1;
            }
        }
    } catch (error) {
        // The whole pass failed, so nothing in this group got a picture.
        for (const entry of wanted) {
            await thumbnailRepository.recordFailure(
                entry.claim.observation_id,
                elideToken(error.message),
                false
            );
        }

        outcome.failed += wanted.length;
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }

    return outcome;
}

/**
 * Groups a claimed batch by the video it needs (R17).
 *
 * The key is `video_source`, not the resolved item, because grouping has to
 * happen *before* anything is resolved -- resolving per observation would be one
 * Jellyfin search per tile.
 *
 * @param {Array<Object>} claims - Claimed rows.
 * @returns {Map<string, Array<Object>>} video_source to its claims.
 */
function groupByVideo(claims) {
    const groups = new Map();

    for (const claim of claims) {
        const key = claim.video_source == null ? '' : String(claim.video_source);

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(claim);
    }

    return groups;
}

/**
 * Runs one drain pass: claim what is queued, extract it, record the outcomes.
 *
 * Exported so a test and the measurement in R20 can drive extraction directly
 * rather than waiting on the loop. **It respects the persisted pause**, so a
 * caller cannot accidentally work around the control surface.
 *
 * @async
 * @param {number} [limit] - How many rows to claim.
 * @returns {Promise<Object>} `{ claimed, ready, failed, groups, skipped }`.
 */
async function drainOnce(limit = CLAIM_BATCH_SIZE) {
    const summary = { claimed: 0, ready: 0, failed: 0, groups: 0, skipped: null };

    const runState = await thumbnailRepository.readRunState();

    if (runState && runState.run_state === 'paused') {
        summary.skipped = 'paused';

        return summary;
    }

    if (!await checkBinaries()) {
        summary.skipped = 'no-ffmpeg';

        return summary;
    }

    const claims = await thumbnailRepository.claimBatch(limit);

    summary.claimed = claims.length;

    if (claims.length === 0) {
        return summary;
    }

    const groups = [...groupByVideo(claims).entries()];

    summary.groups = groups.length;

    // The semaphore. A worker takes the next group, holds one Jellyfin stream
    // while it runs, and takes another when it is done -- so at most
    // MAX_CONCURRENT_STREAMS streams are ever open, whatever the batch size.
    let next = 0;

    const worker = async () => {
        for (;;) {
            const index = next;

            next += 1;

            if (index >= groups.length) {
                return;
            }

            const [videoSource, groupClaims] = groups[index];

            live.inFlight += 1;

            try {
                const outcome = await extractVideoGroup(videoSource, groupClaims);

                summary.ready += outcome.ready;
                summary.failed += outcome.failed;
            } catch (error) {
                // An unexpected throw must not lose the claim: leave the rows
                // failed with the reason rather than claimed for ever.
                for (const claim of groupClaims) {
                    await thumbnailRepository.recordFailure(
                        claim.observation_id, elideToken(error.message), false
                    );
                }

                summary.failed += groupClaims.length;
                live.lastRunError = elideToken(error.message);
            } finally {
                live.inFlight -= 1;
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_STREAMS, groups.length) }, () => worker())
    );

    return summary;
}

/**
 * The drain loop. One pass, then a wait, then another, until stopped.
 *
 * Repeated looking rather than `LISTEN`/`NOTIFY`, for the reason
 * `config/gpu-orchestration.js` gives about its own poll: work appears when
 * somebody opens a page, and a second of latency is invisible next to the decode.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loop() {
    if (!live.started) {
        return;
    }

    live.draining = true;

    try {
        const summary = await drainOnce();

        live.lastRunError = summary.skipped === 'no-ffmpeg' ? live.binaryError : live.lastRunError;
    } catch (error) {
        live.lastRunError = elideToken(error.message);
        logger.error(`Thumbnail extraction pass failed: ${elideToken(error.message)}`);
    } finally {
        live.draining = false;
    }

    if (live.started) {
        live.timer = setTimeout(loop, IDLE_POLL_INTERVAL_MS);

        // Nothing else in the process should be held open by this.
        if (live.timer.unref) {
            live.timer.unref();
        }
    }
}

/**
 * Starts the extractor.
 *
 * **Called by `server.js`, never by `app.js`.** Every test suite imports the app
 * directly, and a loop that started on import would have the whole suite opening
 * Jellyfin streams -- so the split that keeps `app.listen` out of `app.js` keeps
 * this out too.
 *
 * When ffmpeg is absent the extractor **does not start and says why** (A9). The
 * API still serves: extraction is the only thing that needs a decoder.
 *
 * @async
 * @returns {Promise<Object>} `{ started, reason }`.
 */
async function start() {
    if (live.started) {
        return { started: true, reason: null };
    }

    if (!await checkBinaries()) {
        logger.error(`Thumbnail extraction is not running: ${live.binaryError}`);

        return { started: false, reason: live.binaryError };
    }

    live.started = true;
    live.timer = setTimeout(loop, 0);

    if (live.timer.unref) {
        live.timer.unref();
    }

    return { started: true, reason: null };
}

/**
 * Stops the loop in this process.
 *
 * Not the same thing as the persisted `stop` action, which discards the queue.
 * This is the process shutting down, and a claimed row is simply reclaimed after
 * its lease expires (R18).
 *
 * @returns {void}
 */
function stop() {
    live.started = false;

    if (live.timer) {
        clearTimeout(live.timer);
        live.timer = null;
    }
}

/**
 * What the extractor is doing, for the status endpoint (R23).
 *
 * Reports the persisted run state and the live state together, because they
 * answer different questions: whether somebody paused it, and whether it is
 * actually turning. A service that is `running` but has no ffmpeg is the case
 * this exists to make visible.
 *
 * @async
 * @returns {Promise<Object>} The status body.
 */
async function status() {
    const [runState, counts, failure] = await Promise.all([
        thumbnailRepository.readRunState(),
        thumbnailRepository.statusCounts(),
        thumbnailRepository.lastFailure(),
    ]);

    // Checked lazily rather than at import: the status endpoint may well be the
    // first thing anybody calls, and "is ffmpeg here" is exactly what they are
    // asking.
    await checkBinaries();

    return {
        runState: runState ? runState.run_state : 'running',
        runStateChangedAt: runState ? runState.changed_at : null,
        runStateChangedBy: runState ? runState.changed_by_user_id : null,
        runStateNote: runState ? runState.note : null,
        loopStarted: live.started,
        draining: live.draining,
        inFlight: live.inFlight,
        concurrencyLimit: MAX_CONCURRENT_STREAMS,
        extractorAvailable: live.binariesAvailable,
        extractorUnavailableReason: live.binaryError,
        counts: {
            queued: counts.queued,
            ready: counts.ready,
            failed: counts.failed,
            permanent: counts.permanent,
            claimed: counts.claimed,
        },
        lastError: live.lastRunError,
        lastFailure: failure
            ? {
                observation_id: failure.observation_id,
                last_error: failure.last_error,
                at: failure.completed_at,
            }
            : null,
    };
}

/**
 * Applies a control action (R24).
 *
 * `pause` stops *starting* new extractions and lets in-flight ones finish,
 * because killing an ffmpeg mid-decode wastes the Jellyfin stream it already paid
 * for. `resume` starts taking work again. `stop` is pause plus discarding the
 * queue -- the rows return to being simply absent, which since A3 was reversed
 * reports `failed` and is re-enqueued by the reviewer's *Ask again* rather than by
 * the next page view. Nothing is lost and no fourth state is needed.
 *
 * @async
 * @param {string} action - `pause`, `resume` or `stop`.
 * @param {number|null} userId - Who asked.
 * @param {string|null} [note] - Why.
 * @returns {Promise<Object>} The new status, plus what the action did.
 */
async function control(action, userId, note = null) {
    let discarded = 0;

    if (action === 'resume') {
        await thumbnailRepository.writeRunState('running', userId, note);
    } else {
        await thumbnailRepository.writeRunState('paused', userId, note);

        if (action === 'stop') {
            discarded = await thumbnailRepository.discardQueue();
        }
    }

    return { action, discarded, ...(await status()) };
}

module.exports = {
    control,
    drainOnce,
    elideToken,
    extractVideoGroup,
    frameRateRefusal,
    groupByVideo,
    planObservation,
    probeStream,
    start,
    status,
    stop,
};
