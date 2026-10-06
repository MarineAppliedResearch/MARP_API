/**
 * Endpoint tests for annotating from the Mosaic's video page (#181): add an observation,
 * change its count, merge two, and cut its Mosaic picture from a chosen box.
 *
 * At the HTTP tier, through the real routes and permissions, against a project, two sessions
 * and observations this file seeds in a video of its own, all removed afterwards -- with every
 * observation the routes create, found by that video. Jellyfin is stubbed for a GPU row's
 * nominal rate; the picture's decode and crop, which need a real video, are stubbed at
 * `cutChosenPicture` and checked for what they were asked to cut.
 *
 * @fileoverview Endpoint tests for the /api/v2/mosaic/video/observation routes.
 * @module tests/mosaic-video-annotate
 */

const request = require('supertest');

const app = require('../app');
const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');

const { QueryTypes } = db.Sequelize;
const ROUTE = '/api/v2/mosaic/video/observation';
const runId = Date.now();
const VIDEO = `jest-mosaic-video-annotate-${runId}.mp4`;
const NOMINAL = 29.97;

const seeded = { projectId: null, sessionIds: [], speciesIds: [], jobId: null };

function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/** One observation in the seeded video, with keyframes as `[framenum, type]`. */
async function addObservation({ sessionIndex = 0, jobId = null, keyframes, speciesIndex = 0 }) {
    const [inserted] = await q(
        `INSERT INTO observations
             (project_id, session_id, "obsID", species_id, comname, taxserial, count, tc, video_source,
              "mediaPosition", gpu_job_id, "createdAt", "updatedAt")
         SELECT :projectId, :sessionId, 900 + (SELECT count(*) FROM observations WHERE video_source = :video),
                s.id, s.comname, s.taxserial, 1, '00:00:10', :video, '00:00:10.0000000', :jobId, NOW(), NOW()
           FROM species s WHERE s.id = :speciesId
         RETURNING observation_id`,
        {
            projectId: seeded.projectId, sessionId: seeded.sessionIds[sessionIndex], video: VIDEO, jobId,
            speciesId: seeded.speciesIds[speciesIndex],
        }
    );
    for (const [framenum, type, x = 0.5] of keyframes) {
        await q(
            `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, "createdAt", "updatedAt")
             SELECT :id, '1', comname, :type, :framenum, :x, 0.5, 0.1, 0.1, NOW(), NOW()
               FROM observations WHERE observation_id = :id`,
            { id: inserted.observation_id, type, framenum, x }
        );
    }
    return inserted.observation_id;
}

const track = (id) => q('SELECT keyframe_id, subset, type, framenum, x, comname FROM keyframes WHERE observation_id = :id ORDER BY framenum', { id });
const row = async (id) => (await q('SELECT * FROM observations WHERE observation_id = :id', { id }))[0];

beforeAll(async () => {
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id',
        { name: `Jest Mosaic Video Annotate ${runId}` }
    );
    seeded.projectId = project.project_id;
    for (const line of ['A', 'B']) {
        const [session] = await q(
            `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, :dive, :line, :line, 'Fish', NOW(), NOW()) RETURNING session_id`,
            { projectId: seeded.projectId, dive: `JEST-ANNOTATE-${runId}`, line: `${line}-${runId}` }
        );
        seeded.sessionIds.push(session.session_id);
    }
    const species = await q(
        `INSERT INTO species (taxserial, comname, species, created_at, updated_at)
         SELECT 992000000 + g, :comname || g, :scientific || g, NOW(), NOW()
           FROM generate_series(1, 2) AS g
         RETURNING id`,
        { comname: `Jest Annotate Fish ${runId}-`, scientific: `Jestus annotatus ${runId}-` }
    );
    seeded.speciesIds = species.map((s) => s.id);
    const [job] = await q("INSERT INTO gpu_jobs (kind, spec, state) VALUES ('inference', '{}'::jsonb, 'cancelled') RETURNING id");
    seeded.jobId = job.id;
});

beforeEach(() => {
    jest.spyOn(jellyfinRepository, 'resolveVideoSource').mockResolvedValue({ item: { id: `jest-item-${runId}` }, score: 100 });
    jest.spyOn(jellyfinRepository, 'getVideoFrameRate').mockResolvedValue({ averageFrameRate: NOMINAL, realFrameRate: NOMINAL });
});

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(async () => {
    // Every observation in the seeded video, including the ones the routes created.
    await db.sequelize.query('DELETE FROM observations WHERE video_source = :video', { replacements: { video: VIDEO } });
    if (seeded.jobId) await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id: seeded.jobId } });
    await db.sequelize.query('DELETE FROM sessions WHERE session_id IN (:ids)', { replacements: { ids: seeded.sessionIds } });
    await db.sequelize.query('DELETE FROM species WHERE id IN (:ids)', { replacements: { ids: seeded.speciesIds } });
    if (seeded.projectId) await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
});

