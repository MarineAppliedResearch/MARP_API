/**
 * The Mosaic's habitat segments, through the route, on seeded habitat sessions (#342).
 *
 * Checks the question a biologist asks -- "Mud alone", "Mud and Boulder at once" -- against
 * stretches seeded here, and that reviewing a segment through the Mosaic's existing review
 * route lands on its stretches: approving one approves every stretch under it, flagging one
 * substrate flags that substrate's stretch alone (#287 question 11).
 *
 * Everything is seeded here and removed afterwards, as `tests/setup/corpus-guard.js` requires.
 *
 * @fileoverview Endpoint tests for /api/v2/mosaic/habitat/segments.
 * @module tests/habitat-segments-route
 */

const db = require('../model');
const { formatTimeSpan, deriveTc } = require('../db/timecode');
const substrates = require('./fixtures/habitat-substrates');

const runId = Date.now();
const { QueryTypes } = db.Sequelize;
const q = (sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });
const ROUTE = '/api/v2/mosaic/habitat/segments';
const REVIEW = '/api/v2/mosaic/observations/review';

const seeded = { substrates: null, projectId: null, sessionId: null, ids: {} };

/** A habitat stretch, clock start and end in seconds, as an annotator's. */
async function stretch(name, startS, endS) {
    const [row] = await q(
        `INSERT INTO observations (project_id, session_id, "obsID", species_id, comname, taxserial, count,
                                   tc, etc, "actualPosition", "mediaPosition", video_source, "createdAt", "updatedAt")
         SELECT :p, :s, :obs, id, comname, taxserial, 1, :tc, :etc, :actual, :actual, :video, now(), now()
           FROM species WHERE species_list = 'Habitat' AND comname = :name
         RETURNING observation_id`,
        {
            p: seeded.projectId, s: seeded.sessionId, obs: Object.keys(seeded.ids).length + 1, name,
            tc: deriveTc(startS * 1000), etc: deriveTc(endS * 1000), actual: formatTimeSpan(startS * 1000),
            video: `jest-habitat-segments-${runId}.mp4`,
        }
    );
    return row.observation_id;
}

const ask = (body) => global.api.post(ROUTE).send({ filters: { session: [seeded.sessionId] }, ...body });

beforeAll(async () => {
    // A database built from the baseline has no substrates on the Habitat list.
    seeded.substrates = await substrates.ensureSubstrates();
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, now(), now()) RETURNING project_id',
        { name: `Jest Habitat Segments ${runId}` }
    );
    seeded.projectId = project.project_id;
    const [session] = await q(
        `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:p, :dive, 'L1', 'L1', 'Habitat', now(), now()) RETURNING session_id`,
        { p: seeded.projectId, dive: `JEST-SEGMENTS-${runId}` }
    );
    seeded.sessionId = session.session_id;

    // Mud 0-300 with Boulder on top 120-180, then Sand 300-400: Mud, Mud + Boulder, Mud, Sand.
    seeded.ids.mud = await stretch('Mud', 0, 300);
    seeded.ids.boulder = await stretch('Boulder', 120, 180);
    seeded.ids.sand = await stretch('Sand', 300, 400);

    // Each with a ready picture, as a model's stretches get one from their keyframes: the
    // review route accepts only what a reviewer could have seen. An annotator's stretch has no
    // picture of its own, and approving it by its segment waits on the segment's picture (A20).
    for (const id of Object.values(seeded.ids)) {
        await q(
            `INSERT INTO observation_thumbnails (observation_id, status, permanent, filename, content_type, generation,
                                                 attempts, requested_at, completed_at, created_at, updated_at)
             VALUES (:id, 'ready', false, :file, 'image/jpeg', 1, 1, now(), now(), now(), now()) RETURNING observation_id`,
            { id, file: `jest-habitat-segment-${runId}-${id}.jpg` }
        );
    }
});

afterAll(async () => {
    const ids = Object.values(seeded.ids);
    await q('DELETE FROM observations WHERE observation_id IN (:ids) RETURNING 1', { ids });
    await q('DELETE FROM sessions WHERE session_id = :s RETURNING 1', { s: seeded.sessionId });
    await q('DELETE FROM projects WHERE project_id = :p RETURNING 1', { p: seeded.projectId });
    await substrates.removeSubstrates(seeded.substrates);
});

describe('habitat segments in the Mosaic (#342)', () => {
    // The decisions these tests make name the test's signed-in user, whom the shared setup
    // removes in its own afterAll -- which runs before this file's. So they go here, first.
    afterAll(async () => {
        await q('DELETE FROM observation_reviews WHERE observation_id IN (:ids) RETURNING 1', { ids: Object.values(seeded.ids) });
    });

    test('a line is cut into segments of one combination each', async () => {
        const res = await ask({});
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4);
        expect(res.body.segments.map((s) => [s.label, s.start_ms / 1000, s.end_ms / 1000])).toEqual([
            ['Mud', 0, 120], ['Mud + Boulder', 120, 180], ['Mud', 180, 300], ['Sand', 300, 400],
        ]);
        expect(res.body.segments[1].stretches.map((s) => s.substrate).sort()).toEqual(['Boulder', 'Mud']);
        expect(res.body.segments.every((s) => s.review === 'unreviewed')).toBe(true);
    });

    test('"Mud alone" is exactly Mud; "Mud and Boulder at once" includes all of them', async () => {
        const alone = await ask({ substrates: ['Mud'], mode: 'exactly' });
        expect(alone.body.segments.map((s) => s.label)).toEqual(['Mud', 'Mud']);
        const both = await ask({ substrates: ['Mud', 'Boulder'], mode: 'all' });
        expect(both.body.segments.map((s) => s.label)).toEqual(['Mud + Boulder']);
        const either = await ask({ substrates: ['Boulder', 'Sand'], mode: 'any' });
        expect(either.body.segments.map((s) => s.label)).toEqual(['Mud + Boulder', 'Sand']);
    });

    test('refuses a mode it does not know', async () => {
        expect((await ask({ substrates: ['Mud'], mode: 'mostly' })).status).toBe(400);
    });

    test('approving a segment approves its stretches; flagging a substrate flags its stretch', async () => {
        const [, both] = (await ask({})).body.segments;

        // Approve "Mud + Boulder": both stretches, through the review route.
        const approved = await global.api.post(REVIEW).send({
            observations: both.stretches.map((s) => ({ observation_id: s.observation_id, version: s.version })),
            marks: both.stretches.map((s) => ({ observation_id: s.observation_id, kind: 'accept' })),
        });
        expect(approved.status).toBe(200);

        // Every segment over the Mud stretch now counts its Mud as reviewed; "Mud + Boulder" is reviewed.
        let segments = (await ask({})).body.segments;
        expect(segments.map((s) => s.review)).toEqual(['reviewed', 'reviewed', 'reviewed', 'unreviewed']);

        // Flag Sand alone: only its segment is flagged.
        const sand = segments[3].stretches[0];
        const flagged = await global.api.post(REVIEW).send({
            observations: [{ observation_id: sand.observation_id, version: sand.version }],
            marks: [{ observation_id: sand.observation_id, kind: 'except' }],
        });
        expect(flagged.status).toBe(200);
        segments = (await ask({ review: ['flagged'] })).body.segments;
        expect(segments.map((s) => s.label)).toEqual(['Sand']);
    });
});
