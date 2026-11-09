/**
 * The Mosaic's run filter (#336).
 *
 * Scientific data is read per run for each dive (Isaac, 2026-11-09), so the same model run
 * twice on a video is never counted together. A run is one ML Dashboard submission -- its
 * pieces share `gpu_jobs.batch_id` -- and a job submitted on its own is a run of one,
 * `job-<id>`. This seeds both, with the same name and the same model, plus an observation
 * no run made, and asks for each.
 *
 * @fileoverview The run dimension of the Mosaic's filters and facets.
 * @author Isaac Travers
 * @module tests/mosaic-run-filter
 */

'use strict';

const crypto = require('crypto');
const db = require('../model');

const { QueryTypes } = db.Sequelize;

const FACETS = '/api/v2/mosaic/observations/facets';
const PAGES = '/api/v2/mosaic/observations/pages';

const runId = Date.now();
const made = { projectId: null, modelId: null, sessionId: null, jobIds: [], observationIds: [] };
const batch = crypto.randomUUID();

const q = (sql, replacements = {}) => db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });

/** One finished inference job, in a batch or on its own, `minutesAgo` before now. */
async function addJob(batchId, minutesAgo) {
    const [job] = await q(
        `INSERT INTO gpu_jobs (kind, batch_id, name, spec, state, priority, attempts_made, yields_made, max_attempts,
                               finished_at, created_at, updated_at)
         VALUES ('inference', :batchId, :name, '{}', 'succeeded', 0, 1, 0, 3,
                 NOW(), NOW() - (:minutesAgo * interval '1 minute'), NOW())
         RETURNING id`,
        { batchId, name: `Jest Run ${runId}`, minutesAgo }
    );
    made.jobIds.push(job.id);
    return job.id;
}

/** One observation made by `jobId`, or by no run at all. */
async function addObservation(jobId, obsID) {
    const [row] = await q(
        `INSERT INTO observations (session_id, project_id, "obsID", confidence, comname, tc,
                                   ml_model_id, gpu_job_id, "createdAt", "updatedAt")
         VALUES (:sessionId, :projectId, :obsID, 0.5, :comname, '10:00:00', :modelId, :jobId, NOW(), NOW())
         RETURNING observation_id`,
        { sessionId: made.sessionId, projectId: made.projectId, obsID, comname: `Jest Run ${runId}`,
            modelId: jobId ? made.modelId : null, jobId }
    );
    made.observationIds.push(row.observation_id);
    return row.observation_id;
}

const question = (extra = {}) => ({ project: [`Jest Run Project ${runId}`], ...extra });

/** The ids a page query answers for `filters`. */
async function idsFor(filters) {
    const res = await global.api.post(PAGES).send({ filters, pageSize: 45, pages: [1] });
    expect(res.status).toBe(200);
    return res.body.pages[0].rows.map((row) => row.observation_id).sort((a, b) => a - b);
}

const ids = {};

beforeAll(async () => {
    [{ project_id: made.projectId }] = await q(
        `INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { name: `Jest Run Project ${runId}` });
    [{ id: made.modelId }] = await q(
        `INSERT INTO ml_models (name, model_type, status, created_at, updated_at)
         VALUES (:name, 'detector', 'archived', NOW(), NOW()) RETURNING id`,
        { name: `Jest Run Model ${runId}` });
    [{ session_id: made.sessionId }] = await q(
        `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:projectId, :dive, 'L1', 'L1', 'JestFish', NOW(), NOW()) RETURNING session_id`,
        { projectId: made.projectId, dive: `JEST-RUN-${runId}` });

    // The same model on the same dive twice: a run in two pieces an hour ago, and a run of
    // one since. Same name, which is why a run is labelled by more than its name.
    const pieceA = await addJob(batch, 60);
    const pieceB = await addJob(batch, 59);
    const single = await addJob(null, 5);
    ids.batch = [await addObservation(pieceA, 1), await addObservation(pieceB, 2)];
    ids.single = [await addObservation(single, 3)];
    ids.byHand = [await addObservation(null, 4)];
    ids.singleRun = `job-${single}`;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
    if (made.observationIds.length) await drop('DELETE FROM observations WHERE observation_id IN (:ids)', { ids: made.observationIds });
    if (made.jobIds.length) await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    if (made.sessionId) await drop('DELETE FROM sessions WHERE session_id = :id', { id: made.sessionId });
    if (made.modelId) await drop('DELETE FROM ml_models WHERE id = :id', { id: made.modelId });
    if (made.projectId) await drop('DELETE FROM projects WHERE project_id = :id', { id: made.projectId });
});

describe('the run filter (#336)', () => {

    it('lists each run once, newest first, labelled by name, model and when', async () => {
        const res = await global.api.post(FACETS).send({ filters: question(), dimensions: ['run'] });
        expect(res.status).toBe(200);

        const runs = res.body.facets.run;
        expect(runs.map((entry) => entry.value)).toEqual([ids.singleRun, batch]);
        expect(runs.map((entry) => entry.count)).toEqual([1, 2]);

        // Same name, told apart by the rest of the label.
        for (const entry of runs) {
            expect(entry.label).toMatch(new RegExp(`^Jest Run ${runId} · Jest Run Model ${runId} · \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$`));
        }
        expect(runs[0].label).not.toBe(runs[1].label);
    });

    it('answers only the chosen run, a run of two pieces as one', async () => {
        expect(await idsFor(question({ run: [batch] }))).toEqual(ids.batch);
        expect(await idsFor(question({ run: [ids.singleRun] }))).toEqual(ids.single);
        expect(await idsFor(question({ run: [batch, ids.singleRun] }))).toEqual([...ids.batch, ...ids.single]);
    });

    it('never answers an observation no run made', async () => {
        expect(await idsFor(question())).toEqual(expect.arrayContaining(ids.byHand));
        expect(await idsFor(question({ run: [batch, ids.singleRun] }))).not.toEqual(expect.arrayContaining(ids.byHand));
    });

    it('refuses something that is not a run id', async () => {
        const res = await global.api.post(PAGES).send({ filters: question({ run: ['Dive01'] }), pageSize: 45, pages: [1] });
        expect(res.status).toBe(400);
    });
});
