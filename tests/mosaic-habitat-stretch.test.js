/**
 * The video page's habitat timeline (#287, R3-R5): the opened session's stretches in the video
 * read, and changing when a stretch starts and ends.
 *
 * Settled with Isaac on 2026-11-20 (`.marp/task.md` on `287-trial-fixes`): the strip shows the
 * whole session whatever the Mosaic is filtered to (A1); a retimed stretch keeps its review
 * (A3); a drag into a neighbour of the same substrate merges it (A4). Every column that states
 * a stretch's start or end moves together, for an annotator's stretch and a model's.
 *
 * @fileoverview Tests for service/mosaic-habitat-stretch.service.js and the read beside it.
 * @module tests/mosaic-habitat-stretch
 */

const db = require('../model');
const { formatTimeSpan, deriveTc, deriveFrame, parseTimeSpan } = require('../db/timecode');
const { retimedColumns } = require('../db/habitat-keyframes');
const { setStretchTimes } = require('../service/mosaic-habitat-stretch.service');
const videoService = require('../service/mosaic-video.service');

const { QueryTypes } = db.Sequelize;
const q = (sql, replacements = {}) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });

const runId = Date.now();
const VIDEO = `jest-habitat-stretch-${runId}.mp4`;
/* The clock this video's stretches were recorded against: 10:00:00 at its first frame. */
const CLOCK_MS = 10 * 3600000;
const seeded = { projectId: null, sessionIds: [], ids: [], species: [] };

const session = async (type) => {
    const [row] = await q(
        `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:p, 'HS1', 'L1', :line, :type, now(), now()) RETURNING session_id`,
        { p: seeded.projectId, line: `LID-HS-${type}-${seeded.sessionIds.length}-${runId}`, type }
    );
    seeded.sessionIds.push(row.session_id);
    return row.session_id;
};

/**
 * A stretch from `startS` to `endS` seconds into the video, as the annotation GUI records one:
 * the clock in `tc`, `etc` and `actualPosition`, the file position in `mediaPosition`. With
 * `keyed`, a start and an end keyframe as well, as a model's stretch has.
 */
async function stretch(sessionId, startS, endS, { species = seeded.species[0], keyed = false } = {}) {
    const actual = CLOCK_MS + startS * 1000;
    const [row] = await q(
        `INSERT INTO observations (project_id, session_id, "obsID", species_id, comname, count, tc, etc, frame,
                                   "actualPosition", "mediaPosition", video_source, "createdAt", "updatedAt")
         VALUES (:p, :s, :obs, :species, :name, 1, :tc, :etc, :frame, :actual, :media, :video, now(), now())
         RETURNING observation_id`,
        {
            p: seeded.projectId, s: sessionId, obs: seeded.ids.length + 1, species: species.id, name: species.comname,
            tc: deriveTc(actual), etc: deriveTc(CLOCK_MS + endS * 1000), frame: deriveFrame(actual),
            actual: formatTimeSpan(actual), media: formatTimeSpan(startS * 1000), video: VIDEO,
        }
    );
    seeded.ids.push(row.observation_id);
    if (keyed) {
        for (const [type, t] of [['start', startS], ['end', endS]]) {
            await q(
                `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, "createdAt", "updatedAt")
                 VALUES (:id, '1', :name, :type, :framenum, 0.5, 0.75, 0.5, 0.5, now(), now()) RETURNING keyframe_id`,
                { id: row.observation_id, name: species.comname, type, framenum: Math.round(t * 25) }
            );
        }
    }
    return row.observation_id;
}

const versionOf = async (id) => (await q('SELECT version FROM observations WHERE observation_id = :id', { id }))[0].version;
const rowOf = async (id) => (await q(
    `SELECT tc, etc, frame, "actualPosition", "mediaPosition", version FROM observations WHERE observation_id = :id`, { id }
))[0];
const exists = async (id) => (await q('SELECT 1 FROM observations WHERE observation_id = :id', { id })).length === 1;

