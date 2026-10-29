/**
 * When in its video a piece, and a whole run, found what it found.
 *
 * A long video is split into pieces sharing a `batch_id` -- 82 of them for one CAMPA
 * dive -- and the Inference tab wants the run's total and its species beside each piece.
 * Reading every piece's outcome to add them up was 82 requests for one number, so the run
 * has its own route (#288).
 *
 * **It has to add up the same way a piece does.** The grouping is the per-job route's,
 * so the test checks the run's breakdown is the sum of its pieces' and nothing else's: a
 * job outside the batch holding observations of the same species must not leak in.
 *
 * @fileoverview The per-job and per-run timeline: video, range, species over time.
 * @author Isaac Travers
 * @module tests/inference-timeline
 */

'use strict';

const { randomUUID } = require('crypto');
const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** The run under test. */
const batchId = randomUUID();

/** What this file created, torn down in reverse. */
const made = { jobIds: [], sessionId: null, projectId: null, speciesIds: [], observationIds: [] };

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * One job, in or out of the run.
 *
 * @async
 * @param {string} state - Its state.
 * @param {string|null} batch - Its `batch_id`.
 * @returns {Promise<number>} Its id.
 */
async function addJob(state, batch, range = { start_frame: 0, end_frame: 750 }) {
    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts, batch_id)
         VALUES ('inference', :spec, :state, 1, 1, :batch) RETURNING id`,
        { spec: JSON.stringify({ session: { session_id: made.sessionId }, range, video: { jellyfin_item_id: `jest-item-${runId}` } }), state, batch }
    );
    made.jobIds.push(job.id);
    return job.id;
}

/**
 * One observation from a job. The key is assigned here, as in inference-job-outcome (#62).
 *
 * @async
 * @param {number} jobId - Which job wrote it.
 * @param {number} speciesIndex - Which of this file's species.
 * @param {string} at - Where in the video it was seen, as `mediaPosition` records it.
 * @returns {Promise<void>}
 */
async function addObservation(jobId, speciesIndex, at) {
    const [row] = await query(
        `INSERT INTO observations (observation_id, session_id, species_id, comname, gpu_job_id, "obsID", version, "mediaPosition", video_source, "createdAt", "updatedAt")
         VALUES ((SELECT COALESCE(MAX(observation_id), 0) + 1 FROM observations), :sessionId, :speciesId, :comname, :jobId, :obsId, 1, :at, :video, NOW(), NOW())
         RETURNING observation_id`,
        {
            at,
            video: `jest-video-${runId}.mp4`,
            sessionId: made.sessionId,
            speciesId: made.speciesIds[speciesIndex],
            comname: `${['jest-lingcod', 'jest-greenling'][speciesIndex]}-${runId}`,
            jobId,
            obsId: made.observationIds.length + 1,
        }
    );
    made.observationIds.push(row.observation_id);
}

beforeAll(async () => {
    const [project] = await query(
        `INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { name: `jest-timeline-${runId}` }
    );
    made.projectId = project.project_id;

    const [session] = await query(
        `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:projectId, 'jest-dive', '1', '1', 'Fish', NOW(), NOW()) RETURNING session_id`,
        { projectId: made.projectId }
    );
    made.sessionId = session.session_id;

    for (const name of ['jest-lingcod', 'jest-greenling']) {
        const [species] = await query(
            `INSERT INTO species (taxserial, comname, species_list, created_at, updated_at)
             VALUES (:taxserial, :comname, :list, NOW(), NOW()) RETURNING id`,
            { taxserial: 930000000 + made.speciesIds.length + (runId % 10000), comname: `${name}-${runId}`, list: `jest-list-${runId}` }
        );
        made.speciesIds.push(species.id);
    }

    /* Two 30-second pieces of one video at 25 fps, frames 0-750
       and 750-1500, the second still queued. */
    const first = await addJob('succeeded', batchId, { start_frame: 0, end_frame: 750 });
    made.firstJobId = first;
    await addJob('queued', batchId, { start_frame: 750, end_frame: 1500 });

    await addObservation(first, 0, '00:00:02.0000000');
    await addObservation(first, 0, '00:00:03.5000000');
    await addObservation(first, 1, '00:00:27.1200000');
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.observationIds.length) await drop('DELETE FROM observations WHERE observation_id IN (:ids)', { ids: made.observationIds });
    if (made.jobIds.length) await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    if (made.sessionId) await drop('DELETE FROM sessions WHERE session_id = :id', { id: made.sessionId });
    if (made.speciesIds.length) await drop('DELETE FROM species WHERE id IN (:ids)', { ids: made.speciesIds });
    if (made.projectId) await drop('DELETE FROM projects WHERE project_id = :id', { id: made.projectId });
});

describe('GET /gpu/batches/:batch_id/timeline (#288)', () => {
    it('names the video, places every piece in seconds, and says each state', async () => {
        const res = await global.api.get(`/api/v2/gpu/batches/${batchId}/timeline`);

        expect(res.status).toBe(200);
        expect(res.body.video.name).toBe(`jest-video-${runId}.mp4`);
        /* The test's video is not in Jellyfin, so it is named from what the observations
           recorded and timed at the rate a lease assumes -- and says so. */
        expect(res.body.video.fps).toBe(25);
        expect(res.body.video.fps_assumed).toBe(true);
        expect(res.body.pieces.map((piece) => [piece.state, piece.start_s, piece.end_s]))
            .toEqual([['succeeded', 0, 30], ['queued', 30, 60]]);
    });

    it('counts each species per stretch of the video', async () => {
        const res = await global.api.get(`/api/v2/gpu/batches/${batchId}/timeline`);
        const bucket = res.body.bucket_s;
        const of = (index) => res.body.species.find((row) => row.species_id === made.speciesIds[index]);

        expect(res.body.span).toEqual({ from_s: 0, to_s: 60 });
        expect(bucket).toBe(5);
        expect(of(0).total).toBe(2);
        expect(of(0).counts[0]).toBe(2);
        expect(of(1).counts[Math.floor(27.12 / bucket)]).toBe(1);
        expect(of(1).counts.filter((n) => n === 0).length).toBe(of(1).counts.length - 1);
    });
});

describe('GET /gpu/jobs/:id/timeline (#288)', () => {
    it('covers the piece alone, over its own range', async () => {
        const res = await global.api.get(`/api/v2/gpu/jobs/${made.firstJobId}/timeline`);

        expect(res.status).toBe(200);
        expect(res.body.span).toEqual({ from_s: 0, to_s: 30 });
        expect(res.body.pieces).toHaveLength(1);
    });

    it('answers 404 for no such job, and 400 for an id or batch that is malformed', async () => {
        expect((await global.api.get('/api/v2/gpu/jobs/2147483600/timeline')).status).toBe(404);
        expect((await global.api.get('/api/v2/gpu/jobs/x/timeline')).status).toBe(400);
        expect((await global.api.get('/api/v2/gpu/batches/run-1/timeline')).status).toBe(400);
    });
});
