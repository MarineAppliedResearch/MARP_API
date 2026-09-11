/**
 * Puts one dive's video through the inference pipeline: resolve, session, job.
 *
 * This replaces a family of hand-copied one-off scripts -- `create-session-diveN`,
 * `jf-window-dN`, `submit-job-diveN` -- that were duplicated per dive and edited
 * in place. Three dives went in that way and each copy drifted: a different
 * frame rate assumption, a different window rule, a different line number typed
 * by hand. Copying a script per dive is the thing this exists to stop.
 *
 * What it does for a dive:
 *
 *   1. finds the dive's folder in a Jellyfin library and lists its videos;
 *   2. discards the launch clip and anything too short to hold a window;
 *   3. ffprobes the chosen file for its *real* frame rate -- never assumed,
 *      because the ingest and the thumbnail extractor both refuse a source that
 *      is not 25 fps and the refusal arrives a long way from the cause;
 *   4. finds or creates the session, `type = 'Invert'`;
 *   5. submits one GPU job, split into pieces, over the middle window.
 *
 * Dry run by default; `--apply` writes. Idempotent per dive: the session is
 * matched on project + dive + type, and a job is not submitted twice for the
 * same video and session. Safe to run one dive at a time, which is the point --
 * one dive failing must not cost the other six.
 *
 * Usage:
 *   node scripts/process-dive.js --dive 4                 # what it would do
 *   node scripts/process-dive.js --dive 4,12,20
 *   node scripts/process-dive.js --dive 4 --apply
 *   node scripts/process-dive.js --dive 4 --item <jellyfin item id>
 *   node scripts/process-dive.js --dive 4 --library CAMPA2024 --project CAMPA2024
 *
 * @fileoverview Per-dive coordinator for a development inference run.
 * @author Isaac Travers
 * @module scripts/process-dive
 */

'use strict';

require('dotenv').config();

const { execFile } = require('child_process');

const db = require('../model');
const gpuService = require('../service/gpu.service');
const jellyfinRepository = require('../repository/jellyfin.repository');
const { MEDIA_CLIENT_IDENTITY, FFPROBE_PATH, FPS_TOLERANCE } = require('../config/thumbnails');
const { ASSUMED_FPS } = require('../db/timecode');

const { QueryTypes } = db.Sequelize;

/**
 * Jellyfin library and MARP project browsed by default.
 *
 * The two are separate arguments because they are separate things -- a library
 * is Jellyfin's folder of video, a project is a MARP row -- and nothing
 * guarantees they are named alike. They usually are, so one default serves both.
 *
 * @constant
 * @type {string}
 */
const DEFAULT_LIBRARY = 'CAMPA2026';

/**
 * Seconds of video a run covers.
 *
 * Ten minutes, which is what the three dives already in the development corpus
 * used -- 15,000 frames at 25 fps. Kept the same so the dives are comparable to
 * each other rather than each being its own experiment.
 *
 * @constant
 * @type {number}
 */
const WINDOW_SECONDS = 600;

/**
 * Frames per submitted piece.
 *
 * 2,700, matching the existing corpus. This is a unit of GPU work rather than a
 * unit of time, so it stays a frame count if a source ever turns out not to be
 * 25 fps.
 *
 * @constant
 * @type {number}
 */
const PIECE_FRAMES = 2700;

/**
 * Video shorter than this is treated as a launch clip rather than survey video.
 *
 * Every CAMPA2026 dive but two opens with a 18-56 second clip of the ROV going
 * over the side. **Two do not** -- Dive 34 and Dive 37 start straight into 20
 * minutes of real video -- so "skip the first file" would have thrown those away.
 * The rule is therefore about duration, not position.
 *
 * @constant
 * @type {number}
 */
const LAUNCH_CLIP_SECONDS = 60;

/**
 * Seconds that must remain either side of the window.
 *
 * Without it, a file barely longer than the window yields a "middle" that is the
 * whole file, descent included, and calling that the middle of the dive would be
 * untrue rather than merely imprecise.
 *
 * @constant
 * @type {number}
 */
const MIN_MARGIN_SECONDS = 60;

/**
 * Jellyfin ticks in one second.
 *
 * @constant
 * @type {number}
 */
const TICKS_PER_SECOND = 10000000;

/**
 * The registered model the run uses, as the job spec names it.
 *
 * `ml_model_id` must be the row `scripts/seed-inference-context.js` seeds, or the
 * ingest cannot attribute the observations. `url` is a path on the machine
 * holding the weights and nothing here dereferences it; override both from the
 * environment on a machine that keeps them elsewhere.
 *
 * @constant
 * @type {Object}
 */
