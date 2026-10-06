/**
 * Annotating from the Mosaic's video page (#181): add an observation, change its count, merge
 * two into one, and choose the frame its Mosaic picture is cut from.
 *
 * What each was settled as (Isaac, 2026-10-06, `.marp/task.md` on `181-video-annotation`):
 *
 * - **Add** (R1): a box drawn and a species picked make an observation with one `start`
 *   keyframe; the end is set later, as in the GUI (A4). Its session is picked from the sessions
 *   already in this video (A8). Every column a machine-written row carries is filled -- project,
 *   species, both names, the timecodes, `obsID` and `PobsID`, the reviewer -- in one transaction,
 *   under the same lock every writer of those keys takes. Its frames count at 25, as every row
 *   without a GPU job does.
 * - **Count** (R5): the number of individuals, for when the model found fewer than there were.
 *   The boxes do not change.
 * - **Merge** (R4): B's keyframes join A's track and B is deleted. A keeps its id, species and
 *   count (A2); on a frame both have, A's box is kept (A3); the track ends with one `start`, the
 *   earliest, and one `end`, the latest, when either had an end; every keyframe takes A's name.
 * - **Mosaic picture** (R6): cut now from the frame and box chosen, the box pinned as a keyframe
 *   first if it is between two. Nothing records the choice (A9).
 *
 * A rename is the Mosaic's species correction, which renames fully (R3); it is not here.
 *
 * @fileoverview Observation-level annotation for the Mosaic video page.
 * @module service/mosaic-video-annotate
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const keys = require('../repository/observation-ingest.repository');
const thumbnails = require('../repository/observation-thumbnail.repository');
const extraction = require('./thumbnail-extraction.service');
const edits = require('./mosaic-video-edit.service');
const { sessionsInVideo } = require('./mosaic-video.service');
const { formatTimeSpan, deriveTc, deriveFrame, ASSUMED_FPS } = require('../db/timecode');

const { boxOf, rateOf, asSeconds, invalid, notFound, KEYFRAME_COLUMNS } = edits;

/* The track a new observation's box starts, as this page's other edits name it. */
const NEW_SUBSET = '1';

function integer(value, name) {
    if (!Number.isInteger(value)) throw invalid(`${name} must be an integer.`);
    return value;
}

async function keyframesOf(observationId, transaction) {
    return db.sequelize.query(
        `SELECT ${KEYFRAME_COLUMNS} FROM keyframes WHERE observation_id = :observationId ORDER BY subset, framenum, keyframe_id`,
        { replacements: { observationId }, type: QueryTypes.SELECT, transaction }
    );
}

/**
 * Add an observation from a drawn box (R1).
 *
 * @async
 * @param {Object} body - `{ observation_id, session_id, species_id, t, x, y, width, height }`:
 *   the observation the page was opened on, which names the video; the session it joins; its
 *   species; the moment in seconds; and the box.
 * @param {number|null} userId - The reviewer.
 * @returns {Promise<Object>} `{ observation, keyframes }`, as the video reads return them.
 */
