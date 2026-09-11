/**
 * Verification spike for Phase 6 thumbnails (MarineAppliedResearch/MARP_API#118).
 *
 * **This is not the extraction service and must not grow into one.** It writes no
 * table, adds no route and queues nothing. Its whole output is pictures plus the
 * numbers behind them, so a human can look at six crops and say whether the box is
 * on the animal before anybody codes the real thing. If the geometry is wrong, this
 * is where it gets caught, and it is far cheaper to catch here.
 *
 * What it does, per the settled decisions in `.marp/task.md`:
 *
 * - resolves the video from `observations.video_source` through
 *   `resolveVideoSource` (A8/F7 -- never from `jellyfin_item_id`, which is
 *   provenance), and refuses anything scoring below 96
 * - computes the observation's own absolute frame with
 *   `absoluteFrame(parseTimeSpan(mediaPosition))` from `db/timecode.js`
 * - interpolates the box linearly between the two bracketing keyframes (A4)
 * - extracts those frames with ffmpeg, all of one video's frames from **one**
 *   stream (R17), because Jellyfin's ceiling is shared with people
 * - crops centre-origin (F1), pads 10% of the box on each side, expands to
 *   square, clamps, and resizes to 320x320 JPEG (A5)
 *
 * Usage:
 *   node scripts/thumbnail-spike.js
 *
 * Run it from the repository root -- `dotenv` resolves `.env` against the working
 * directory. Output goes to `.marp/local/thumbnail-spike/`, which is git-ignored.
 *
 * Reads the database and Jellyfin. Writes nothing to either.
 *
 * @fileoverview Phase 6 thumbnail geometry spike: pictures and the numbers behind them.
 * @author Isaac Travers
 * @module scripts/thumbnail-spike
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const sharp = require('sharp');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');
const { parseTimeSpan, absoluteFrame } = require('../db/timecode');

/**
 * Minimum video match score that may attach a picture to a scientific record.
 * A8, answered by the human: the exact-match band only. Below this is a
 * permanent failure, not a lower bar.
 *
 * @constant
 * @type {number}
 */
const MIN_MATCH_SCORE = 96;

/**
 * Padding applied to each side of the box before the square expansion (A5).
 * Deliberately a *second* application -- the worker already velocity-pads the
 * stored box (F32) -- which is why it is 10% and not the 20% first recommended.
 *
 * @constant
 * @type {number}
 */
const PAD_FRACTION = 0.10;

/**
 * Edge of the finished tile, in pixels (A5).
 *
 * @constant
 * @type {number}
 */
const THUMB_SIZE = 320;

/**
 * Frames per second the timecode module assumes, and therefore the rate that
 * turns a `framenum` back into a seek time. `db/timecode.js` hardcodes 25 as
 * well; the script ffprobes the real rate and complains if they disagree,
 * because a mismatch silently extracts a different moment.
 *
 * @constant
 * @type {number}
 */
const ASSUMED_FPS = 25;

/**
 * The ffmpeg binary, located through configuration with a sensible default (A9).
 * The real extractor is meant to find it this way rather than assume a path.
 *
 * @constant
 * @type {string}
 */
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * The ffprobe binary, same rule.
 *
 * @constant
 * @type {string}
 */
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

/**
 * Where the pictures land. Git-ignored, and named in the task so the human
 * knows where to look.
 *
 * @constant
 * @type {string}
 */
const OUT_DIR = path.join(__dirname, '..', '.marp', 'local', 'thumbnail-spike');

/**
 * Removes the Jellyfin access token from a stream URL before anything prints it.
 *
 * The token is embedded as `api_key` by `buildDirectStreamUrl`, and this script's
 * output is read by people and pasted into reports -- so no full stream URL may
 * ever reach stdout, the log, or a file.
 *
 * @param {string} url - Stream URL, possibly carrying `api_key`.
 * @returns {string} The same URL with the token replaced.
 */
