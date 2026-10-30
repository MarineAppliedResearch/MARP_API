/**
 * What every piece of one run produced, together.
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
 * @fileoverview The per-run observation summary.
 * @author Isaac Travers
 * @module tests/inference-batch-outcome
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
async function addJob(state, batch) {
    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts, batch_id)
         VALUES ('inference', :spec, :state, 1, 1, :batch) RETURNING id`,
        { spec: JSON.stringify({ session: { session_id: made.sessionId } }), state, batch }
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
 * @returns {Promise<void>}
 */
async function addObservation(jobId, speciesIndex) {
    const [row] = await query(
        `INSERT INTO observations (observation_id, session_id, species_id, comname, gpu_job_id, "obsID", version, "createdAt", "updatedAt")
         VALUES ((SELECT COALESCE(MAX(observation_id), 0) + 1 FROM observations), :sessionId, :speciesId, :comname, :jobId, :obsId, 1, NOW(), NOW())
         RETURNING observation_id`,
        {
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
        { name: `jest-batch-outcome-${runId}` }
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
            { taxserial: 920000000 + made.speciesIds.length + (runId % 10000), comname: `${name}-${runId}`, list: `jest-list-${runId}` }
        );
        made.speciesIds.push(species.id);
    }

    // Three pieces of one run, two finished and one still queued.
    const first = await addJob('succeeded', batchId);
    const second = await addJob('succeeded', batchId);
    await addJob('queued', batchId);
    // A job outside the run, finding the same species.
    const outside = await addJob('succeeded', null);

    await addObservation(first, 0);
    await addObservation(first, 0);
    await addObservation(second, 0);
    await addObservation(second, 1);
    await addObservation(outside, 1);
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.observationIds.length) await drop('DELETE FROM observations WHERE observation_id IN (:ids)', { ids: made.observationIds });
    if (made.jobIds.length) await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    if (made.sessionId) await drop('DELETE FROM sessions WHERE session_id = :id', { id: made.sessionId });
    if (made.speciesIds.length) await drop('DELETE FROM species WHERE id IN (:ids)', { ids: made.speciesIds });
    if (made.projectId) await drop('DELETE FROM projects WHERE project_id = :id', { id: made.projectId });
});

describe('GET /gpu/batches/:batch_id/observations (#288)', () => {
    it('adds up every piece of the run, and nothing outside it', async () => {
        const res = await global.api.get(`/api/v2/gpu/batches/${batchId}/observations`);

        expect(res.status).toBe(200);
        expect(res.body.observations).toBe(4);
        expect(res.body.pieces).toBe(3);

        const count = (index) => res.body.species
            .filter((row) => row.species_id === made.speciesIds[index])
            .reduce((sum, row) => sum + row.observations, 0);

        expect(count(0)).toBe(3);
        expect(count(1)).toBe(1);
    });

    it('says how far the run has got, so a running total can be called one', async () => {
        const res = await global.api.get(`/api/v2/gpu/batches/${batchId}/observations`);

        expect(res.body.states).toEqual({ succeeded: 2, queued: 1 });
    });

    it('names the run\'s one session, for the mosaic link', async () => {
        const res = await global.api.get(`/api/v2/gpu/batches/${batchId}/observations`);

        expect(res.body.session_id).toBe(made.sessionId);
        expect(res.body.session_ids).toEqual([made.sessionId]);
    });

    it('answers 404 for a run no job carries, and 400 for an id that is not a uuid', async () => {
        expect((await global.api.get(`/api/v2/gpu/batches/${randomUUID()}/observations`)).status).toBe(404);
        expect((await global.api.get('/api/v2/gpu/batches/run-1/observations')).status).toBe(400);
    });
});