async function createObservation(body = {}, userId = null) {
    const box = boxOf(body);
    const openedId = integer(body.observation_id, 'observation_id');
    const sessionId = integer(body.session_id, 'session_id');
    const speciesId = integer(body.species_id, 'species_id');
    if (!Number.isFinite(body.t) || body.t < 0) throw invalid('t must be a time in seconds.');

    // At 25, as every row without a GPU job counts; the timecodes are whole frames of it.
    const framenum = Math.round(body.t * ASSUMED_FPS);
    const milliseconds = (framenum * 1000) / ASSUMED_FPS;
    const position = formatTimeSpan(milliseconds);

    const created = await db.sequelize.transaction(async (transaction) => {
        const [opened] = await db.sequelize.query(
            'SELECT video_source FROM observations WHERE observation_id = :id',
            { replacements: { id: openedId }, type: QueryTypes.SELECT, transaction }
        );
        if (!opened || !opened.video_source) throw notFound(`Observation ${openedId} has no video.`);
        const session = (await sessionsInVideo(opened.video_source, transaction))
            .find((row) => row.session_id === sessionId);
        if (!session) throw invalid(`Session ${sessionId} has no observations in this video.`);
        const [species] = await db.sequelize.query(
            'SELECT id, comname, taxserial FROM species WHERE id = :id',
            { replacements: { id: speciesId }, type: QueryTypes.SELECT, transaction }
        );
        if (!species) throw notFound(`Species ${speciesId} does not exist.`);

        await keys.lockObservationKeys(transaction);
        const obsID = await keys.nextKey(
            'SELECT COALESCE(MAX("obsID"), 0)::int AS m FROM observations WHERE session_id = :sessionId',
            { sessionId }, transaction
        );
        const PobsID = await keys.nextKey(
            `SELECT COALESCE(MAX(o."PobsID"), 0)::int AS m
               FROM observations o JOIN sessions s ON s.session_id = o.session_id
              WHERE s.project_id = :projectId AND s.type = :type`,
            { projectId: session.project_id, type: session.type }, transaction
        );
        const observationId = await keys.nextObservationId(transaction);
        await keys.insertObservation({
            observation_id: observationId,
            obsID,
            PobsID,
            project_id: session.project_id,
            session_id: sessionId,
            user_id: userId,
            tc: deriveTc(milliseconds),
            frame: deriveFrame(milliseconds),
            taxserial: species.taxserial,
            species_id: species.id,
            comname: species.comname,
            count: 1,
            video_source: opened.video_source,
            mediaPosition: position,
            actualPosition: position,
        }, transaction);
        await keys.insertKeyframes(observationId, [{
            subset: NEW_SUBSET, comname: species.comname, type: 'start', framenum, ...box,
        }], transaction);

        const [row] = await db.sequelize.query(
            `SELECT observation_id, "obsID" AS obs_id, species_id, comname, version, session_id
               FROM observations WHERE observation_id = :observationId`,
            { replacements: { observationId }, type: QueryTypes.SELECT, transaction }
        );
        return { row, keyframes: await keyframesOf(observationId, transaction) };
    });

    const t = framenum / ASSUMED_FPS;
    return {
        observation: { ...created.row, start_s: t, end_s: t },
        keyframes: created.keyframes.map((k) => asSeconds(k, ASSUMED_FPS)),
    };
}

/**
 * Change an observation's count (R5).
 *
 * @async
 * @returns {Promise<Object>} `{ observation_id, count, version }`.
 */
async function setCount(observationId, body = {}) {
    integer(observationId, 'observation_id');
    const count = body.count;
    if (!Number.isInteger(count) || count < 1) throw invalid('count must be a whole number of at least 1.');
    const [rows] = await db.sequelize.query(
        `UPDATE observations SET count = :count, "updatedAt" = NOW()
          WHERE observation_id = :observationId
      RETURNING observation_id, count, version`,
        { replacements: { observationId, count } }
    );
    if (!rows.length) throw notFound(`Observation ${observationId} does not exist.`);
    return rows[0];
}

/**
 * Merge observation B into observation A (R4).
 *
 * @async
 * @param {number} intoId - A, which survives.
 * @param {Object} body - `{ from_observation_id }`: B, which is deleted.
 * @returns {Promise<Object>} `{ observation_id, deleted_observation_id, keyframes }`.
 */
