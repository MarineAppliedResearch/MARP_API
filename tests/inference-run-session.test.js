/**
 * The session an inference run makes for itself.
 *
 * **One session per run, by Isaac's decision on 2026-10-27**, taken with the cost on the
 * table: a dive scanned in six submissions becomes six sessions on the annotation GUI's
 * opening screen. So the test that matters most here is the one asserting a *second*
 * submission over the same dive does **not** reuse the first — which is the opposite of
 * what `spec.session = {project_id, dive, line, type}` does, deliberately, and those two
 * tests in `gpu-observation-ingest.test.js` must keep passing beside these.
 *
 * **Type is derived, not asked for.** A session's type chooses the species list its
 * observations are read against, and a model's species already say which. The refusal
 * when a model spans two lists is the interesting half: picking either would file half
 * the output against a list that cannot name it.
 *
 * @fileoverview The per-run inference session.
 * @author Isaac Travers
 * @module tests/inference-run-session
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');
const ingestRepository = require('../repository/observation-ingest.repository');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = {
    projectId: null,
    oneListModel: null,
    twoListModel: null,
    speciesIds: [],
    sessionIds: [],
    jobIds: [],
};

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
 * A model with the given species lists mapped to it.
 *
 * @async
 * @param {string} label - Distinguishes it in the registry.
 * @param {Array<string>} lists - One species row per list named.
 * @returns {Promise<number>} The model id.
 */
async function registerModel(label, lists) {
    const [model] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, is_base, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, false, NOW(), NOW()) RETURNING id`,
        { name: `jest-runsession-${label}-${runId}` }
    );

    for (const list of lists) {
        const [species] = await query(
            `INSERT INTO species (taxserial, comname, species_list, created_at, updated_at)
             VALUES (:taxserial, :comname, :list, NOW(), NOW()) RETURNING id`,
            {
                taxserial: 920000000 + made.speciesIds.length + (runId % 10000),
                comname: `jest-${label}-${list}-${runId}`,
                list,
            }
        );

        made.speciesIds.push(species.id);

        await db.sequelize.query(
            `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
             VALUES (:modelId, :speciesId, NOW(), NOW())`,
            { replacements: { modelId: model.id, speciesId: species.id }, logging: false }
        );
    }

    return model.id;
}

/**
 * A submission body, with whatever the test wants to vary.
 *
 * A bare `url` rather than a Jellyfin item, so nothing here needs the media server, and
 * an explicit range, so nothing needs a frame count derived from one.
 *
 * @param {Object} [session] - What to put in `spec.session`.
 * @param {Object} [extra] - Merged over the body.
 * @returns {Object} The body to POST.
 */
function submission(session, extra = {}) {
    return {
        kind: 'inference',
        ...extra,
        spec: {
            engine: 'marp_tracking',
            video: { url: 'https://example.invalid/jest.mp4', source_name: `jest-${runId}.mp4` },
            model: {
                ml_model_id: made.oneListModel,
                name: `jest-runsession-one-${runId}`,
                sha256: 'a'.repeat(64),
                url: `/api/v2/model/${made.oneListModel}/artifact`,
            },
            reduction: { name: 'v3_dirpad', version: '1' },
            range: { start_frame: 0, end_frame: 100 },
            session,
            ...(extra.spec || {}),
        },
    };
}

/**
 * Submit, and remember anything it created so teardown can remove it.
 *
 * @async
 * @param {Object} body - The submission.
 * @returns {Promise<Object>} The supertest response.
 */
async function submit(body) {
    const res = await global.api.post('/api/v2/gpu/jobs').send(body);

    for (const job of (res.body && res.body.jobs) || []) made.jobIds.push(job.id);
    if (res.body && res.body.session) made.sessionIds.push(res.body.session.session_id);

    return res;
}

beforeAll(async () => {
    const [project] = await query(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, NOW(), NOW()) RETURNING project_id',
        { name: `jest-runsession-${runId}` }
    );

    made.projectId = project.project_id;
    made.oneListModel = await registerModel('one', ['Inverts']);
    made.twoListModel = await registerModel('two', ['Fish', 'Inverts']);
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });

    if (made.jobIds.length) await drop('DELETE FROM gpu_jobs WHERE id IN (:ids)', { ids: made.jobIds });
    if (made.sessionIds.length) await drop('DELETE FROM sessions WHERE session_id IN (:ids)', { ids: made.sessionIds });

    for (const id of [made.oneListModel, made.twoListModel]) {
        if (id) await drop('DELETE FROM model_species WHERE model_id = :id', { id });
        if (id) await drop('DELETE FROM ml_models WHERE id = :id', { id });
    }

    if (made.speciesIds.length) await drop('DELETE FROM species WHERE id IN (:ids)', { ids: made.speciesIds });
    if (made.projectId) await drop('DELETE FROM projects WHERE project_id = :id', { id: made.projectId });
});

describe('A run that asks for its own session', () => {
    it('creates one, and says which it made', async () => {
        const res = await submit(submission({
            project_id: made.projectId, dive: `jest-dive-${runId}`, line: '1', per_run: true,
        }));

        expect(res.status).toBe(200);
        expect(res.body.session).toBeTruthy();

        const [session] = await query('SELECT * FROM sessions WHERE session_id = :id',
            { id: res.body.session.session_id });

        expect(session.dive).toBe(`jest-dive-${runId}`);

        // The convention every existing session uses, and what findOrCreateSession writes.
        expect(session.lineId).toBe(`jest-dive-${runId}_1`);

        // Two facts one column cannot hold: the producer is the service user, the
        // requester is whoever submitted. Every automated session shares the first.
        expect(session.user_id).toBe(await ingestRepository.inferenceProcessorId());
        expect(session.is_automated).toBe(true);

        const [job] = await query('SELECT created_by, spec FROM gpu_jobs WHERE id = :id',
            { id: res.body.jobs[0].id });

        expect(job.created_by).not.toBeNull();
        expect(session.created_by).toBe(job.created_by);

        // The stored spec names the session, so the ingest resolves it by id.
        expect(job.spec.session).toEqual({ session_id: session.session_id });
    });

    it('derives the type from the model rather than asking for it', async () => {
        // `Inverts` is the model's list, and the session type that reads it is `Invert` --
        // the two differ, so a derivation that simply echoed the list would be wrong here.
        const [session] = await query('SELECT type FROM sessions WHERE session_id = :id',
            { id: made.sessionIds[0] });

        expect(session.type).toBe('Invert');
    });

    it('makes a second one rather than reusing the first, which is the decision', async () => {
        // **The whole point, and the opposite of the descriptive form.** `spec.session =
        // {project_id, dive, line, type}` finds the existing session for that dive and
        // line; per_run does not, because who ran it differs between runs.
        const before = made.sessionIds.length;

        const res = await submit(submission({
            project_id: made.projectId, dive: `jest-dive-${runId}`, line: '1', per_run: true,
        }));

        expect(res.status).toBe(200);
        expect(made.sessionIds.length).toBe(before + 1);
        expect(res.body.session.session_id).not.toBe(made.sessionIds[0]);

        const rows = await query(
            'SELECT session_id FROM sessions WHERE project_id = :projectId AND dive = :dive',
            { projectId: made.projectId, dive: `jest-dive-${runId}` }
        );

        expect(rows).toHaveLength(2);
    });

    it('shares one session across the pieces of a split, because that is one run', async () => {
        const res = await submit(submission(
            { project_id: made.projectId, dive: `jest-split-${runId}`, line: '2', per_run: true },
            { piece_frames: 40 }
        ));

        expect(res.status).toBe(200);
        expect(res.body.jobs.length).toBeGreaterThan(1);

        const ids = new Set(await Promise.all(res.body.jobs.map(async (job) => {
            const [row] = await query('SELECT spec FROM gpu_jobs WHERE id = :id', { id: job.id });

            return row.spec.session.session_id;
        })));

        expect(ids.size).toBe(1);
        expect([...ids][0]).toBe(res.body.session.session_id);
    });

    it('lets a named type win over the derived one', async () => {
        const res = await submit(submission({
            project_id: made.projectId, dive: `jest-named-${runId}`, line: '3', type: 'Fish', per_run: true,
        }));

        expect(res.status).toBe(200);

        const [session] = await query('SELECT type FROM sessions WHERE session_id = :id',
            { id: res.body.session.session_id });

        expect(session.type).toBe('Fish');
    });
});