function elideToken(url) {
    return String(url).replace(/api_key=[^&]*/g, 'api_key=<elided>');
}

/**
 * Runs a native command to completion, capturing both streams.
 *
 * @param {string} bin - Executable.
 * @param {Array<string>} args - Arguments.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} Exit code and output.
 */
function run(bin, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

/**
 * Reads the observations and their keyframes.
 *
 * @async
 * @returns {Promise<Array<Object>>} Observations, each with its keyframes ordered by framenum.
 */
async function loadObservations() {
    const [observations] = await db.sequelize.query(`
        SELECT observation_id, video_source, "mediaPosition", comname, confidence
        FROM observations
        ORDER BY observation_id
    `);

    const [keyframes] = await db.sequelize.query(`
        SELECT observation_id, subset, framenum, x, y, width, height, confidence, type
        FROM keyframes
        ORDER BY observation_id, framenum
    `);

    return observations.map((observation) => ({
        ...observation,
        keyframes: keyframes.filter((k) => k.observation_id === observation.observation_id),
    }));
}

/**
 * Picks the two keyframes bracketing a frame and interpolates the box between them.
 *
 * Linear on `x`, `y`, `width` and `height` against `framenum` (A4). An exact hit
 * returns that keyframe with no interpolation; a frame outside the span returns
 * nothing, so the caller can fall back rather than extrapolate off the track.
 *
 * @param {Array<Object>} keyframes - Keyframes for one observation, ordered by framenum.
 * @param {number} frame - The observation's own absolute frame.
 * @returns {Object|null} `{ before, after, ratio, box }`, or null when the frame is outside the span.
 */
function interpolateBox(keyframes, frame) {
    if (!keyframes.length) {
        return null;
    }

    let before = null;
    let after = null;

    for (const keyframe of keyframes) {
        if (keyframe.framenum <= frame && (!before || keyframe.framenum > before.framenum)) {
            before = keyframe;
        }

        if (keyframe.framenum >= frame && (!after || keyframe.framenum < after.framenum)) {
            after = keyframe;
        }
    }

    if (!before || !after) {
        return null;
    }

    const span = after.framenum - before.framenum;
    const ratio = span === 0 ? 0 : (frame - before.framenum) / span;

    const lerp = (a, b) => a + ((b - a) * ratio);

    return {
        before,
        after,
        ratio,
        box: {
            x: lerp(Number(before.x), Number(after.x)),
            y: lerp(Number(before.y), Number(after.y)),
            width: lerp(Number(before.width), Number(after.width)),
            height: lerp(Number(before.height), Number(after.height)),
        },
    };
}

/**
 * Turns a normalised centre-origin box into the pixel rectangle to cut.
 *
 * Centre-origin (F1) -- `x, y` is the centre, so a reading that treats it as the
 * top-left is off by half a box in both axes. Pad, expand to square so the
 * client's `object-fit: cover` has nothing left to throw away (F12), then clamp
 * to the frame (R7): an overhanging box yields a smaller crop, never a negative
 * offset and never an error.
 *
 * @param {Object} box - Normalised `{x, y, width, height}`, centre-origin.
 * @param {number} sourceWidth - Decoded frame width, in pixels.
 * @param {number} sourceHeight - Decoded frame height, in pixels.
 * @returns {Object} The raw box, the padded square, and the clamped crop, all in pixels.
 */
function cropRectangle(box, sourceWidth, sourceHeight) {
    const centreX = box.x * sourceWidth;
    const centreY = box.y * sourceHeight;
    const boxWidth = box.width * sourceWidth;
    const boxHeight = box.height * sourceHeight;

    // The box as drawn, before any of this phase's own padding.
    const raw = {
        left: centreX - (boxWidth / 2),
        top: centreY - (boxHeight / 2),
        width: boxWidth,
        height: boxHeight,
    };

    // 10% of the box on each side, so the padded edge grows by 20% overall.
    const paddedWidth = boxWidth * (1 + (2 * PAD_FRACTION));
    const paddedHeight = boxHeight * (1 + (2 * PAD_FRACTION));

    // Square before clamping, about the same centre: the tile is square and the
    // browser would otherwise cut the ends off an elongated animal.
    const side = Math.max(paddedWidth, paddedHeight);

    const square = {
        left: centreX - (side / 2),
        top: centreY - (side / 2),
        width: side,
        height: side,
    };

    // Intersect with the frame. Boxes really do run off the edge (F3).
    const left = Math.max(0, Math.floor(square.left));
    const top = Math.max(0, Math.floor(square.top));
    const right = Math.min(sourceWidth, Math.ceil(square.left + square.width));
    const bottom = Math.min(sourceHeight, Math.ceil(square.top + square.height));

    const clamped = {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };

    // Whether the square genuinely overhung the frame, asked of the square itself.
    // Comparing the clamped size against `side` instead reports a spurious clamp on
    // every crop, because floor(left) and ceil(right) widen it by a pixel.
    const wasClamped = square.left < 0
        || square.top < 0
        || (square.left + square.width) > sourceWidth
        || (square.top + square.height) > sourceHeight;

    return { raw, square, clamped, wasClamped };
}

/**
 * Reads the video stream's real dimensions and frame rate.
 *
 * @async
 * @param {string} streamUrl - Resolved Jellyfin stream URL. Never printed.
 * @returns {Promise<Object>} `{ width, height, fps, duration, codec }`.
 */
async function probeStream(streamUrl) {
    const args = [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,nb_frames',
        '-show_entries', 'format=duration',
        '-of', 'json',
        streamUrl,
    ];

    const result = await run(FFPROBE_PATH, args);

    if (result.code !== 0) {
        throw new Error(`ffprobe exited ${result.code}: ${result.stderr.trim()}`);
    }

    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams && parsed.streams[0];

    if (!stream) {
        throw new Error('ffprobe returned no video stream.');
    }

    const [num, den] = String(stream.avg_frame_rate || '0/1').split('/').map(Number);

    return {
        width: stream.width,
        height: stream.height,
        codec: stream.codec_name,
        fps: den ? num / den : null,
        rFrameRate: stream.r_frame_rate,
        nbFrames: stream.nb_frames,
        duration: parsed.format ? Number(parsed.format.duration) : null,
    };
}

/**
 * Cuts a set of frames from one video in a single ffmpeg pass.
 *
 * One stream, not one per frame (R17). Jellyfin's ceiling is roughly five or six
 * concurrent streams and it is shared with people watching video, so six frames
 * eleven seconds apart must not be six connections.
 *
 * The pass seeks to just before the earliest wanted frame and selects the wanted
 * ones by timestamp with `-copyts`, so `t` inside the filter stays absolute source
 * time. `showinfo` prints what actually came out, which is the only way to check
 * the frame that landed is the frame that was asked for.
 *
 * @async
 * @param {string} streamUrl - Resolved stream URL. Never printed.
 * @param {Array<number>} frames - Absolute frame numbers wanted, ascending.
 * @param {number} fps - Frame rate used to turn a frame number into a time.
 * @param {string} destination - Directory to write the PNGs into.
 * @returns {Promise<Object>} `{ files, ptsTimes, seconds, command, stderr }`.
 */
async function extractFrames(streamUrl, frames, fps, destination) {
    const targets = frames.map((frame) => frame / fps);
    const halfFrame = 1 / (2 * fps);

    // Two seconds of lead so the decoder is settled by the first wanted frame.
    const start = Math.max(0, targets[0] - 2);
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
        path.join(destination, 'frame-%03d.png'),
    ];

    const started = Date.now();
    const result = await run(FFMPEG_PATH, args);
    const seconds = (Date.now() - started) / 1000;

    if (result.code !== 0) {
        throw new Error(`ffmpeg exited ${result.code}: ${result.stderr.split('\n').slice(-15).join('\n')}`);
    }

    // showinfo prints one line per frame that survived the select, carrying the
    // presentation timestamp. That is the evidence the right frame came out.
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

    return {
        files,
        ptsTimes,
        seconds,
        command: `${FFMPEG_PATH} ${args.map((a) => (a === streamUrl ? '<stream url elided>' : a)).join(' ')}`,
        stderr: elideToken(result.stderr),
    };
}