const MODEL = {
    name: process.env.MARP_MODEL_NAME || 'CAMPA_GR1_TEST6-mixed',
    sha256: process.env.MARP_MODEL_SHA256
        || '9283b8ee1d1ac22ddfe5e8394a95c950cf65e1dfce3c772a1559c0408f52cff8',
    url: process.env.MARP_MODEL_WEIGHTS
        || 'C:/Users/isaac/Documents/Workspace/marp-inference-worker/models/CAMPA_GR1_TEST6/mixed/weights/best.pt',
    ml_model_id: Number(process.env.MARP_ML_MODEL_ID || 91),
};

/**
 * Session type, and so which species list the ingest reads class names against.
 *
 * `Invert` maps to `Inverts` in `db/species-lists.js`. The model is an inverts
 * model and `checkSessionTypeAgainstModel` refuses it in a `Fish` session, so
 * this is a requirement rather than a default.
 *
 * @constant
 * @type {string}
 */
const SESSION_TYPE = 'Invert';

/**
 * Jellyfin's host, so it can be kept out of anything printed.
 *
 * A stream URL carries both the host and an `api_key`. A previous run elided only
 * the key and leaked the host through an ffmpeg error message, so the host is
 * removed here as well and any bare address after it.
 *
 * @constant
 * @type {?string}
 */
const JELLYFIN_HOST = (() => {
    try {
        return new URL(process.env.JELLYFIN_BASE_URL).host;
    } catch {
        return null;
    }
})();

/**
 * Remove the media credential, the Jellyfin host and any bare address from text.
 *
 * @param {*} value - Anything printable.
 * @returns {string} The text with those three things taken out.
 */