async function merge(intoId, body = {}) {
    integer(intoId, 'observation_id');
    const fromId = integer(body.from_observation_id, 'from_observation_id');
    if (fromId === intoId) throw invalid('An observation cannot be merged into itself.');

    const result = await db.sequelize.transaction(async (transaction) => {
        // Both locked, in id order so two merges of the same pair cannot deadlock.
        const pair = await db.sequelize.query(
            `SELECT observation_id, gpu_job_id, video_source, comname FROM observations
              WHERE observation_id IN (:ids) ORDER BY observation_id FOR UPDATE`,
            { replacements: { ids: [intoId, fromId] }, type: QueryTypes.SELECT, transaction }
        );
        const into = pair.find((row) => row.observation_id === intoId);
        const from = pair.find((row) => row.observation_id === fromId);
        if (!into) throw notFound(`Observation ${intoId} does not exist.`);
        if (!from) throw notFound(`Observation ${fromId} does not exist.`);
        if (into.video_source !== from.video_source) throw invalid('Only observations in the same video can be merged.');

        // Each row's frames count at its own rate, so B's are put on A's count first.
        const rateInto = await rateOf(into);
        const rateFrom = await rateOf(from);
        const intoKeyframes = await keyframesOf(intoId, transaction);
        const fromKeyframes = await keyframesOf(fromId, transaction);
        const subset = intoKeyframes.length ? intoKeyframes[0].subset : NEW_SUBSET;
        const track = intoKeyframes.filter((k) => k.subset === subset);
        const taken = new Set(track.map((k) => Number(k.framenum)));
        const hadEnd = [...track, ...fromKeyframes].some((k) => k.type === 'end');

        for (const keyframe of fromKeyframes) {
            const framenum = Math.round((Number(keyframe.framenum) / rateFrom) * rateInto);
            // A's box where both have one (A3); B's goes with B.
            if (taken.has(framenum)) continue;
            taken.add(framenum);
            await db.sequelize.query(
                `UPDATE keyframes SET observation_id = :intoId, subset = :subset, framenum = :framenum,
                        comname = :comname, "updatedAt" = NOW()
                  WHERE keyframe_id = :id`,
                { replacements: { intoId, subset, framenum, comname: into.comname, id: keyframe.keyframe_id }, transaction }
            );
        }

        // One start, the earliest; one end, the latest, when either had an end; the rest middles.
        await db.sequelize.query(
            `WITH ordered AS (
                 SELECT keyframe_id,
                        row_number() OVER (ORDER BY framenum, keyframe_id) AS n,
                        count(*) OVER () AS total
                   FROM keyframes WHERE observation_id = :intoId AND subset = :subset)
             UPDATE keyframes k
                SET type = CASE WHEN o.n = 1 THEN 'start'
                                WHEN o.n = o.total AND :hadEnd THEN 'end'
                                ELSE 'middle' END,
                    "updatedAt" = NOW()
               FROM ordered o
              WHERE k.keyframe_id = o.keyframe_id`,
            { replacements: { intoId, subset, hadEnd }, transaction }
        );

        // B goes, as the Mosaic's delete removes one: with its remaining keyframes, its
        // picture's row and its reviews, by cascade.
        await db.sequelize.query('DELETE FROM observations WHERE observation_id = :fromId', {
            replacements: { fromId }, transaction,
        });
        return { rate: rateInto, keyframes: await keyframesOf(intoId, transaction) };
    });

    await thumbnails.requestRefresh(intoId);
    return {
        observation_id: intoId,
        deleted_observation_id: fromId,
        keyframes: result.keyframes.map((k) => asSeconds(k, result.rate)),
    };
}

/**
 * Cut an observation's Mosaic picture from the box on one frame (R6).
 *
 * @async
 * @param {number} observationId
 * @param {Object} body - `{ t, subset, x, y, width, height }`: the frame in seconds, and the box
 *   drawn there, which is pinned as a keyframe when the frame has none.
 * @returns {Promise<Object>} `{ observation_id, changed, deleted, picture }`.
 */
async function usePicture(observationId, body = {}) {
    integer(observationId, 'observation_id');
    boxOf(body);
    if (!Number.isFinite(body.t) || body.t < 0) throw invalid('t must be a time in seconds.');
    const subset = body.subset == null ? NEW_SUBSET : String(body.subset);

    // The box on that frame becomes a keyframe -- or is the keyframe already there -- without
    // queuing an automatic cut, which would land over this one.
    const pinned = await edits.addKeyframe({ ...body, observation_id: observationId, subset }, { refresh: false });
    const [observation] = await db.sequelize.query(
        `SELECT o.observation_id, o.video_source, o.gpu_job_id,
                t.filename AS thumbnail_filename, t.full_frame_filename, t.full_frame_framenum
           FROM observations o
           LEFT JOIN observation_thumbnails t ON t.observation_id = o.observation_id
          WHERE o.observation_id = :observationId`,
        { replacements: { observationId }, type: QueryTypes.SELECT }
    );
    const rate = await rateOf(observation);
    const keyframe = pinned.changed.find((k) => k.subset === subset && Math.round(k.t * rate) === Math.round(body.t * rate))
        || pinned.changed[pinned.changed.length - 1];
    const framenum = Math.round(keyframe.t * rate);
    const box = { x: keyframe.x, y: keyframe.y, width: keyframe.width, height: keyframe.height };
    const picture = await extraction.cutChosenPicture(observation, { framenum, subset, box });
    return { ...pinned, picture: { t: keyframe.t, subset, filename: picture.filename } };
}

module.exports = { createObservation, setCount, merge, usePicture };