/**
 * Escapes text for inclusion in an SVG overlay.
 *
 * @param {string} text - Raw text.
 * @returns {string} Escaped text.
 */
function escapeXml(text) {
    return String(text).replace(/[<>&'"]/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    }[c]));
}

/**
 * Draws the interpolated box and a label onto the full frame.
 *
 * This is the image that proves the geometry. If the box is not on the animal it
 * is instantly visible, which no assertion about pixel counts achieves.
 *
 * @async
 * @param {string} framePath - PNG of the decoded frame.
 * @param {Object} rectangle - Output of {@link cropRectangle}.
 * @param {Object} labels - `{ observationId, frame, confidence, comname }`.
 * @param {string} outPath - Where to write the annotated JPEG.
 * @returns {Promise<void>}
 */
async function drawFrame(framePath, rectangle, labels, outPath) {
    const image = sharp(framePath);
    const { width, height } = await image.metadata();

    const { raw, square } = rectangle;
    const stroke = Math.max(2, Math.round(width / 640));

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${raw.left.toFixed(1)}" y="${raw.top.toFixed(1)}"
              width="${raw.width.toFixed(1)}" height="${raw.height.toFixed(1)}"
              fill="none" stroke="#00ff66" stroke-width="${stroke}"/>
        <rect x="${square.left.toFixed(1)}" y="${square.top.toFixed(1)}"
              width="${square.width.toFixed(1)}" height="${square.height.toFixed(1)}"
              fill="none" stroke="#ffcc00" stroke-width="${stroke}" stroke-dasharray="${stroke * 4},${stroke * 3}"/>
        <rect x="0" y="0" width="${width}" height="${Math.round(height * 0.06)}" fill="#000000" fill-opacity="0.65"/>
        <text x="12" y="${Math.round(height * 0.043)}" font-family="DejaVu Sans, Arial, sans-serif"
              font-size="${Math.round(height * 0.033)}" fill="#ffffff">${escapeXml(labels.line)}</text>
        <text x="${width - 12}" y="${Math.round(height * 0.043)}" text-anchor="end"
              font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(height * 0.026)}"
              fill="#00ff66">box &#8212; solid &#183; padded square &#8212; dashed</text>
    </svg>`;

    await image
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 88 })
        .toFile(outPath);
}

/**
 * Draws the same box read both ways, so F1 can be seen rather than trusted.
 *
 * F1 says the box is centre-origin and rests on three independent confirmations in
 * two other repositories. This is the one cheap chance to look at both readings on
 * a real animal. If the top-left reading is the one on the organism, a settled
 * finding is wrong and everything downstream of it is wrong with it.
 *
 * @async
 * @param {string} framePath - PNG of the decoded frame.
 * @param {Object} box - Normalised interpolated box.
 * @param {Object} labels - `{ line }`.
 * @param {string} outPath - Where to write the control JPEG.
 * @returns {Promise<void>}
 */
async function drawControl(framePath, box, labels, outPath) {
    const image = sharp(framePath);
    const { width, height } = await image.metadata();

    const boxWidth = box.width * width;
    const boxHeight = box.height * height;
    const stroke = Math.max(3, Math.round(width / 480));

    // Centre-origin: x, y is the middle of the box (F1, what the spec says).
    const centreLeft = (box.x * width) - (boxWidth / 2);
    const centreTop = (box.y * height) - (boxHeight / 2);

    // Top-left: x, y is the corner. The reading F1 rules out, drawn anyway.
    const cornerLeft = box.x * width;
    const cornerTop = box.y * height;

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${centreLeft.toFixed(1)}" y="${centreTop.toFixed(1)}"
              width="${boxWidth.toFixed(1)}" height="${boxHeight.toFixed(1)}"
              fill="none" stroke="#00ff66" stroke-width="${stroke}"/>
        <rect x="${cornerLeft.toFixed(1)}" y="${cornerTop.toFixed(1)}"
              width="${boxWidth.toFixed(1)}" height="${boxHeight.toFixed(1)}"
              fill="none" stroke="#ff2f6d" stroke-width="${stroke}"/>
        <rect x="0" y="0" width="${width}" height="${Math.round(height * 0.115)}" fill="#000000" fill-opacity="0.7"/>
        <text x="12" y="${Math.round(height * 0.042)}" font-family="DejaVu Sans, Arial, sans-serif"
              font-size="${Math.round(height * 0.030)}" fill="#ffffff">${escapeXml(labels.line)}</text>
        <text x="12" y="${Math.round(height * 0.079)}" font-family="DejaVu Sans, Arial, sans-serif"
              font-size="${Math.round(height * 0.028)}" fill="#00ff66">GREEN = centre-origin (F1, expected correct)</text>
        <text x="12" y="${Math.round(height * 0.110)}" font-family="DejaVu Sans, Arial, sans-serif"
              font-size="${Math.round(height * 0.028)}" fill="#ff2f6d">RED = top-left origin (the reading F1 rules out)</text>
    </svg>`;

    await image
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toFile(outPath);
}

/**
 * Lays the finished crops out in a grid, the way a reviewer sees a page.
 *
 * A tile that is fine on its own can still be unjudgeable at tile size, which is
 * the thing a contact sheet shows and a single crop does not.
 *
 * @async
 * @param {Array<Object>} tiles - `{ observationId, cropPath, caption }` per tile.
 * @param {string} outPath - Where to write the sheet.
 * @returns {Promise<void>}
 */
async function drawContactSheet(tiles, outPath) {
    const columns = 3;
    const gutter = 12;
    const captionHeight = 34;
    const cell = THUMB_SIZE;
    const rows = Math.ceil(tiles.length / columns);

    const sheetWidth = (columns * cell) + ((columns + 1) * gutter);
    const sheetHeight = (rows * (cell + captionHeight)) + ((rows + 1) * gutter);

    const composites = [];
    const captions = [];

    tiles.forEach((tile, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const left = gutter + (column * (cell + gutter));
        const top = gutter + (row * (cell + captionHeight + gutter));

        composites.push({ input: tile.cropPath, left, top });
        captions.push(`<text x="${left}" y="${top + cell + 24}" font-family="DejaVu Sans, Arial, sans-serif"
            font-size="17" fill="#ffffff">${escapeXml(tile.caption)}</text>`);
    });

    const svg = `<svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg">
        ${captions.join('\n')}
    </svg>`;

    await sharp({
        create: {
            width: sheetWidth,
            height: sheetHeight,
            channels: 3,
            background: { r: 24, g: 26, b: 30 },
        },
    })
        .composite(composites.concat([{ input: Buffer.from(svg), top: 0, left: 0 }]))
        .jpeg({ quality: 90 })
        .toFile(outPath);
}

/**
 * Runs the spike.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-thumb-spike-'));
    const report = { generatedAt: new Date().toISOString(), observations: [], failures: [], notes: [] };

    const observations = await loadObservations();

    console.log(`\n${observations.length} observations loaded.\n`);

    // Group by video_source: one video is one stream, whatever the frame count (R17).
    const byVideo = new Map();

    for (const observation of observations) {
        const key = observation.video_source;

        if (!byVideo.has(key)) {
            byVideo.set(key, []);
        }

        byVideo.get(key).push(observation);
    }

    const tiles = [];

    for (const [videoSource, group] of byVideo) {
        console.log(`video_source: ${videoSource}  (${group.length} observations)`);

        // Resolution goes through video_source, never jellyfin_item_id (F7, A8).
        let resolved;

        try {
            resolved = await jellyfinRepository.resolveVideoSource(videoSource, 1, {});
        } catch (error) {
            console.log(`  RESOLVE FAILED: ${error.message}`);
            report.failures.push({ videoSource, stage: 'resolve', error: error.message });
            continue;
        }

        console.log(`  match score ${resolved.score} on search term "${resolved.searchTerm}" -> item "${resolved.item.name}"`);

        if (resolved.score < MIN_MATCH_SCORE) {
            // A8: below the exact-match band is a permanent failure, not a lower bar.
            const message = `score ${resolved.score} is below the A8 threshold of ${MIN_MATCH_SCORE}; permanent failure, not extracted`;

            console.log(`  ${message}`);
            report.failures.push({ videoSource, stage: 'score', error: message, score: resolved.score });
            continue;
        }

        const streamUrl = await jellyfinRepository.buildDirectStreamUrl(resolved.item.id, {});

        const probe = await probeStream(streamUrl);

        console.log(`  stream: ${probe.width}x${probe.height} ${probe.codec} @ ${probe.fps} fps, ${probe.duration}s`);

        if (Math.abs(probe.fps - ASSUMED_FPS) > 0.01) {
            const note = `stream is ${probe.fps} fps but db/timecode.js assumes ${ASSUMED_FPS}; frame-to-time mapping uses the assumed rate and will land elsewhere`;

            console.log(`  WARNING: ${note}`);
            report.notes.push(note);
        }

        // Work out every wanted frame and its box before opening the stream.
        const wanted = [];

        for (const observation of group) {
            const mediaMs = parseTimeSpan(observation.mediaPosition);

            if (mediaMs === null) {
                report.failures.push({
                    observationId: observation.observation_id,
                    stage: 'timecode',
                    error: `mediaPosition "${observation.mediaPosition}" does not parse`,
                });
                continue;
            }

            const frame = absoluteFrame(mediaMs);
            const interpolated = interpolateBox(observation.keyframes, frame);

            if (!interpolated) {
                report.failures.push({
                    observationId: observation.observation_id,
                    stage: 'interpolate',
                    error: observation.keyframes.length
                        ? `frame ${frame} is outside the keyframe span [${observation.keyframes[0].framenum}, ${observation.keyframes[observation.keyframes.length - 1].framenum}]`
                        : 'observation has no keyframes; permanent failure',
                });
                continue;
            }

            const exact = observation.keyframes.some((k) => k.framenum === frame);

            wanted.push({ observation, mediaMs, frame, interpolated, exact });
        }

        wanted.sort((a, b) => a.frame - b.frame);

        // One stream for the lot. Six connections would be a fifth of Jellyfin's
        // whole ceiling, and that ceiling is shared with people watching video.
        const extraction = await extractFrames(
            streamUrl,
            wanted.map((w) => w.frame),
            ASSUMED_FPS,
            workDir
        );

        console.log(`  ffmpeg: ${extraction.files.length} frames in ${extraction.seconds.toFixed(1)}s from one stream`);

        if (extraction.files.length !== wanted.length) {
            report.failures.push({
                videoSource,
                stage: 'extract',
                error: `asked for ${wanted.length} frames, got ${extraction.files.length}`,
            });
        }

        for (let index = 0; index < wanted.length && index < extraction.files.length; index += 1) {
            const item = wanted[index];
            const framePath = extraction.files[index];
            const observationId = item.observation.observation_id;

            const metadata = await sharp(framePath).metadata();

            // R6: the crop is computed from the decoded frame's own dimensions,
            // never from a stored or assumed size.
            const rectangle = cropRectangle(item.interpolated.box, metadata.width, metadata.height);

            const ptsTime = extraction.ptsTimes[index];
            const landedFrame = ptsTime === undefined ? null : Math.round(ptsTime * ASSUMED_FPS);

            const framedPath = path.join(OUT_DIR, `obs-${observationId}-frame.jpg`);
            const cropPath = path.join(OUT_DIR, `obs-${observationId}-crop.jpg`);

            const confidence = Number(item.observation.confidence);

            await drawFrame(
                framePath,
                rectangle,
                {
                    line: `obs ${observationId} · frame ${item.frame} · conf ${confidence.toFixed(3)} · ${item.observation.comname}`,
                },
                framedPath
            );

            await sharp(framePath)
                .extract({
                    left: rectangle.clamped.left,
                    top: rectangle.clamped.top,
                    width: rectangle.clamped.width,
                    height: rectangle.clamped.height,
                })
                .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
                .jpeg({ quality: 88 })
                .toFile(cropPath);

            // The control, for the one observation with the most keyframes and the
            // largest boxes: the box drawn both ways so F1 can be seen (task brief).
            if (observationId === 4) {
                await drawControl(
                    framePath,
                    item.interpolated.box,
                    { line: `obs ${observationId} · frame ${item.frame} · centre-origin vs top-left` },
                    path.join(OUT_DIR, `obs-${observationId}-control.jpg`)
                );
            }

            tiles.push({
                observationId,
                cropPath,
                caption: `obs ${observationId} · f${item.frame} · conf ${confidence.toFixed(2)}`,
            });

            report.observations.push({
                observationId,
                videoSource,
                matchScore: resolved.score,
                jellyfinItemName: resolved.item.name,
                mediaPosition: item.observation.mediaPosition,
                observationFrame: item.frame,
                exactKeyframe: item.exact,
                before: {
                    framenum: item.interpolated.before.framenum,
                    x: Number(item.interpolated.before.x),
                    y: Number(item.interpolated.before.y),
                    width: Number(item.interpolated.before.width),
                    height: Number(item.interpolated.before.height),
                },
                after: {
                    framenum: item.interpolated.after.framenum,
                    x: Number(item.interpolated.after.x),
                    y: Number(item.interpolated.after.y),
                    width: Number(item.interpolated.after.width),
                    height: Number(item.interpolated.after.height),
                },
                ratio: item.interpolated.ratio,
                interpolated: item.interpolated.box,
                sourceWidth: metadata.width,
                sourceHeight: metadata.height,
                extractedPtsTime: ptsTime,
                extractedFrame: landedFrame,
                frameDelta: landedFrame === null ? null : landedFrame - item.frame,
                boxPixels: rectangle.raw,
                cropPixels: rectangle.clamped,
                wasClamped: rectangle.wasClamped,
                boxAreaFraction: item.interpolated.box.width * item.interpolated.box.height,
                confidence,
                comname: item.observation.comname,
                framedImage: framedPath,
                cropImage: cropPath,
            });

            console.log(`  obs ${observationId}: frame ${item.frame} (landed ${landedFrame}), box ${rectangle.raw.width.toFixed(0)}x${rectangle.raw.height.toFixed(0)}px, crop ${rectangle.clamped.width}x${rectangle.clamped.height}px`);
        }

        report.notes.push(`ffmpeg command (token elided): ${extraction.command}`);
        report.notes.push(`one stream for ${wanted.length} frames, ${extraction.seconds.toFixed(1)}s wall clock`);
    }

    if (tiles.length) {
        tiles.sort((a, b) => a.observationId - b.observationId);
        await drawContactSheet(tiles, path.join(OUT_DIR, 'contact-sheet.jpg'));
    }

    fs.writeFileSync(
        path.join(OUT_DIR, 'summary.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );

    console.log(`\nWrote ${tiles.length} crops, ${tiles.length} annotated frames, a contact sheet and summary.json to:\n  ${OUT_DIR}\n`);

    if (report.failures.length) {
        console.log('Failures:');
        report.failures.forEach((failure) => console.log(`  ${JSON.stringify(failure)}`));
    }

    fs.rmSync(workDir, { recursive: true, force: true });
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(elideToken(error.stack || error.message));
        await db.sequelize.close();
        process.exit(1);
    });
