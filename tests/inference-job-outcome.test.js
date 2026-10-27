/**
 * What an inference job produced, which a job state cannot tell you.
 *
 * **`succeeded` does not mean it found anything.** A job succeeds when its bytes arrive
 * and are ingested, and ingesting an empty detections file is a success that produced
 * nothing — job 21789 ran all 400 of its frames, succeeded, and wrote zero observations,
 * correctly. The screen needs the number, not the state.
 *
 * **The grouping is the part worth testing.** An observation carries both a `species_id`
 * and its own `comname`, and they are different facts: a species correction changes the
 * first and deliberately never rewrites the second, which stays the label the model
 * produced. A breakdown keyed on the label would keep counting a corrected observation
 * under a name somebody has already rejected. So the test below corrects one and asserts
 * the count follows the correction.
 *
 * @fileoverview The per-job observation summary.
 * @author Isaac Travers
 * @module tests/inference-job-outcome
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { jobId: null, emptyJobId: null, sessionId: null, projectId: null, speciesIds: [], observationIds: [] };

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
 * Insert one observation for the job under test.
 *
 * `observations` assigns its own key through the repository rather than the sequence
 * (#62), so these go in with SQL and an explicit id.
 *
 * @async
 * @param {Object} params - `{speciesId, comname}`.
 * @returns {Promise<void>} Resolves when written.
 */
async function addObservation({ speciesId, comname }) {
    const [row] = await query(
        /* `obsID` and `version` are NOT NULL, and the key is assigned here rather than
           by a sequence -- `observations` declares its id without autoIncrement (#62),
           so a Sequelize create sends an explicit null and fails. */
        `INSERT INTO observations (observation_id, session_id, species_id, comname, gpu_job_id, "obsID", version, "createdAt", "updatedAt")
         VALUES ((SELECT COALESCE(MAX(observation_id), 0) + 1 FROM observations), :sessionId, :speciesId, :comname, :jobId, :obsId, 1, NOW(), NOW())
         RETURNING observation_id`,
        { sessionId: made.sessionId, speciesId, comname, jobId: made.jobId, obsId: made.observationIds.length + 1 }
    );

    made.observationIds.push(row.observation_id);
}

beforeAll(async () => {
    const [project] = await query(
        `INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { name: `jest-outcome-${runId}` }
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
            { taxserial: 910000000 + made.speciesIds.length + (runId % 10000), comname: `${name}-${runId}`, list: `jest-list-${runId}` }
        );

        made.speciesIds.push(species.id);
    }

    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
         VALUES ('inference', :spec, 'succeeded', 1, 1) RETURNING id`,
        { spec: JSON.stringify({ session: { session_id: made.sessionId }, model: { ml_model_id: 4242 } }) }
    );

    made.jobId = job.id;

    const [empty] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
         VALUES ('inference', :spec, 'succeeded', 1, 1) RETURNING id`,
        { spec: JSON.stringify({ session: { session_id: made.sessionId } }) }
    );

    made.emptyJobId = empty.id;

    // Two of one species, one of the other, and one the ingest never resolved.
    await addObservation({ speciesId: made.speciesIds[0], comname: `jest-lingcod-${runId}` });
    await addObservation({ speciesId: made.speciesIds[0], comname: `jest-lingcod-${runId}` });
    await addObservation({ speciesId: made.speciesIds[1], comname: `jest-greenling-${runId}` });
    await addObservation({ speciesId: null, comname: `jest-unresolved-${runId}` });
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.observationIds.length) {
        await drop('DELETE FROM observations WHERE observation_id IN (:ids)', { ids: made.observationIds });
    }
    for (const id of [made.jobId, made.emptyJobId]) {
        if (id) await drop('DELETE FROM gpu_jobs WHERE id = :id', { id });
    }
    if (made.sessionId) await drop('DELETE FROM sessions WHERE session_id = :id', { id: made.sessionId });
    if (made.speciesIds.length) await drop('DELETE FROM species WHERE id IN (:ids)', { ids: made.speciesIds });
    if (made.projectId) await drop('DELETE FROM projects WHERE project_id = :id', { id: made.projectId });
});

describe('GET /gpu/jobs/:id/observations', () => {
    it('counts what the job wrote and breaks it down by species', async () => {
        const res = await global.api.get(`/api/v2/gpu/jobs/${made.jobId}/observations`);

        expect(res.status).toBe(200);
        expect(res.body.observations).toBe(4);
        expect(res.body.session_id).toBe(made.sessionId);
        expect(res.body.ml_model_id).toBe(4242);

        const top = res.body.species[0];

        expect(top.observations).toBe(2);
        expect(top.species_id).toBe(made.speciesIds[0]);
    });

    it('counts an unresolved species rather than dropping it', async () => {
        // A row the ingest could not resolve is still something the job produced, and a
        // breakdown that omitted it would not add up to the total beside it.
        const res = await global.api.get(`/api/v2/gpu/jobs/${made.jobId}/observations`);
        const unresolved = res.body.species.filter((s) => s.species_id === null);

        expect(unresolved).toHaveLength(1);
        expect(res.body.species.reduce((n, s) => n + s.observations, 0)).toBe(res.body.observations);
    });

    it('follows a species correction rather than the label the model gave', async () => {
        // **The reason this is grouped by species_id.** A correction changes the identity
        // and never rewrites `comname`. Counting by the label would keep this observation
        // under a name somebody has already rejected.
        await db.sequelize.query(
            'UPDATE observations SET species_id = :to WHERE observation_id = :id',
            { replacements: { to: made.speciesIds[1], id: made.observationIds[0] }, logging: false }
        );

        try {
            const res = await global.api.get(`/api/v2/gpu/jobs/${made.jobId}/observations`);
            const corrected = res.body.species.find((s) => s.species_id === made.speciesIds[1]
                && s.reported_name === `jest-lingcod-${runId}`);

            expect(corrected).toBeTruthy();
            expect(corrected.observations).toBe(1);

            // And the label the model gave is still reported, because where the two
            // disagree that disagreement is the point.
            expect(corrected.species_name).toBe(`jest-greenling-${runId}`);
        } finally {
            await db.sequelize.query(
                'UPDATE observations SET species_id = :back WHERE observation_id = :id',
                { replacements: { back: made.speciesIds[0], id: made.observationIds[0] }, logging: false }
            );
        }
    });

    it('answers zero for a job that found nothing, which is not an error', async () => {
        // Job 21789 did exactly this: every frame run, succeeded, nothing detected.
        const res = await global.api.get(`/api/v2/gpu/jobs/${made.emptyJobId}/observations`);

        expect(res.status).toBe(200);
        expect(res.body.observations).toBe(0);
        expect(res.body.species).toEqual([]);
    });

    it('404s a job that does not exist', async () => {
        const res = await global.api.get('/api/v2/gpu/jobs/2147483600/observations');

        expect(res.status).toBe(404);
    });
});
