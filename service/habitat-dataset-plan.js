/**
 * Choosing a habitat dataset's frames from annotated habitat stretches (#287).
 *
 * Pure functions over rows, as `dataset-build-plan.js` is for species datasets: no database
 * and no ffmpeg, so the rules can be tested in milliseconds.
 *
 * Settled with Isaac (MARP_API#287, 2026-11-10), from the feasibility work's `plan.js`:
 *
 * - **A frame every 10 s inside the stretches**, on each video file's own 10 s grid.
 * - **At least 2 s from any change of substrate**, the start or end of any stretch of the
 *   session, so a frame is never labelled with a boundary the annotator placed by eye.
 * - **A moment no stretch covers is a gap, not bare seabed**: it is skipped, never labelled
 *   with nothing.
 * - **Labels are a yes/no per substrate**, several at once: Cobble and Boulder are almost
 *   always recorded on top of a base substrate.
 * - **Whole dives go to training, tuning or test**, 70/15/15 within each project, with the
 *   feasibility plan's seeded shuffle, so the same dives land in the same splits and scores
 *   stay comparable with the feasibility results.
 *
 * Which sessions are fed in, and how non-seabed frames are thrown out, are decided
 * elsewhere (open assumptions A8 and A9 on #287).
 *
 * @fileoverview Frames, labels and dive splits for a habitat dataset build.
 * @module service/habitat-dataset-plan
 */

'use strict';

/** The substrates, in the order a frame's labels are listed. */
const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];

/** One frame every this many milliseconds of a file. */
const STEP_MS = 10000;

/** No frame within this many milliseconds of any stretch's start or end. */
const MARGIN_MS = 2000;

/** Each project's dives go to these splits in these shares; test takes what is left. */
const DIVE_SHARES = { train: 0.7, val: 0.15, test: 0.15 };

/** The feasibility plan's seed, so its dive split is reproduced. */
const SPLIT_SEED = 287;

/**
 * A seeded shuffle: the feasibility plan's, kept exactly so the same seed gives the same order.
 *
 * @param {Array} list
 * @param {number} seed
 * @returns {Array} A shuffled copy.
 */
function seededShuffle(list, seed) {
    let s = seed;
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * Assign each project's dives to a split, whole.
 *
 * @param {Array<{project: string, dive: string}>} lines - One entry per line; a dive may repeat.
 * @param {Object} [options] - `{ shares, seed }`.
 * @returns {Map<string, string>} `project|dive` to `train`, `val` or `test`.
 */
function splitDives(lines, { shares = DIVE_SHARES, seed = SPLIT_SEED } = {}) {
    const byProject = new Map();
    for (const { project, dive } of lines) {
        if (!byProject.has(project)) byProject.set(project, new Set());
        byProject.get(project).add(dive);
    }

    const out = new Map();
    for (const [project, dives] of byProject) {
        // Sorted first, so the shuffle does not depend on the order rows arrived in.
        const order = seededShuffle([...dives].sort(), seed);
        let k = 0;
        for (const [split, share] of Object.entries(shares)) {
            const n = split === 'test' ? order.length - k : Math.round(share * order.length);
            for (const dive of order.slice(k, k + n)) out.set(`${project}|${dive}`, split);
            k += n;
        }
    }
    return out;
}

/**
 * The frames one annotated session yields, with their labels.
 *
 * A stretch is `{ name, file, startMs, endMs }` in the file's own time (`mediaPosition` and
 * its length), plus `offsetMs`, the file's start on the session's clock, so changes in two
 * files of one session are compared on one clock.
 *
 * @param {Array<Object>} stretches - One session's habitat stretches.
 * @param {Object} [options] - `{ stepMs, marginMs, substrates }`.
 * @returns {Array<{file: string, positionMs: number, labels: Array<number>}>} In file, then
 *   position order.
 */
function framesForSession(stretches, { stepMs = STEP_MS, marginMs = MARGIN_MS, substrates = SUBSTRATES } = {}) {
    const known = stretches.filter((s) => substrates.includes(s.name) && s.endMs >= s.startMs);
    const clock = (s) => ({ a: s.startMs + s.offsetMs, b: s.endMs + s.offsetMs });
    const edges = known.flatMap((s) => { const c = clock(s); return [c.a, c.b]; });

    const files = [...new Set(known.map((s) => s.file))].sort();
    const frames = [];
    for (const file of files) {
        const own = known.filter((s) => s.file === file);
        const offset = own[0].offsetMs;
        const from = Math.min(...own.map((s) => s.startMs));
        const to = Math.max(...own.map((s) => s.endMs));

        for (let p = Math.max(0, Math.ceil(from / stepMs) * stepMs); p <= to; p += stepMs) {
            const t = p + offset;
            if (edges.some((e) => Math.abs(e - t) < marginMs)) continue;
            const covering = known.filter((s) => { const c = clock(s); return c.a <= t && t <= c.b; });
            if (!covering.length) continue;
            frames.push({
                file,
                positionMs: p,
                labels: substrates.map((n) => (covering.some((s) => s.name === n) ? 1 : 0)),
            });
        }
    }
    return frames;
}

module.exports = {
    SUBSTRATES,
    STEP_MS,
    MARGIN_MS,
    DIVE_SHARES,
    SPLIT_SEED,
    seededShuffle,
    splitDives,
    framesForSession,
};
