/**
 * Endpoint tests for the Mosaic video page's box edits (#181): the annotation GUI's controls
 * -- move or resize, add a middle, set the end, delete a keyframe -- with the track keeping
 * one start and one end, and the thumbnail asked for again.
 *
 * At the HTTP tier, through the real routes and `keyframes:write`, against rows this file
 * seeds and removes. Jellyfin is stubbed for the GPU row's nominal rate.
 *
 * @fileoverview Endpoint tests for the /api/v2/mosaic/video/keyframe routes.
 * @module tests/mosaic-video-edit
 */

const request = require('supertest');

const app = require('../app');
const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');

const { QueryTypes } = db.Sequelize;
const ROUTE = '/api/v2/mosaic/video/keyframe';
const runId = Date.now();
const VIDEO = `jest-mosaic-video-edit-${runId}.mp4`;
const NOMINAL = 29.97;

const seeded = { projectId: null, jobId: null, observationIds: [] };

function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/** One observation with a start, a middle and an end, frames as given. Returns its id and keyframe ids. */
async function addObservation({ jobId = null, frames }) {
    const [inserted] = await q(
        `INSERT INTO observations
             (project_id, "obsID", comname, tc, video_source, "mediaPosition", gpu_job_id, "createdAt", "updatedAt")
         VALUES (:projectId, :obsID, 'Jest species', '10:00:00', :video, '00:00:12.0000000', :jobId, NOW(), NOW())
         RETURNING observation_id`,
        { projectId: seeded.projectId, obsID: seeded.observationIds.length + 1, video: VIDEO, jobId }
    );
    seeded.observationIds.push(inserted.observation_id);
    const keyframes = [];
    for (const [index, framenum] of frames.entries()) {
        const type = index === 0 ? 'start' : index === frames.length - 1 ? 'end' : 'middle';
        const [row] = await q(
            `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, "createdAt", "updatedAt")
             VALUES (:id, '1', 'Jest species', :type, :framenum, 0.5, 0.5, 0.1, 0.1, NOW(), NOW())
             RETURNING keyframe_id`,
            { id: inserted.observation_id, type, framenum }
        );
        keyframes.push(row.keyframe_id);
    }
    return { id: inserted.observation_id, keyframes };
}

const track = (id) => q('SELECT keyframe_id, type, framenum, x, y, width, height FROM keyframes WHERE observation_id = :id ORDER BY framenum', { id });

beforeAll(async () => {
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id',
        { name: `Jest Mosaic Video Edit ${runId}` }
    );
    seeded.projectId = project.project_id;
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
    if (seeded.observationIds.length) {
        await db.sequelize.query('DELETE FROM observation_thumbnails WHERE observation_id IN (:ids)', { replacements: { ids: seeded.observationIds } });
        await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids: seeded.observationIds } });
    }
    if (seeded.jobId) await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id: seeded.jobId } });
    if (seeded.projectId) await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
});

describe('box edits from the video page (#181)', () => {
    it('moves a keyframe\'s box, keeping its frame and type, and asks for the thumbnail again', async () => {
        const { id, keyframes } = await addObservation({ frames: [250, 300, 350] });
        const response = await global.api.put(`${ROUTE}/${keyframes[1]}`).send({ x: 0.25, y: 0.75, width: 0.2, height: 0.3 });
        expect(response.status).toBe(200);
        expect(response.body.changed).toEqual([expect.objectContaining({ keyframe_id: keyframes[1], t: 12, type: 'middle', x: 0.25, y: 0.75 })]);

        const [middle] = (await track(id)).filter((row) => row.keyframe_id === keyframes[1]);
        expect(middle).toMatchObject({ framenum: 300, type: 'middle', x: 0.25, y: 0.75, width: 0.2, height: 0.3 });
        const [thumbnail] = await q('SELECT status, candidate_index FROM observation_thumbnails WHERE observation_id = :id', { id });
        expect(thumbnail).toEqual({ status: 'queued', candidate_index: 0 });
    });

    it('adds a middle at a time in seconds, by each row\'s own rate', async () => {
        const gui = await addObservation({ frames: [250, 350] });
        const added = await global.api.post(ROUTE).send({ observation_id: gui.id, t: 12.48, x: 0.4, y: 0.4, width: 0.1, height: 0.1 });
        expect(added.status).toBe(200);
        // 12.48 s at 25 is frame 312.
        expect((await track(gui.id)).map((row) => [row.framenum, row.type])).toEqual([[250, 'start'], [312, 'middle'], [350, 'end']]);

        const gpu = await addObservation({ jobId: seeded.jobId, frames: [300, 400] });
        await global.api.post(ROUTE).send({ observation_id: gpu.id, t: 11, x: 0.4, y: 0.4, width: 0.1, height: 0.1 });
        // 11 s at 29.97 is frame 330.
        expect((await track(gpu.id)).map((row) => row.framenum)).toEqual([300, Math.round(11 * NOMINAL), 400]);
    });

    it('moves the keyframe already at that time rather than adding a second, and refuses outside the track', async () => {
        const { id, keyframes } = await addObservation({ frames: [250, 300, 350] });
        await global.api.post(ROUTE).send({ observation_id: id, t: 12, x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
        const rows = await track(id);
        expect(rows).toHaveLength(3);
        expect(rows[1]).toMatchObject({ keyframe_id: keyframes[1], x: 0.1, y: 0.2 });

        const outside = await global.api.post(ROUTE).send({ observation_id: id, t: 20, x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
        expect(outside.status).toBe(400);
    });

    it('sets the end, and the end that was becomes a middle', async () => {
        const { id, keyframes } = await addObservation({ frames: [250, 300, 350] });
        const response = await global.api.post(`${ROUTE}/${keyframes[1]}/end`);
        expect(response.status).toBe(200);
        expect((await track(id)).map((row) => row.type)).toEqual(['start', 'end', 'middle']);
    });

    it('deleting the start or the end promotes the next, and the last keyframe is refused', async () => {
        const { id, keyframes } = await addObservation({ frames: [250, 300, 350, 400] });
        await global.api.delete(`${ROUTE}/${keyframes[0]}`);
        expect((await track(id)).map((row) => [row.framenum, row.type])).toEqual([[300, 'start'], [350, 'middle'], [400, 'end']]);
        await global.api.delete(`${ROUTE}/${keyframes[3]}`);
        expect((await track(id)).map((row) => [row.framenum, row.type])).toEqual([[300, 'start'], [350, 'end']]);
        await global.api.delete(`${ROUTE}/${keyframes[2]}`);
        const last = await global.api.delete(`${ROUTE}/${keyframes[1]}`);
        expect(last.status).toBe(400);
        expect(await track(id)).toHaveLength(1);
    });

    it('refuses a box that is not one, and a keyframe that does not exist', async () => {
        const { keyframes } = await addObservation({ frames: [250, 350] });
        expect((await global.api.put(`${ROUTE}/${keyframes[0]}`).send({ x: 0.5, y: 0.5, width: 0, height: 0.1 })).status).toBe(400);
        expect((await global.api.put(`${ROUTE}/${keyframes[0]}`).send({ x: 'left', y: 0.5, width: 0.1, height: 0.1 })).status).toBe(400);
        expect((await global.api.put(`${ROUTE}/2147483000`).send({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 })).status).toBe(404);
    });

    it('requires a signed-in user', async () => {
        expect((await request(app).put(`${ROUTE}/1`).send({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 })).status).toBe(401);
    });
});