describe('A run that asks for a session it cannot have', () => {
    it('refuses a model trained across two species lists', async () => {
        // Picking either list would file half this model's output against one that
        // cannot name it, so there is no safe default to take.
        const res = await submit(submission(
            { project_id: made.projectId, dive: `jest-two-${runId}`, line: '4', per_run: true },
            { spec: { model: {
                ml_model_id: made.twoListModel,
                name: `jest-runsession-two-${runId}`,
                sha256: 'b'.repeat(64),
                url: `/api/v2/model/${made.twoListModel}/artifact`,
            } } }
        ));

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/more than one species list/i);
    });

    it('refuses per_run beside a session_id, which ask opposite things', async () => {
        const res = await submit(submission({ session_id: 1, per_run: true }));

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/opposite things/i);
    });

    it('refuses a per-run form with no dive', async () => {
        const res = await submit(submission({ project_id: made.projectId, line: '5', per_run: true }));

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/spec\.session\.dive is required/i);
    });

    it('creates no session when the submission is refused after it', async () => {
        // **The orphan check.** A session written before a bad range was caught would be
        // an empty automated session on the GUI's opening screen, left by a submission
        // that never happened. An equal-bounds range is refused well after the per-run
        // form is resolved.
        const dive = `jest-orphan-${runId}`;

        const res = await submit(submission(
            { project_id: made.projectId, dive, line: '6', per_run: true },
            { spec: { range: { start_frame: 10, end_frame: 10 } } }
        ));

        expect(res.status).toBe(400);

        const rows = await query('SELECT session_id FROM sessions WHERE dive = :dive', { dive });

        expect(rows).toHaveLength(0);
    });
});