beforeAll(async () => {
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, now(), now()) RETURNING project_id',
        { name: `Jest Habitat Stretch ${runId}` }
    );
    seeded.projectId = project.project_id;
    // Any two species: the rule is about same or different, not which.
    seeded.species = await q('SELECT id, comname FROM species WHERE comname IS NOT NULL ORDER BY id LIMIT 2');
    expect(seeded.species).toHaveLength(2);
});

/* After each test, not all of them: a review names the fixture reviewer, and the setup's own
   afterAll removes that user before this file's would run. */
afterEach(async () => {
    if (seeded.ids.length) {
        // Keyframes and reviews go with their observations, by cascade.
        await q('DELETE FROM observations WHERE observation_id IN (:ids) RETURNING 1', { ids: seeded.ids });
        seeded.ids.length = 0;
    }
});

afterAll(async () => {
    if (seeded.sessionIds.length) await q('DELETE FROM sessions WHERE session_id IN (:ids) RETURNING 1', { ids: seeded.sessionIds });
    await q('DELETE FROM projects WHERE project_id = :p RETURNING 1', { p: seeded.projectId });
});

describe('the columns a new start and end change (#287 R5)', () => {
    test('an annotator\'s stretch moves every start column together and keeps its length to the second', () => {
        const row = {
            mediaPosition: formatTimeSpan(100000), actualPosition: formatTimeSpan(CLOCK_MS + 100000),
            tc: deriveTc(CLOCK_MS + 100000), etc: deriveTc(CLOCK_MS + 160000), frame: deriveFrame(CLOCK_MS + 100000),
            observed_at: null,
        };
        const { columns } = retimedColumns(row, { startMs: 90400, endMs: 175000, keyed: false });
        expect(columns.mediaPosition).toBe(formatTimeSpan(90400));
        expect(columns.actualPosition).toBe(formatTimeSpan(CLOCK_MS + 90400));
        expect(columns.tc).toBe(deriveTc(CLOCK_MS + 90400));
        expect(columns.frame).toBe(deriveFrame(CLOCK_MS + 90400));
        // 84.6 s long, to the nearest second the annotation was recorded to: 85 s after tc.
        expect(parseTimeSpan(columns.etc) - parseTimeSpan(columns.tc)).toBe(85000);
    });

    test('a tc or frame something else wrote is shifted, never replaced with a guess', () => {
        const row = {
            mediaPosition: formatTimeSpan(100000), actualPosition: formatTimeSpan(CLOCK_MS + 100000),
            tc: '09:00:00', etc: '09:01:00', frame: '06', observed_at: null,
        };
        const { columns } = retimedColumns(row, { startMs: 110000, endMs: 170000, keyed: false });
        expect(columns.tc).toBe('09:00:10');
        expect(columns).not.toHaveProperty('frame');
    });
});