describe('annotating from the video page (#181)', () => {
    it('adds an observation from a drawn box, every column filled, with one start keyframe (R1)', async () => {
        const opened = await addObservation({ sessionIndex: 0, keyframes: [[250, 'start'], [300, 'end']] });
        // The second session has observations in this video too, so a new one may join it (A8).
        await addObservation({ sessionIndex: 1, keyframes: [[400, 'start']] });
        const before = await q('SELECT max("obsID") AS m FROM observations WHERE session_id = :s', { s: seeded.sessionIds[1] });
        const response = await global.api.post(ROUTE).send({
            observation_id: opened, session_id: seeded.sessionIds[1], species_id: seeded.speciesIds[1],
            t: 12.48, x: 0.3, y: 0.4, width: 0.1, height: 0.2,
        });
        expect(response.status).toBe(200);
        const id = response.body.observation.observation_id;
        const created = await row(id);
        const [species] = await q('SELECT comname, taxserial FROM species WHERE id = :id', { id: seeded.speciesIds[1] });
        expect(created).toMatchObject({
            session_id: seeded.sessionIds[1], project_id: seeded.projectId, species_id: seeded.speciesIds[1],
            comname: species.comname, taxserial: species.taxserial, count: 1, video_source: VIDEO,
            gpu_job_id: null, mediaPosition: '00:00:12.4800000', actualPosition: '00:00:12.4800000', tc: '00:00:12',
        });
        expect(created.obsID).toBe((before[0].m || 0) + 1);
        expect(created.user_id).not.toBeNull();
        // 12.48 s at 25 is frame 312: a start, and no end until one is set (A4).
        expect((await track(id)).map((k) => [k.framenum, k.type, k.comname])).toEqual([[312, 'start', species.comname]]);
        expect(response.body.keyframes[0]).toMatchObject({ type: 'start', t: 12.48, x: 0.3 });
    });

    it('refuses a session with nothing in this video, and a species that does not exist', async () => {
        const opened = await addObservation({ keyframes: [[250, 'start']] });
        const [stranger] = await q(
            `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:p, 'JEST-ELSEWHERE', 'x', 'x', 'Fish', NOW(), NOW()) RETURNING session_id`, { p: seeded.projectId }
        );
        try {
            const box = { t: 1, x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
            expect((await global.api.post(ROUTE).send({ observation_id: opened, session_id: stranger.session_id, species_id: seeded.speciesIds[0], ...box })).status).toBe(400);
            expect((await global.api.post(ROUTE).send({ observation_id: opened, session_id: seeded.sessionIds[0], species_id: 2147483000, ...box })).status).toBe(404);
        } finally {
            await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', { replacements: { id: stranger.session_id } });
        }
    });

    it('changes the count and nothing else, and refuses one that is not a whole number of at least 1 (R5)', async () => {
        const id = await addObservation({ keyframes: [[250, 'start'], [300, 'end']] });
        const keyframesBefore = await track(id);
        const response = await global.api.put(`${ROUTE}/${id}/count`).send({ count: 4 });
        expect(response.status).toBe(200);
        expect(response.body.count).toBe(4);
        expect((await row(id)).count).toBe(4);
        expect(await track(id)).toEqual(keyframesBefore);
        expect((await global.api.put(`${ROUTE}/${id}/count`).send({ count: 0 })).status).toBe(400);
        expect((await global.api.put(`${ROUTE}/${id}/count`).send({ count: 2.5 })).status).toBe(400);
    });

    it('merges B into A: one track, A\'s box on a shared frame, one start and one end, A\'s name, B gone (R4)', async () => {
        const a = await addObservation({ speciesIndex: 0, keyframes: [[250, 'start', 0.1], [300, 'end', 0.1]] });
        const b = await addObservation({ speciesIndex: 1, keyframes: [[280, 'start', 0.9], [300, 'middle', 0.9], [350, 'end', 0.9]] });
        await q('UPDATE observations SET count = 3 WHERE observation_id = :b', { b });
        const response = await global.api.post(`${ROUTE}/${a}/merge`).send({ from_observation_id: b });
        expect(response.status).toBe(200);
        expect(response.body.deleted_observation_id).toBe(b);

        const merged = await track(a);
        expect(merged.map((k) => [k.framenum, k.type])).toEqual([[250, 'start'], [280, 'middle'], [300, 'middle'], [350, 'end']]);
        // On frame 300 both had a box: A's (x 0.1) is the one kept (A3).
        expect(Number(merged.find((k) => k.framenum === 300).x)).toBeCloseTo(0.1);
        const aRow = await row(a);
        expect(new Set(merged.map((k) => k.comname))).toEqual(new Set([aRow.comname]));
        expect(aRow.count).toBe(1);
        expect(await row(b)).toBeUndefined();
        expect(await q('SELECT 1 FROM keyframes WHERE observation_id = :b', { b })).toHaveLength(0);
    });

    it('puts a GPU row\'s frames on the survivor\'s count when merging (R4)', async () => {
        const a = await addObservation({ keyframes: [[250, 'start'], [260, 'end']] });
        // 360 at 29.97 is 12.012 s, which is frame 300 at 25.
        const b = await addObservation({ jobId: seeded.jobId, keyframes: [[360, 'start']] });
        await global.api.post(`${ROUTE}/${a}/merge`).send({ from_observation_id: b });
        expect((await track(a)).map((k) => [k.framenum, k.type])).toEqual([[250, 'start'], [260, 'middle'], [300, 'end']]);
    });

    it('refuses to merge observations in different videos, or one into itself', async () => {
        const a = await addObservation({ keyframes: [[250, 'start']] });
        const b = await addObservation({ keyframes: [[260, 'start']] });
        await q('UPDATE observations SET video_source = :v WHERE observation_id = :b', { v: `${VIDEO}.other`, b });
        try {
            expect((await global.api.post(`${ROUTE}/${a}/merge`).send({ from_observation_id: b })).status).toBe(400);
            expect((await global.api.post(`${ROUTE}/${a}/merge`).send({ from_observation_id: a })).status).toBe(400);
        } finally {
            await db.sequelize.query('DELETE FROM observations WHERE observation_id = :b', { replacements: { b } });
        }
    });

    it('cuts the Mosaic picture from the chosen box, pinning it first, and queues no automatic cut over it (R6)', async () => {
        const id = await addObservation({ keyframes: [[250, 'start'], [350, 'end']] });
        await q(
            `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, request_priority,
                     candidate_index, created_at, updated_at)
             VALUES (:id, 'ready', false, 1, 0, 0, 0, NOW(), NOW())
             ON CONFLICT (observation_id) DO UPDATE SET status = 'ready'`, { id }
        );
        const cut = jest.spyOn(extraction, 'cutChosenPicture').mockResolvedValue({ framenum: 300, subset: '1', filename: 'jest.jpg' });
        const response = await global.api.post(`${ROUTE}/${id}/picture`).send({ t: 12, subset: '1', x: 0.4, y: 0.5, width: 0.2, height: 0.2 });
        expect(response.status).toBe(200);

        // Frame 300 was between keyframes, so the box there is a keyframe now.
        expect((await track(id)).map((k) => [k.framenum, k.type])).toEqual([[250, 'start'], [300, 'middle'], [350, 'end']]);
        expect(cut).toHaveBeenCalledWith(expect.objectContaining({ observation_id: id }),
            { framenum: 300, subset: '1', box: { x: 0.4, y: 0.5, width: 0.2, height: 0.2 } });
        // Not queued: the extractor would claim it and cut the automatic picture over this one.
        const [thumbnail] = await q('SELECT status FROM observation_thumbnails WHERE observation_id = :id', { id });
        expect(thumbnail.status).toBe('ready');
    });

    it('the video read lists the sessions in this video, each with its species list, for a new observation (A8)', async () => {
        const opened = await addObservation({ sessionIndex: 0, keyframes: [[250, 'start']] });
        await addObservation({ sessionIndex: 1, keyframes: [[260, 'start']] });
        const read = await global.api.post('/api/v2/mosaic/video/observations').send({ observation_id: opened, filters: {} });
        expect(read.status).toBe(200);
        expect(read.body.opened.session_id).toBe(seeded.sessionIds[0]);
        const { speciesListForSessionType } = require('../db/species-lists');
        expect(read.body.sessions.map((s) => [s.session_id, s.species_list])).toEqual(
            seeded.sessionIds.map((id) => [id, speciesListForSessionType('Fish')])
        );
    });

    it('requires a signed-in user', async () => {
        expect((await request(app).put(`${ROUTE}/1/count`).send({ count: 2 })).status).toBe(401);
    });
});
