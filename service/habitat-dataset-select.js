/**
 * What a habitat dataset build takes, and which of its frames it throws out (#287).
 *
 * Settled with Isaac on 2026-11-10 (#287, questions 8 to 10):
 *
 * - **Chosen like any build**: the Mosaic's filters pick the sessions, and a frame goes in when
 *   the stretches over it are promoted for training -- which is what promoting its segment in the
 *   Mosaic does. A model's habitat stretches can go in once reviewed and promoted, like anyone's.
 * - **Frames as the feasibility plan took them** (`habitat-dataset-plan.js`): every 10 s inside
 *   the stretches, 2 s clear of any change of substrate; a frame's labels are the substrates over
 *   it -- its segment's combination. A frame labelled Mud and Sand goes in as labelled.
 * - **Whole dives per split**, 70/15/15 within each project, the feasibility shuffle.
 * - **A session whose times drift within a file is left out** and listed, since its frames would
 *   be cut at the wrong moment.
 * - **Non-seabed frames are thrown out and listed with their reason**: a nearly flat frame is a
 *   blank screen, and one close to a stored example is "Device Unplugged" or the End Line card
 *   (`db/habitat-reject-screens.json`).
 *
 * @fileoverview Selecting a habitat dataset's frames, and rejecting non-seabed ones.
 * @module service/habitat-dataset-select
 */

'use strict';

const db = require('../model');
const { parseTimeSpan } = require('../db/timecode');
const { binder, predicates } = require('../repository/mosaic.repository');
const plan = require('./habitat-dataset-plan');
const REJECT = require('../db/habitat-reject-screens.json');

/** The session type whose observations are habitat stretches. */
const HABITAT_TYPE = 'Habitat';

/** The training decision that puts a stretch in a dataset. */
const PROMOTED = 'promoted';

/** A frame this flat, as the spread of its 32 x 18 greyscale, is a blank screen. */
const BLANK_SPREAD = 2;

/** A frame within this much of an example screen, on average per pixel, is that screen. */
const MAX_DIFF = 12;

/**
 * The habitat stretches a build's filters select, every one in each selected session: a frame's
 * labels and its distance from a change depend on all of them, promoted or not.
 *
 * @async
 * @param {Object} filters - The Mosaic's filters.
 * @returns {Promise<Array<Object>>} Rows with `project`, `dive`, `session_id`, `species_id`,
 *   `comname`, positions, `tc`, `etc`, `video_source` and `training_decision`.
 */
async function habitatStretches(filters = {}) {
    const bind = binder();
    const where = predicates({ ...filters, species: null, sessionType: null, reviewStatus: null, trainingDisposition: null },
        bind, { status: false });
    where.push(`s.type = ${bind.add(HABITAT_TYPE)}`);
    // Promotion is checked per frame afterwards, so every stretch of each session is read here.
    return db.sequelize.query(
        `SELECT o.observation_id, o.session_id, o.species_id, o.comname, o."actualPosition", o."mediaPosition",
                o.tc, o.etc, o.video_source, s.dive, coalesce(p.name, '') AS project, rt.decision AS training_decision
           FROM observations o
           JOIN sessions s ON s.session_id = o.session_id
           LEFT JOIN projects p ON p.project_id = o.project_id
           LEFT JOIN observation_review_current rt
                  ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
          WHERE ${where.join(' AND ')}
          ORDER BY o.session_id, o.observation_id`,
        { bind: bind.values, type: db.Sequelize.QueryTypes.SELECT }
    );
}

/**
 * The stretches a build's queries select, each once (#287).
 *
 * A build from the dashboard is a list of queries; their split is ignored, since a habitat
 * build splits whole dives itself.
 *
 * @async
 * @param {Object} spec - The build's spec: `subsets`, or `filters`.
 * @returns {Promise<Array<Object>>} From `habitatStretches`, without repeats.
 */
async function stretchesForBuild(spec) {
    const queries = Array.isArray(spec.subsets) && spec.subsets.length
        ? spec.subsets.map((s) => s.filters || {})
        : [spec.filters || {}];
    const seen = new Map();
    for (const filters of queries) {
        for (const row of await habitatStretches(filters)) seen.set(row.observation_id, row);
    }
    return [...seen.values()];
}