describe('changing a habitat stretch\'s times (#287 R5)', () => {
    test('an annotator\'s stretch: the page reads it where it was dragged, and its review stays (A3)', async () => {
        const sessionId = await session('Habitat');
        const id = await stretch(sessionId, 100, 160);

        // Reviewed on the video page, as a reviewer would.
        const reviewed = await global.api.post('/api/v2/mosaic/observations/review').send({
            observations: [{ observation_id: id, version: await versionOf(id) }],
            marks: [{ observation_id: id, kind: 'accept' }],
            seen_in_video: true,
        });
        expect(reviewed.status).toBe(200);

        const res = await global.api.put(`/api/v2/mosaic/video/observation/${id}/times`)
            .send({ start_s: 90, end_s: 175, version: await versionOf(id) });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ observation_id: id, start_s: 90, end_s: 175, merged: [] });

        const read = await videoService.videoObservations({ observation_id: id });
        const mine = read.habitat.stretches.find((s) => s.observation_id === id);
        expect(mine).toMatchObject({ start_s: 90, end_s: 175, review_decision: 'reviewed', version: res.body.version });
        const row = await rowOf(id);
        expect(row.tc).toBe(deriveTc(CLOCK_MS + 90000));
        expect(row.actualPosition).toBe(formatTimeSpan(CLOCK_MS + 90000));
    });

    test('a model\'s stretch: its start and end keyframes move with its times', async () => {
        const sessionId = await session('Habitat');
        const id = await stretch(sessionId, 20, 40, { keyed: true });

        const answer = await setStretchTimes(id, { start_s: 18, end_s: 47.4, version: await versionOf(id) });
        expect(answer).toMatchObject({ start_s: 18, end_s: 47.4, merged: [] });
        const keyframes = await q('SELECT type, framenum FROM keyframes WHERE observation_id = :id ORDER BY framenum', { id });
        expect(keyframes.map((k) => [k.type, k.framenum])).toEqual([['start', 450], ['end', 1185]]);
        const row = await rowOf(id);
        expect(row.mediaPosition).toBe(formatTimeSpan(18000));
        expect(row.etc).toBe(deriveTc(CLOCK_MS + 18000 + 29400));
    });

    test('a drag into a neighbour of the same substrate merges it, and what it then reaches (A4)', async () => {
        const sessionId = await session('Habitat');
        const dragged = await stretch(sessionId, 100, 120);
        const next = await stretch(sessionId, 130, 150);
        const beyond = await stretch(sessionId, 148, 170);
        const overlapping = await stretch(sessionId, 115, 125);
        const otherSubstrate = await stretch(sessionId, 121, 200, { species: seeded.species[1] });
        const far = await stretch(sessionId, 300, 320);

        const answer = await setStretchTimes(dragged, { start_s: 100, end_s: 135, version: await versionOf(dragged) });
        expect(answer.merged).toEqual([next, beyond]);
        expect(answer).toMatchObject({ start_s: 100, end_s: 170 });
        expect(await exists(next)).toBe(false);
        expect(await exists(beyond)).toBe(false);
        // Already overlapped before the drag, another substrate, out of reach: all left alone.
        for (const id of [overlapping, otherSubstrate, far]) expect(await exists(id)).toBe(true);
    });

    test('the strip reads the whole session whatever the Mosaic is filtered to (A1)', async () => {
        const sessionId = await session('Habitat');
        const a = await stretch(sessionId, 10, 20);
        const b = await stretch(sessionId, 30, 40, { species: seeded.species[1] });

        const read = await videoService.videoObservations({ observation_id: a, filters: { species: [seeded.species[0].id] } });
        expect(read.observations.map((o) => o.observation_id)).not.toContain(b);
        expect(read.habitat.session_id).toBe(sessionId);
        expect(read.habitat.stretches.map((s) => s.observation_id)).toEqual(expect.arrayContaining([a, b]));
    });

    test('refuses a stretch that changed since it was read, one with no end, and anything not a stretch', async () => {
        const habitat = await session('Habitat');
        const id = await stretch(habitat, 10, 20);
        const stale = await global.api.put(`/api/v2/mosaic/video/observation/${id}/times`)
            .send({ start_s: 5, end_s: 20, version: (await versionOf(id)) - 1 });
        expect(stale.status).toBe(409);
        expect((await rowOf(id)).mediaPosition).toBe(formatTimeSpan(10000));

        const open = await stretch(habitat, 50, 60);
        await q('UPDATE observations SET etc = NULL WHERE observation_id = :id RETURNING 1', { id: open });
        await expect(setStretchTimes(open, { start_s: 40, end_s: 60, version: await versionOf(open) }))
            .rejects.toMatchObject({ status: 400 });

        const transect = await stretch(await session('transect'), 10, 20, { keyed: true });
        await expect(setStretchTimes(transect, { start_s: 5, end_s: 20, version: await versionOf(transect) }))
            .rejects.toMatchObject({ status: 400 });

        const backwards = await global.api.put(`/api/v2/mosaic/video/observation/${id}/times`)
            .send({ start_s: 30, end_s: 20, version: await versionOf(id) });
        expect(backwards.status).toBe(400);
    });
});
