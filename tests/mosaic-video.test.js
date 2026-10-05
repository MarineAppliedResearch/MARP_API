/**
 * Endpoint tests for the Mosaic video page's two reads (#181): every observation in the
 * opened observation's video that the Mosaic's query matches, and their keyframes a time
 * window at a time.
 *
 * At the HTTP tier, through the real routes and their permission, against rows this file
 * seeds and removes. Jellyfin is stubbed, as in mosaic-video-context.test.js: which item a
 * filename resolves to is the thumbnail pass's rule and tested there.
 *
 * @fileoverview Endpoint tests for POST /api/v2/mosaic/video/observations and /keyframes.
 * @module tests/mosaic-video
 */

const request = require('supertest');

const app = require('../app');
const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');

const { QueryTypes } = db.Sequelize;

const OBSERVATIONS = '/api/v2/mosaic/video/observations';
const KEYFRAMES = '/api/v2/mosaic/video/keyframes';

/** Unique per run, so a failed run's rows are recognisable and nothing collides. */
const runId = Date.now();
const VIDEO = `jest-mosaic-video-${runId}.mp4`;
const OTHER_VIDEO = `jest-mosaic-video-other-${runId}.mp4`;

/** Not 25, so the GUI rule and the GPU rule give different times. */
const NOMINAL = 29.97;

const seeded = { projectId: null, jobId: null, observationIds: [], species: [] };

function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Seed one observation and its keyframes.
 *
 * @param {Object} row - `{ video, jobId, speciesId, frames }`, frames ascending.
 * @returns {Promise<number>} The observation id.
 */
async function addObservation({ video, jobId = null, speciesId, frames }) {
    const [inserted] = await q(
        `INSERT INTO observations
             (project_id, "obsID", comname, species_id, tc, video_source, "mediaPosition", gpu_job_id, "createdAt", "updatedAt")
         VALUES (:projectId, :obsID, 'Jest species', :speciesId, '10:00:00', :video, '00:00:12.0000000', :jobId, NOW(), NOW())
         RETURNING observation_id`,
        { projectId: seeded.projectId, obsID: seeded.observationIds.length + 1, speciesId, video, jobId }
    );
    seeded.observationIds.push(inserted.observation_id);

    for (const [index, framenum] of frames.entries()) {
        const type = index === 0 ? 'start' : index === frames.length - 1 ? 'end' : 'middle';
        await db.sequelize.query(
            `INSERT INTO keyframes (observation_id, subset, comname, type, framenum, x, y, width, height, "createdAt", "updatedAt")
             VALUES (:id, '1', 'Jest species', :type, :framenum, 0.123456, 0.5, 0.1, 0.1, NOW(), NOW())`,
            { replacements: { id: inserted.observation_id, type, framenum } }
        );
    }
    return inserted.observation_id;
}

let ids;

beforeAll(async () => {
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id',
        { name: `Jest Mosaic Video ${runId}` }
    );
    seeded.projectId = project.project_id;
    const [job] = await q("INSERT INTO gpu_jobs (kind, spec, state) VALUES ('inference', '{}'::jsonb, 'cancelled') RETURNING id");
    seeded.jobId = job.id;
    // Two catalogue species, only referenced: the baseline builds the catalogue.
    seeded.species = (await q('SELECT id FROM species ORDER BY id LIMIT 2')).map((row) => row.id);

    // On VIDEO: a GUI row of the first species (frames at 25: 10 s to 20 s), a GPU row of
    // the second species (frames at 29.97: 100 s to 110 s), and a GUI row of the second
    // species long enough to cross the window used below (frames 0 s to 400 s, with
    // middles at 100 s and 300 s). One observation on another video.
    const [a, b] = seeded.species;
    ids = {
        gui: await addObservation({ video: VIDEO, speciesId: a, frames: [250, 375, 500] }),
        gpu: await addObservation({ video: VIDEO, jobId: seeded.jobId, speciesId: b, frames: [Math.round(100 * NOMINAL), Math.round(110 * NOMINAL)] }),
        long: await addObservation({ video: VIDEO, speciesId: b, frames: [0, 2500, 7500, 10000] }),
        elsewhere: await addObservation({ video: OTHER_VIDEO, speciesId: a, frames: [250, 500] }),
    };
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
        await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids: seeded.observationIds } });
    }
    if (seeded.jobId) {
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id = :id', { replacements: { id: seeded.jobId } });
    }
    if (seeded.projectId) {
        await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
    }
});