/**
 * The Habitat list's rows for the substrates a build labels, in label order.
 *
 * Looked up on the Habitat list alone: "Sand" is on another list too.
 *
 * @async
 * @param {Array<string>} names - Substrate names.
 * @returns {Promise<Array<{species_id: number, comname: string, class_index: number}>>}
 * @throws {Error} When one is not on the Habitat list.
 */
async function habitatClassesFor(names) {
    const rows = await db.sequelize.query(
        `SELECT id, comname FROM species WHERE species_list = :list AND comname IN (:names)`,
        { replacements: { list: HABITAT_TYPE, names }, type: db.Sequelize.QueryTypes.SELECT }
    );
    const byName = new Map(rows.map((r) => [r.comname, Number(r.id)]));
    const missing = names.filter((n) => !byName.has(n));
    if (missing.length) throw new Error(`Not on the Habitat list: ${missing.join(', ')}.`);
    return names.map((comname, classIndex) => ({ species_id: byName.get(comname), comname, class_index: classIndex }));
}

/**
 * A habitat build's frames, by the settled rules.
 *
 * @param {Array<Object>} rows - From `habitatStretches`.
 * @returns {{frames: Array<Object>, members: Map<number, string>, drifting: Array<Object>}}
 *   `frames`: `{split, project, dive, session_id, video, positionMs, labels}`; `members`: the
 *   stretches used, by id, to their split; `drifting`: the sessions left out, and why.
 */
function selectFrames(rows) {
    const bySession = new Map();
    for (const row of rows) {
        const media = parseTimeSpan(row.mediaPosition);
        const actual = parseTimeSpan(row.actualPosition);
        const tc = parseTimeSpan(row.tc);
        const etc = parseTimeSpan(row.etc);
        if ([media, actual, tc, etc].some((v) => v === null) || etc <= tc || !row.video_source) continue;
        if (!bySession.has(row.session_id)) bySession.set(row.session_id, { project: row.project, dive: row.dive, stretches: [] });
        bySession.get(row.session_id).stretches.push({
            id: row.observation_id, name: row.comname, file: row.video_source,
            startMs: media, endMs: media + (etc - tc), offsetMs: actual - media,
            promoted: row.training_decision === PROMOTED,
        });
    }

    const drifting = [];
    const kept = [];
    for (const [sessionId, session] of bySession) {
        const drift = plan.driftingFiles(session.stretches);
        if (drift.length) drifting.push({ session_id: sessionId, files: drift });
        else kept.push([sessionId, session]);
    }

    const splitOf = plan.splitDives(kept.map(([, s]) => ({ project: s.project, dive: s.dive })));
    const frames = [];
    const members = new Map();
    for (const [sessionId, session] of kept) {
        const split = splitOf.get(`${session.project}|${session.dive}`);
        const byId = new Map(session.stretches.map((s) => [s.id, s]));
        for (const frame of plan.framesForSession(session.stretches)) {
            // Only where every stretch over it is promoted: its segment was promoted.
            if (!frame.covering.every((id) => byId.get(id).promoted)) continue;
            frames.push({ split, project: session.project, dive: session.dive, session_id: sessionId,
                video: frame.file, positionMs: frame.positionMs, labels: frame.labels });
            frame.covering.forEach((id) => members.set(id, split));
        }
    }
    return { frames, members, drifting };
}

/**
 * Why a cut frame is not seabed, or null when it is.
 *
 * @async
 * @param {string} file - The frame, as cut.
 * @returns {Promise<?string>} `blank screen`, an example screen's name, or null.
 */
async function rejectionFor(file) {
    // Imported here so the selection above can be tested without an image library.
    const sharp = require('sharp');
    const { data } = await sharp(file).greyscale().resize(REJECT.width, REJECT.height, { fit: 'fill' })
        .raw().toBuffer({ resolveWithObject: true });
    const pixels = Array.from(data);
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const spread = Math.sqrt(pixels.reduce((a, b) => a + (b - mean) ** 2, 0) / pixels.length);
    if (spread < BLANK_SPREAD) return 'blank screen';
    for (const [name, screen] of Object.entries(REJECT.screens)) {
        const diff = pixels.reduce((a, b, i) => a + Math.abs(b - screen[i]), 0) / pixels.length;
        if (diff < MAX_DIFF) return name;
    }
    return null;
}

module.exports = {
    HABITAT_TYPE, PROMOTED, BLANK_SPREAD, MAX_DIFF,
    habitatStretches, stretchesForBuild, habitatClassesFor, selectFrames, rejectionFor,
};
