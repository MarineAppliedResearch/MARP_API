/**
 * The Mosaic's run filter (#336).
 *
 * Scientific data is read per run for each dive (Isaac, 2026-11-09), so the same model run
 * twice on a video is never counted together. **A run is the whole submission for a dive**
 * -- every video, every piece -- recorded as `gpu_jobs.submission_id`. A job with none, from
 * before it existed, is a run of one, `job-<id>`. This seeds a submission covering two
 * videos, a job with no submission, both named alike on the same model, and an observation
 * no run made, and asks for each. It also submits through the route, which records one.
 *
 * @fileoverview The run dimension of the Mosaic's filters and facets, and submission ids.
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
const submission = crypto.randomUUID();

const q = (sql, replacements = {}) => db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });

/** One finished inference job, in a submission or with none, `minutesAgo` before now. */
async function addJob(submissionId, minutesAgo) {
    const [job] = await q(
        `INSERT INTO gpu_jobs (kind, batch_id, submission_id, name, spec, state, priority, attempts_made, yields_made,
                               max_attempts, finished_at, created_at, updated_at)
         VALUES ('inference', :batchId, :submissionId, :name, '{}', 'succeeded', 0, 1, 0, 3,
                 NOW(), NOW() - (:minutesAgo * interval '1 minute'), NOW())
         RETURNING id`,
        // A video of a submission is a batch of its own; a job from before submissions is
        // a single piece, with neither.
        { batchId: submissionId ? crypto.randomUUID() : null, submissionId, name: `Jest Run ${runId}`, minutesAgo }
    );
    made.jobIds.push(job.id);
    return job.id;
}

/** One observation in `video` made by `jobId`, or by no run at all. */
async function addObservation(jobId, obsID, video = 'jest-a.mp4') {
    const [row] = await q(
        `INSERT INTO observations (session_id, project_id, "obsID", confidence, comname, tc,
                                   ml_model_id, gpu_job_id, video_source, "createdAt", "updatedAt")
         VALUES (:sessionId, :projectId, :obsID, 0.5, :comname, '10:00:00', :modelId, :jobId, :video, NOW(), NOW())
         RETURNING observation_id`,
        { sessionId: made.sessionId, projectId: made.projectId, obsID, comname: `Jest Run ${runId}`,
            modelId: jobId ? made.modelId : null, jobId, video: `${runId}-${video}` }
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

    // The same model on the same dive twice: a submission an hour ago covering two videos,
    // each its own batch, and a job since with no submission. Same name, which is why a run
    // is labelled by more than its name.
    const videoA = await addJob(submission, 60);
    const videoB = await addJob(submission, 60);
    const single = await addJob(null, 5);
    ids.submission = [await addObservation(videoA, 1, 'jest-a.mp4'), await addObservation(videoB, 2, 'jest-b.mp4')];
    ids.single = [await addObservation(single, 3)];
    ids.byHand = [await addObservation(null, 4)];
    ids.singleRun = `job-${single}`;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
    if (made.observationIds.length) await drop('DELETE FROM observations WHERE observation_id IN (:ids)', { ids: made.observationIds });
    if (made.jobIds.length) {
        await drop('DELETE FROM gpu_job_events WHERE attempt_id IN (SELECT id FROM gpu_job_attempts WHERE job_id IN (:ids))', { ids: made.jobIds });
        await drop('DELETE FROM gpu_job_attempts WHERE job_id IN (:ids)', { ids: made.jobIds });
        await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    }
    if (made.sessionId) await drop('DELETE FROM sessions WHERE session_id = :id', { id: made.sessionId });
    if (made.modelId) await drop('DELETE FROM ml_models WHERE id = :id', { id: made.modelId });
    if (made.projectId) await drop('DELETE FROM projects WHERE project_id = :id', { id: made.projectId });
});

describe('the run filter (#336)', () => {

    it('lists each submission once, newest first, labelled by name, model, when and its videos', async () => {
        const res = await global.api.post(FACETS).send({ filters: question(), dimensions: ['run'] });
        expect(res.status).toBe(200);

        const runs = res.body.facets.run;
        expect(runs.map((entry) => entry.value)).toEqual([ids.singleRun, submission]);
        expect(runs.map((entry) => entry.count)).toEqual([1, 2]);

        // Same name, told apart by the rest of the label; the submission covers both videos.
        const label = (videos) => new RegExp(
            `^Jest Run ${runId} · Jest Run Model ${runId} · \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} · ${videos}$`);
        expect(runs[0].label).toMatch(label('1 video'));
        expect(runs[1].label).toMatch(label('2 videos'));
    });

    it('answers only the chosen run, a submission of two videos as one', async () => {
        expect(await idsFor(question({ run: [submission] }))).toEqual(ids.submission);
        expect(await idsFor(question({ run: [ids.singleRun] }))).toEqual(ids.single);
        expect(await idsFor(question({ run: [submission, ids.singleRun] }))).toEqual([...ids.submission, ...ids.single]);
    });

    it('never answers an observation no run made', async () => {
        expect(await idsFor(question())).toEqual(expect.arrayContaining(ids.byHand));
        expect(await idsFor(question({ run: [submission, ids.singleRun] }))).not.toEqual(expect.arrayContaining(ids.byHand));
    });

    it('refuses something that is not a run id', async () => {
        const res = await global.api.post(PAGES).send({ filters: question({ run: ['Dive01'] }), pageSize: 45, pages: [1] });
        expect(res.status).toBe(400);
    });

    describe('a submission through the route records one', () => {
        const spec = () => ({
            engine: 'ultralytics',
            model: { name: `jest-run-model-${runId}`, sha256: 'a'.repeat(64) },
            video: { url: `http://jest.invalid/media/jest-run-${runId}.mp4`, source_name: 'jest-run.mp4' },
            range: { start_frame: 0, end_frame: 100 },
            reduction: { name: 'v3_dirpad', version: 1 },
        });
        const submit = async (extra) => {
            const res = await global.api.post('/api/v2/gpu/jobs').send({ kind: 'inference', spec: spec(), ...extra });
            if (res.status === 200) {
                const jobIds = res.body.jobs.map((job) => job.id);
                made.jobIds.push(...jobIds);
                // Not left queued for a poll anywhere else to take.
                await db.sequelize.query("UPDATE gpu_jobs SET state = 'cancelled' WHERE id IN (:ids)",
                    { replacements: { ids: jobIds } });
            }
            return res;
        };
        const stored = async (id) => (await q('SELECT submission_id FROM gpu_jobs WHERE id = :id', { id }))[0].submission_id;

        it('keeps the id it is sent, so every video of a click is one run', async () => {
            const sent = crypto.randomUUID();
            const first = await submit({ submission_id: sent });
            const second = await submit({ submission_id: sent });
            expect(await stored(first.body.jobs[0].id)).toBe(sent);
            expect(await stored(second.body.jobs[0].id)).toBe(sent);
        });

        it('makes one when it is sent none, and refuses one that is not a uuid', async () => {
            const res = await submit({});
            expect(await stored(res.body.jobs[0].id)).toMatch(/^[0-9a-f-]{36}$/);
            expect((await submit({ submission_id: 'Dive-119' })).status).toBe(400);
        });
    });
});
