/**
 * Endpoint tests for the source-video inspector's read (#181).
 *
 * At the HTTP tier, through the real route and its permission, against rows this file
 * seeds and removes. Jellyfin is stubbed: which item a filename resolves to is the
 * thumbnail pass's rule and tested there, and what this route adds is what it does with
 * the answer -- the grouping, and the time each keyframe is at.
 *
 * **The times are the point.** A frame number is playback time times a rate, and the
 * rate depends on who wrote the row: the annotation GUI counts at an assumed 25 on any
 * video, a GPU row at the video's nominal rate (#231). Both are seeded here on one video
 * whose nominal rate is not 25, so the two rules have to give different answers.
 *
 * @fileoverview Endpoint tests for POST /api/v2/mosaic/observations/video-context.
 * @author Isaac Travers
 * @module tests/mosaic-video-context
 */

const request = require('supertest');

const app = require('../app');
const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');

const { QueryTypes } = db.Sequelize;

/** The route under test. */
const ROUTE = '/api/v2/mosaic/observations/video-context';

/** Unique per run, so a failed run's rows are recognisable and nothing collides. */
const runId = Date.now();

/** The video both seeded observations are on. */
const VIDEO = `jest-video-context-${runId}.mp4`;

/** A video whose best match is weak. */
const WEAK_VIDEO = `jest-video-context-weak-${runId}.mp4`;

/** The nominal rate the stubbed Jellyfin reports: not 25, so the two rules differ. */
const NOMINAL = 29.97;

/** Rows this file created, removed in afterAll. */
const seeded = { projectId: null, jobId: null, observationIds: [] };

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Seed one observation with two keyframes.
 *
 * @async
 * @param {Object} row - `{ video, jobId, mediaPosition, frames }`.
 * @returns {Promise<number>} The observation id.
 */
async function addObservation({ video, jobId = null, mediaPosition, frames }) {
    const [inserted] = await q(
        `INSERT INTO observations
             (project_id, "obsID", comname, tc, video_source, "mediaPosition", gpu_job_id, "createdAt", "updatedAt")
         VALUES (:projectId, :obsID, 'Jest species', '10:00:00', :video, :mediaPosition, :jobId, NOW(), NOW())
         RETURNING observation_id`,
        { projectId: seeded.projectId, obsID: seeded.observationIds.length + 1, video, mediaPosition, jobId }
    );

    seeded.observationIds.push(inserted.observation_id);

    for (const [index, framenum] of frames.entries()) {
        await db.sequelize.query(
            `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, "createdAt", "updatedAt")
             VALUES (:id, '1', 'Jest species', :type, :framenum, 0.5, 0.5, 0.1, 0.1, NOW(), NOW())`,
            { replacements: { id: inserted.observation_id, type: index === 0 ? 'start' : 'end', framenum } }
        );
    }

    return inserted.observation_id;
}

beforeAll(async () => {
    const [project] = await q(
        `INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { name: `Jest Video Context ${runId}` }
    );

    seeded.projectId = project.project_id;

    const [job] = await q(
        `INSERT INTO gpu_jobs (kind, spec, state) VALUES ('inference', '{}'::jsonb, 'cancelled') RETURNING id`
    );

    seeded.jobId = job.id;
});

beforeEach(() => {
    jest.spyOn(jellyfinRepository, 'resolveVideoSource').mockImplementation(async (source) => (
        source === WEAK_VIDEO
            ? { item: { id: 'jest-weak-item' }, score: 60 }
            : { item: { id: `jest-item-${runId}` }, score: 100 }
    ));
    jest.spyOn(jellyfinRepository, 'getVideoFrameRate')
        .mockResolvedValue({ averageFrameRate: NOMINAL, realFrameRate: NOMINAL });
});

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(async () => {
    if (seeded.observationIds.length) {
        await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', {
            replacements: { ids: seeded.observationIds },
        });
    }

    if (seeded.jobId) {
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id: seeded.jobId } });
    }

    if (seeded.projectId) {
        await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
    }
});

describe('the source-video inspector\'s read (#181)', () => {
    it('groups observations by video, and puts each keyframe at the time its writer meant', async () => {
        // Frame 300 by the GUI is 12 s, whatever the video; by a GPU worker, 300 / 29.97.
        const gui = await addObservation({ video: VIDEO, mediaPosition: '00:00:12.0000000', frames: [300, 325] });
        const gpu = await addObservation({
            video: VIDEO, jobId: seeded.jobId, mediaPosition: '00:00:10.0100000', frames: [300, 330],
        });

        const response = await global.api.post(ROUTE).send({ observation_ids: [gui, gpu] });

        expect(response.status).toBe(200);
        expect(response.body.videos).toHaveLength(1);

        const [video] = response.body.videos;

        expect(video).toMatchObject({
            video_source: VIDEO, jellyfin_item_id: `jest-item-${runId}`, frame_rate: NOMINAL, unresolved_reason: null,
        });

        const byId = new Map(video.observations.map((row) => [row.observation_id, row]));

        expect(byId.get(gui).moment_s).toBe(12);
        expect(byId.get(gui).keyframes.map((k) => k.t)).toEqual([12, 13]);
        expect(byId.get(gpu).moment_s).toBeCloseTo(10.01, 6);
        expect(byId.get(gpu).keyframes[0].t).toBeCloseTo(300 / NOMINAL, 9);
        expect(byId.get(gpu).keyframes[1].t).toBeCloseTo(330 / NOMINAL, 9);
        expect(byId.get(gpu).keyframes[0]).toMatchObject({ x: 0.5, y: 0.5, width: 0.1, height: 0.1, subset: '1' });
    });

    it('reports a weak match as unresolved rather than opening the wrong dive', async () => {
        const id = await addObservation({ video: WEAK_VIDEO, mediaPosition: '00:00:01.0000000', frames: [25, 50] });

        const response = await global.api.post(ROUTE).send({ observation_ids: [id] });

        expect(response.status).toBe(200);
        expect(response.body.videos[0].jellyfin_item_id).toBeNull();
        expect(response.body.videos[0].unresolved_reason).toMatch(/scored 60/);
    });

    it('refuses a request that names no observations', async () => {
        const response = await global.api.post(ROUTE).send({ observation_ids: [] });

        expect(response.status).toBe(400);
    });

    it('requires a signed-in reader', async () => {
        const response = await request(app).post(ROUTE).send({ observation_ids: [1] });

        expect(response.status).toBe(401);
    });
});