function scrub(value) {
    let out = String(value).replace(/api_key=[^&\s"]*/g, 'api_key=REDACTED');

    if (JELLYFIN_HOST) {
        out = out.split(JELLYFIN_HOST).join('<jellyfin>');
    }

    return out
        .replace(/https?:\/\/[^\s/"']+/g, '<jellyfin>')
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<host>');
}

/**
 * Read `--name value` from argv.
 *
 * @param {string} name - Flag name without the dashes.
 * @param {*} [fallback=null] - Value when the flag is absent.
 * @returns {*} The flag's value, or the fallback.
 */
function flag(name, fallback = null) {
    const at = process.argv.indexOf(`--${name}`);

    return at === -1 || at === process.argv.length - 1 ? fallback : process.argv[at + 1];
}

/**
 * Run a binary, with its output scrubbed on failure.
 *
 * The stream URL is passed as an argv element and never through a shell, so it
 * cannot reach a process listing via a command line the shell expanded.
 *
 * @async
 * @param {string} binary - Executable.
 * @param {Array<string>} args - Arguments.
 * @returns {Promise<string>} stdout.
 * @throws {Error} With a scrubbed message.
 */
function run(binary, args) {
    return new Promise((resolve, reject) => {
        execFile(binary, args, { maxBuffer: 1 << 26 }, (error, stdout) => {
            if (error) {
                reject(new Error(scrub(error.message)));

                return;
            }

            resolve(stdout);
        });
    });
}

/**
 * Find a Jellyfin library by display name.
 *
 * @async
 * @param {string} name - Library name.
 * @returns {Promise<Object>} The library item.
 * @throws {Error} When no library carries that name.
 */
async function findLibrary(name) {
    const libraries = await jellyfinRepository.getLibraries(MEDIA_CLIENT_IDENTITY);
    const match = libraries.find((library) => library.name === name);

    if (!match) {
        throw new Error(
            `Jellyfin has no library called "${name}". It has: ${libraries.map((l) => l.name).join(', ')}.`
        );
    }

    return match;
}

/**
 * Find one dive's folder inside a library.
 *
 * Matched on the folder name exactly, which is `Dive N` in both CAMPA2024 and
 * CAMPA2026. A library shaped differently fails here rather than picking
 * something that merely looks close.
 *
 * @async
 * @param {Object} library - The library item.
 * @param {string} dive - Folder name, e.g. `Dive 4`.
 * @returns {Promise<Object>} The dive folder item.
 * @throws {Error} When the library holds no such folder.
 */
async function findDiveFolder(library, dive) {
    const children = await jellyfinRepository.getChildItems(library.id, MEDIA_CLIENT_IDENTITY);
    const match = children.find((child) => child.isFolder && child.name === dive);

    if (!match) {
        const folders = children.filter((child) => child.isFolder).length;

        throw new Error(
            `"${library.name}" has no folder called "${dive}" -- it holds ${folders} folders. `
            + 'A library laid out some other way needs its own resolution rather than this one.'
        );
    }

    return match;
}

/**
 * List a dive's videos, oldest first, with their durations.
 *
 * Ordered by name because the names are timestamps, which is also chronological.
 *
 * @async
 * @param {Object} folder - The dive folder item.
 * @returns {Promise<Array<Object>>} `{id, name, path, seconds}` per video.
 */
async function listDiveVideos(folder) {
    const children = await jellyfinRepository.getChildItems(folder.id, MEDIA_CLIENT_IDENTITY);

    return children
        .filter((child) => !child.isFolder)
        .map((child) => ({
            id: child.id,
            name: child.name,
            path: child.path,
            seconds: child.runtimeTicks ? child.runtimeTicks / TICKS_PER_SECOND : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read a source's real frame rate and duration.
 *
 * Both come from ffprobe rather than from Jellyfin's runtime, because the frame
 * range is computed from them and a run is refused downstream if the rate is not
 * what `db/timecode.js` assumed.
 *
 * @async
 * @param {string} itemId - Jellyfin item id.
 * @returns {Promise<Object>} `{fps, seconds, width, height, codec}`.
 */
async function probeSource(itemId) {
    const url = await jellyfinRepository.buildDirectStreamUrl(itemId, MEDIA_CLIENT_IDENTITY);
    const output = await run(FFPROBE_PATH, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,codec_name',
        '-show_entries', 'format=duration',
        '-of', 'json',
        url,
    ]);

    const probe = JSON.parse(output);
    const stream = probe.streams && probe.streams[0];

    if (!stream) {
        throw new Error(`ffprobe found no video stream in Jellyfin item ${itemId}.`);
    }

    const [numerator, denominator] = String(stream.r_frame_rate).split('/').map(Number);

    return {
        fps: denominator ? numerator / denominator : null,
        rFrameRate: stream.r_frame_rate,
        seconds: Number(probe.format.duration),
        width: stream.width,
        height: stream.height,
        codec: stream.codec_name,
    };
}

/**
 * Choose the file a dive's window comes from.
 *
 * The longest eligible file, which is deterministic and leaves the most video
 * either side of the window. It is a mechanical rule and cannot see content: the
 * first three dives in the corpus had their windows chosen after looking at
 * sampled frames, and this does not do that. The dry run prints every eligible
 * file so a different one can be named with `--item`.
 *
 * @param {Array<Object>} videos - The dive's videos, oldest first.
 * @param {number} windowSeconds - Seconds the window covers.
 * @returns {Object} `{chosen, eligible, launch, rejected}`.
 */
function chooseVideo(videos, windowSeconds) {
    const needed = windowSeconds + (2 * MIN_MARGIN_SECONDS);
    const launch = videos.length > 0 && videos[0].seconds <= LAUNCH_CLIP_SECONDS ? videos[0] : null;
    const eligible = [];
    const rejected = [];

    for (const video of videos) {
        if (video === launch) {
            continue;
        }

        (video.seconds >= needed ? eligible : rejected).push(video);
    }

    const chosen = eligible.slice().sort((a, b) => b.seconds - a.seconds)[0] || null;

    return { chosen, eligible, launch, rejected, needed };
}

/**
 * Centre the window in the file.
 *
 * Half-open, as `submitJobs` requires: `end_frame` is one past the last frame.
 *
 * @param {number} fps - Real frame rate.
 * @param {number} seconds - Real duration.
 * @param {number} windowSeconds - Seconds the window covers.
 * @returns {Object} `{startFrame, endFrame, totalFrames, windowFrames}`.
 */
function centreWindow(fps, seconds, windowSeconds) {
    const totalFrames = Math.floor(seconds * fps);
    const windowFrames = Math.round(windowSeconds * fps);
    const startFrame = Math.floor((totalFrames - windowFrames) / 2);

    return { startFrame, endFrame: startFrame + windowFrames, totalFrames, windowFrames };
}

/**
 * Resolve a project by name.
 *
 * Never created here. A project is survey context of the same kind as the model
 * and the species rows, and those belong to `scripts/seed-inference-context.js`
 * -- the script the runbook says to re-run after a rebuild. A project created
 * only by this script would vanish on a rebuild and re-running the seeder would
 * not bring it back, which is the exact failure the seeder exists to prevent.
 *
 * A dry run reports a missing project rather than refusing, so the plan for a
 * project that has not been seeded yet is still visible -- which is the whole
 * point of a dry run. Only `--apply` treats it as an error.
 *
 * @async
 * @param {string} name - Project name.
 * @param {boolean} apply - Whether this run intends to write.
 * @returns {Promise<Object>} The project row, or a placeholder in a dry run.
 * @throws {Error} When no project carries that name and the run would write.
 */
async function resolveProject(name, apply) {
    const rows = await db.sequelize.query(
        'SELECT project_id, name FROM projects WHERE name = $1',
        { bind: [name], type: QueryTypes.SELECT, logging: false }
    );

    if (rows.length === 0) {
        if (!apply) {
            console.log(`project       "${name}" is not seeded yet -- `
                + '`node scripts/seed-inference-context.js --apply` creates it.');

            return { project_id: null, name };
        }

        throw new Error(
            `No project called "${name}". Projects are seeded, not created here -- `
            + 'run `node scripts/seed-inference-context.js --apply` and try again.'
        );
    }

    if (rows.length > 1) {
        throw new Error(
            `${rows.length} projects are called "${name}", so nothing here can say which one the dive belongs to.`
        );
    }

    return rows[0];
}

/**
 * The next unused line number in the synthetic development series.
 *
 * **These are not survey line numbers.** Neither CAMPA2024's nor CAMPA2026's
 * Jellyfin paths carry one -- a dive folder and a timestamp is all there is -- so
 * there is no real line to preserve and one is not invented. The existing corpus
 * used 1000, 1001 and 1002, and this continues that series so a development
 * session is recognisably development data. Pass `--line` to override.
 *
 * Read once per run so several dives in one invocation get consecutive numbers.
 *
 * @async
 * @returns {Promise<number>} The next free number.
 */
async function nextSyntheticLine() {
    const rows = await db.sequelize.query(
        `SELECT COALESCE(MAX(line::bigint), 999) AS highest
           FROM sessions WHERE line ~ '^[0-9]+$'`,
        { type: QueryTypes.SELECT, logging: false }
    );

    return Number(rows[0].highest) + 1;
}

/**
 * Find the session for a dive, or say what creating one would look like.
 *
 * Matched on project, dive and type, which is what makes a second run of the
 * same dive reuse the session rather than add another. Two sessions for one dive
 * would split the dive's observations across them silently.
 *
 * @async
 * @param {Object} project - The project row.
 * @param {string} dive - Dive name.
 * @param {number} line - Line to record on a new session.
 * @param {boolean} apply - Whether to create it.
 * @returns {Promise<Object>} `{session, created}`; `session` is null in a dry
 * run that would have created one.
 */
async function findOrCreateSession(project, dive, line, apply) {
    if (project.project_id === null) {
        // Dry run against an unseeded project: there can be no session yet.
        return { session: null, created: true };
    }

    const existing = await db.sequelize.query(
        `SELECT session_id, project_id, dive, line, "lineId", type
           FROM sessions
          WHERE project_id = $1 AND dive = $2 AND type = $3
          ORDER BY session_id`,
        { bind: [project.project_id, dive, SESSION_TYPE], type: QueryTypes.SELECT, logging: false }
    );

    if (existing.length > 1) {
        throw new Error(
            `${existing.length} ${SESSION_TYPE} sessions already exist for ${project.name} / ${dive} `
            + `(${existing.map((s) => s.session_id).join(', ')}). Nothing here can choose between them.`
        );
    }

    if (existing.length === 1) {
        return { session: existing[0], created: false };
    }

    if (!apply) {
        return { session: null, created: true };
    }

    // Through the model, so the application's own defaults and timestamps are
    // what wrote the row. `session_id` is autoIncrement on this model, unlike
    // `observations` -- see AGENTS.md, *Primary keys are assigned inconsistently*.
    const created = await db.sessions.create({
        project_id: project.project_id,
        dive,
        line: String(line),
        lineId: String(line),
        type: SESSION_TYPE,
    });

    return { session: created.get({ plain: true }), created: true };
}

/**
 * Jobs already submitted for this video and session.
 *
 * The idempotency check that matters: a second run must not queue the same
 * fifteen thousand frames again. Keyed on the video item and the session rather
 * than on the frame range, because a range that shifted by one frame is still
 * the same work.
 *
 * @async
 * @param {string} itemId - Jellyfin item id.
 * @param {number} sessionId - Session the jobs write into.
 * @returns {Promise<Array<Object>>} `{id, state}` per existing job.
 */
async function existingJobs(itemId, sessionId) {
    return db.sequelize.query(
        `SELECT id, state FROM gpu_jobs
          WHERE spec->'video'->>'jellyfin_item_id' = $1
            AND spec->'session'->>'session_id' = $2
          ORDER BY id`,
        { bind: [itemId, String(sessionId)], type: QueryTypes.SELECT, logging: false }
    );
}

/**
 * Build the job spec for a window.
 *
 * `video` carries only the Jellyfin item id: the coordinator resolves it to a
 * playable URL when a worker leases the job, so no media credential is stored in
 * the queue and the worker is given no Jellyfin credentials of its own.
 *
 * @param {string} itemId - Jellyfin item id.
 * @param {number} sessionId - Session to write into.
 * @param {Object} window - `{startFrame, endFrame}`.
 * @returns {Object} The spec.
 */
function buildSpec(itemId, sessionId, window) {
    return {
        engine: 'marp_tracking',
        model: { ...MODEL },
        video: { jellyfin_item_id: itemId },
        session: { session_id: sessionId },
        range: { start_frame: window.startFrame, end_frame: window.endFrame },
        reduction: { name: 'v3_dirpad', version: 1 },
        params: {},
    };
}

/**
 * Do one dive, or report what doing it would involve.
 *
 * @async
 * @param {Object} options - `{library, project, dive, itemId, line, windowSeconds, pieceFrames, apply}`.
 * @returns {Promise<boolean>} Whether the dive took the line number it was
 * offered, so a dive that reused an existing session does not consume one.
 */
async function processDive(options) {
    const { library, project, dive, apply } = options;

    const projectLabel = project.project_id === null ? `${project.name}, unseeded` : `${project.project_id} ${project.name}`;

    console.log(`\n== ${dive} (${library.name} -> project ${projectLabel}) ==`);

    const videos = await listDiveVideos(library.folder);
    const pick = chooseVideo(videos, options.windowSeconds);

    if (pick.launch) {
        console.log(`  launch clip   ${pick.launch.name}  ${pick.launch.seconds.toFixed(1)}s  (skipped)`);
    } else {
        console.log('  launch clip   none -- this dive opens straight into survey video');
    }

    for (const video of pick.rejected) {
        console.log(`  too short     ${video.name}  ${video.seconds.toFixed(1)}s  `
            + `(needs ${pick.needed}s for a ${options.windowSeconds}s middle)`);
    }

    // Every eligible file, so the one that was not chosen is visible rather than
    // silently discarded. `--item` names a different one.
    for (const video of pick.eligible) {
        console.log(`  eligible      ${video.name}  ${video.seconds.toFixed(1)}s`);
    }

    const chosen = options.itemId
        ? videos.find((video) => video.id === options.itemId)
        : pick.chosen;

    if (!chosen) {
        console.log(options.itemId
            ? `  NOTHING TO DO -- item ${options.itemId} is not in ${dive}.`
            : `  NOTHING TO DO -- no file in ${dive} is long enough for a ${options.windowSeconds}s middle.`);

        return false;
    }

    const probe = await probeSource(chosen.id);

    console.log(`  chosen        ${chosen.name}  item=${chosen.id}`);
    console.log(`  source        ${probe.codec} ${probe.width}x${probe.height}  `
        + `r_frame_rate=${probe.rFrameRate} (${probe.fps} fps)  ${probe.seconds.toFixed(3)}s`);

    // Refused here rather than discovered at ingest. `db/timecode.js` derives
    // every timecode column at 25 fps and `observation-ingest` rejects a run whose
    // tc disagrees; the thumbnail extractor refuses to seek for the same reason.
    // A source at another rate produces a run that fails hours later, from a
    // place that does not mention the frame rate.
    if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - ASSUMED_FPS) > FPS_TOLERANCE) {
        console.log(`  REFUSED -- ${probe.fps} fps, but MARP derives every timecode column at `
            + `${ASSUMED_FPS} fps (tolerance ${FPS_TOLERANCE}). The ingest would reject the observations `
            + 'and the thumbnail extractor would refuse to seek.');

        return false;
    }

    const window = centreWindow(probe.fps, probe.seconds, options.windowSeconds);
    const startSeconds = window.startFrame / probe.fps;

    console.log(`  window        frames ${window.startFrame}..${window.endFrame} (half-open, `
        + `${window.windowFrames} frames) of ${window.totalFrames}`);
    console.log(`  window        ${startSeconds.toFixed(1)}s..${(startSeconds + options.windowSeconds).toFixed(1)}s  `
        + `margin ${startSeconds.toFixed(1)}s either side`);

    const { session, created } = await findOrCreateSession(project, dive, options.line, apply);

    if (!session) {
        console.log(`  session       would create: ${dive} / line ${options.line} (synthetic) / ${SESSION_TYPE}`);
        console.log(`  job           would submit ${Math.ceil(window.windowFrames / options.pieceFrames)} pieces `
            + `of ${options.pieceFrames} frames against ml_models ${MODEL.ml_model_id}`);

        return true;
    }

    console.log(`  session       ${session.session_id}  line ${session.line}  ${session.type}  `
        + `(${created ? 'created' : 'existing'})`);

    const already = await existingJobs(chosen.id, session.session_id);

    if (already.length > 0) {
        const states = already.reduce((counts, job) => {
            counts[job.state] = (counts[job.state] || 0) + 1;

            return counts;
        }, {});

        console.log(`  job           ${already.length} already submitted for this video and session `
            + `(${Object.entries(states).map(([s, n]) => `${n} ${s}`).join(', ')}). Nothing to do.`);

        return created;
    }

    const spec = buildSpec(chosen.id, session.session_id, window);

    if (!apply) {
        console.log(`  job           would submit ${Math.ceil(window.windowFrames / options.pieceFrames)} pieces `
            + `of ${options.pieceFrames} frames against ml_models ${MODEL.ml_model_id}`);

        return created;
    }

    // In process rather than over HTTP: this is the application's own validation
    // and splitting, without needing a running server or an operator token in a
    // file. `principal` is null, so `created_by` is null -- nobody signed in.
    const result = await gpuService.submitJobs(
        { kind: 'inference', spec, piece_frames: options.pieceFrames },
        null
    );

    console.log(`  job           ${result.jobs.length} queued: ${result.jobs.map((j) => j.id).join(', ')}`
        + `${result.batch_id ? `  batch ${result.batch_id}` : ''}`);

    return created;
}

/**
 * Entry point.
 *
 * @async
 * @returns {Promise<void>} Resolves when the process may exit.
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const libraryName = flag('library', DEFAULT_LIBRARY);
    const projectName = flag('project', libraryName);
    const windowSeconds = Number(flag('window', WINDOW_SECONDS));
    const pieceFrames = Number(flag('piece', PIECE_FRAMES));
    const itemId = flag('item');

    const dives = String(flag('dive', ''))
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map((part) => (/^\d+$/.test(part) ? `Dive ${part}` : part));

    if (dives.length === 0) {
        throw new Error('Name at least one dive: --dive 4, or --dive 4,12,20.');
    }

    if (itemId && dives.length > 1) {
        throw new Error('--item names one file, so it can only be used with one --dive.');
    }

    console.log(apply
        ? `Processing ${dives.length} dive(s) in ${libraryName}:`
        : `Dry run over ${dives.length} dive(s) in ${libraryName} -- pass --apply to write:`);

    try {
        const jellyfinLibrary = await findLibrary(libraryName);
        const project = await resolveProject(projectName, apply);
        const firstLine = flag('line') ? Number(flag('line')) : await nextSyntheticLine();

        let lineOffset = 0;

        for (const dive of dives) {
            // One dive failing must not cost the rest: the corpus is built up a
            // dive at a time and six good runs are worth more than an atomic seven.
            try {
                const folder = await findDiveFolder(jellyfinLibrary, dive);

                const consumed = await processDive({
                    library: { name: libraryName, folder },
                    project,
                    dive,
                    itemId,
                    line: firstLine + lineOffset,
                    windowSeconds,
                    pieceFrames,
                    apply,
                });

                if (consumed) {
                    lineOffset += 1;
                }
            } catch (error) {
                console.log(`\n== ${dive} ==\n  FAILED -- ${scrub(error.message)}`);
            }
        }

        console.log(apply ? '\nDone.' : '\nNothing written.');
    } finally {
        await db.sequelize.close();
    }
}

main().catch((error) => {
    console.error(scrub(error.message));
    process.exit(1);
});