describe('the video page\'s observations (#181)', () => {
    it('answers every observation in the video the query matches, with spans in seconds by each row\'s rule', async () => {
        const response = await global.api.post(OBSERVATIONS).send({ observation_id: ids.gui, filters: {} });
        expect(response.status).toBe(200);
        expect(response.body.video).toMatchObject({ video_source: VIDEO, jellyfin_item_id: `jest-item-${runId}`, frame_rate: NOMINAL });
        expect(response.body.opened).toEqual({ observation_id: ids.gui, moment_s: 12 });

        const byId = new Map(response.body.observations.map((row) => [row.observation_id, row]));
        expect([...byId.keys()].sort()).toEqual([ids.gui, ids.gpu, ids.long].sort());
        // GUI rows at 25, whatever the video; GPU rows at its nominal rate.
        expect(byId.get(ids.gui)).toMatchObject({ start_s: 10, end_s: 20, species_id: seeded.species[0] });
        expect(byId.get(ids.gpu).start_s).toBeCloseTo(100, 1);
        expect(byId.get(ids.gpu).end_s).toBeCloseTo(110, 1);
        expect(response.body.truncated).toBe(false);
    });

    it('applies the Mosaic\'s filters, and always includes the observation that was opened', async () => {
        const [, second] = seeded.species;
        const response = await global.api.post(OBSERVATIONS).send({ observation_id: ids.gui, filters: { species: [second] } });
        expect(response.status).toBe(200);
        // The opened one is the first species, so the filter alone would drop it.
        expect(response.body.observations.map((row) => row.observation_id).sort()).toEqual([ids.gui, ids.gpu, ids.long].sort());

        const narrower = await global.api.post(OBSERVATIONS).send({ observation_id: ids.gpu, filters: { species: [seeded.species[0]] } });
        expect(narrower.body.observations.map((row) => row.observation_id).sort()).toEqual([ids.gui, ids.gpu].sort());
    });

    it('refuses a filter it cannot answer, and an observation that does not exist', async () => {
        expect((await global.api.post(OBSERVATIONS).send({ observation_id: ids.gui, filters: { species: ['cod'] } })).status).toBe(400);
        expect((await global.api.post(OBSERVATIONS).send({ observation_id: 'x' })).status).toBe(400);
        expect((await global.api.post(OBSERVATIONS).send({ observation_id: 2147483000 })).status).toBe(404);
    });
});

describe('the video page\'s keyframes, a window at a time (#181)', () => {
    it('answers the keyframes in the window and each track\'s nearest either side, with ids, in seconds', async () => {
        const response = await global.api.post(KEYFRAMES).send({ observation_ids: [ids.gui, ids.long], from_s: 12, to_s: 18 });
        expect(response.status).toBe(200);
        expect(response.body.frame_rate).toBe(NOMINAL);

        const times = (id) => response.body.keyframes.filter((k) => k.observation_id === id).map((k) => k.t);
        // GUI row: 15 s is inside; 10 s and 20 s are its neighbours either side.
        expect(times(ids.gui)).toEqual([10, 15, 20]);
        // The long row has nothing inside; its keyframes either side, 0 s and 100 s, still come,
        // so its box is drawn across the window.
        expect(times(ids.long)).toEqual([0, 100]);

        const keyframe = response.body.keyframes[0];
        expect(Number.isInteger(keyframe.keyframe_id)).toBe(true);
        expect(keyframe).toMatchObject({ x: 0.1235, y: 0.5, width: 0.1, height: 0.1, subset: '1' });
    });

    it('turns the window into each row\'s own frame numbers', async () => {
        const response = await global.api.post(KEYFRAMES).send({ observation_ids: [ids.gpu], from_s: 99, to_s: 101 });
        const times = response.body.keyframes.map((k) => k.t);
        expect(times).toHaveLength(2);
        expect(times[0]).toBeCloseTo(100, 1);
        expect(times[1]).toBeCloseTo(110, 1);
    });

    it('refuses observations from two videos, a backwards window, and a window too long', async () => {
        expect((await global.api.post(KEYFRAMES).send({ observation_ids: [ids.gui, ids.elsewhere], from_s: 0, to_s: 10 })).status).toBe(400);
        expect((await global.api.post(KEYFRAMES).send({ observation_ids: [ids.gui], from_s: 10, to_s: 5 })).status).toBe(400);
        expect((await global.api.post(KEYFRAMES).send({ observation_ids: [ids.gui], from_s: 0, to_s: 10000 })).status).toBe(400);
    });

    it('requires a signed-in reader', async () => {
        expect((await request(app).post(KEYFRAMES).send({ observation_ids: [1], from_s: 0, to_s: 1 })).status).toBe(401);
        expect((await request(app).post(OBSERVATIONS).send({ observation_id: 1 })).status).toBe(401);
    });
});
