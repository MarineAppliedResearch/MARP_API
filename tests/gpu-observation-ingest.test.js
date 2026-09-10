/**
 * Endpoint tests for a finished GPU job becoming observations.
 *
 * At the HTTP tier, and through the real worker flow -- submit, lease, hand the
 * artifact over, report the result -- because **the ingest that matters is the one
 * that happens without anybody asking for it.** A service-level test would pass
 * while nothing at all ran when a worker reported success, which is the class of
 * defect this platform keeps finding: verifying at a tier that structurally
 * cannot observe the thing being claimed.
 *
 * Everything these tests need is seeded here rather than assumed. The suite runs
 * in CI against a database built from the baseline plus the migrations and
 * holding no observations, which is what makes it meaningful -- a block that
 * depends on rows the development server happens to have would fail in one place
 * and pass vacuously everywhere else.
 *
 * **The fixture's `confidence` values are hand-added.** `tests/fixtures/gpu-observations-job-1256.jsonl`
 * is the real result file from job 1256 -- six real California sea cucumbers, 78
 * real keyframes, real bounding boxes -- with one key added per observation,
 * because the worker change that emits `confidence` is on a branch in
 * `marp-inference-worker` and is not yet on its `develop`. One of the six is
 * `null`, which is the real case where the reduction chose a frame the tracker had
 * predicted through with no detection behind it.
 *
 * @fileoverview Endpoint tests for ingesting a GPU job's observations.
 * @author Isaac Travers
 * @module tests/gpu-observation-ingest
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');

const db = require('../model');
const ingestRepository = require('../repository/observation-ingest.repository');
const ingestService = require('../service/observation-ingest.service');
const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');
const { classifyRow, parseTimeSpan, absoluteFrame } = require('../db/timecode');

/**
 * Unique per run, so a failed run's leftovers are recognisable and two runs
 * cannot collide on the durable id a worker enrols with.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * Priority every job here is given: above anything a person would queue, so this
 * suite's polls take this suite's jobs.
 *
 * @constant
 * @type {number}
 */
const TEST_PRIORITY = 1000;

/**
 * The real result file from job 1256, with `confidence` added per observation.
 * See this file's header for why the field is hand-added.
 *
 * @constant
 * @type {Array<Object>}
 */
const REAL_RESULT = fs
    .readFileSync(path.join(__dirname, 'fixtures', 'gpu-observations-job-1256.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

/** Job ids this suite created, removed in afterAll. @type {Array<number>} */
const createdJobIds = [];

/** Artifact hashes this suite staged, removed in afterAll. @type {Array<string>} */
const stagedHashes = [];

/** The worker this suite enrols. @type {number|undefined} */
let workerId;

/** Seeded rows, torn down in reverse. @type {Object} */
const seeded = {
    projectId: undefined,
    invertSessionId: undefined,
    fishSessionId: undefined,
    modelId: undefined,
    speciesIds: {},
};

/**
 * Run one statement against the development database.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Look up a species by name and list, failing rather than skipping when it is
 * absent: these come from a migration, so a missing one is a broken database and
 * not a reason for the suite to stop checking anything.
 *
 * @async
 * @param {string} comname - Common name.
 * @param {string} list - `species.species_list`.
 * @returns {Promise<Object>} The species row.
 */
async function speciesRow(comname, list) {
    const [row] = await query(
        'SELECT id, taxserial, comname, species_list FROM species WHERE comname = :comname AND species_list = :list',
        { comname, list }
    );

    if (!row) {
        throw new Error(
            `species has no "${comname}" on the ${list} list. The species lists are imported by `
            + 'migration, so this database is not the one the suite expects.'
        );
    }

    return row;
}

/**
 * A submittable spec.
 *
 * The video is a bare `url`, so nothing here depends on the media server being
 * reachable. `jellyfin_item_id` still reaches the observation, because it comes
 * out of the worker's own result rows rather than out of the spec.
 *
 * @param {Object} [overrides] - Parts of the spec to replace.
 * @returns {Object} The spec.
 */
function specFor(overrides = {}) {
    return {
        engine: 'marp_tracking',
        model: { name: `jest-ingest-model-${runId}`, sha256: 'b'.repeat(64), ml_model_id: seeded.modelId },
        video: { url: `http://jest.invalid/media/jest-ingest-${runId}.mp4`, source_name: 'jest-ingest.mp4' },
        range: { start_frame: 18000, end_frame: 18300 },
        session: { session_id: seeded.invertSessionId },
        params: { conf: 0.15 },
        reduction: { name: 'v3_dirpad', version: 1 },
        ...overrides,
    };
}

/**
 * Submit one job and lease it, the way a worker would.
 *
 * @async
 * @param {Object} [spec] - The spec to submit.
 * @returns {Promise<Object>} `{job, lease}`.
 */
async function submitAndLease(spec = specFor()) {
    const submitted = await global.api
        .post('/api/v2/gpu/jobs')
        .send({
            kind: 'inference',
            spec,
            priority: TEST_PRIORITY + createdJobIds.length,
        });

    expect(submitted.status).toBe(200);

    for (const job of submitted.body.jobs) {
        createdJobIds.push(job.id);
    }

    const leased = await global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

    expect(leased.status).toBe(200);

    return { job: submitted.body.jobs[0], lease: leased.body };
}

/**
 * Hand a result file over the way a worker does: check by hash, then upload.
 *
 * @async
 * @param {string} text - The file's contents. May be empty.
 * @param {number} attemptId - Attempt the bytes belong to.
 * @returns {Promise<string>} The sha256 the artifact is addressed by.
 */
async function handOver(text, attemptId) {
    const bytes = Buffer.from(text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

    stagedHashes.push(sha256);

    const uploaded = await global.api
        .post(`/api/v2/gpu/artifacts/upload/${sha256}?attempt_id=${attemptId}`)
        .set('Content-Type', 'application/octet-stream')
        .send(bytes);

    expect(uploaded.status).toBe(200);

    return sha256;
}

/**
 * Report a successful result naming one observations artifact.
 *
 * @async
 * @param {Object} lease - The leased job, as the poll returned it.
 * @param {Array<Object>} rows - Observation rows to write into the file.
 * @returns {Promise<Object>} The Supertest response.
 */
async function reportObservations(lease, rows) {
    const text = rows.map((row) => JSON.stringify(row)).join('\n');
    const sha256 = await handOver(rows.length === 0 ? '' : `${text}\n`, lease.attempt_id);

    return global.api
        .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
        .send({
            worker_id: workerId,
            lease_epoch: lease.lease_epoch,
            outcome: 'succeeded',
            artifacts: [{ sha256, role: 'observations' }],
        });
}

/**
 * Submit, lease and report in one step.
 *
 * @async
 * @param {Array<Object>} rows - Observation rows the worker reports.
 * @param {Object} [spec] - The spec to submit.
 * @returns {Promise<Object>} `{job, lease, reported}`.
 */
async function runJob(rows, spec = specFor()) {
    const { job, lease } = await submitAndLease(spec);
    const reported = await reportObservations(lease, rows);

    return { job, lease, reported };
}

/**
 * Every observation a job produced, with its keyframe count.
 *
 * @async
 * @param {number} jobId - The job.
 * @returns {Promise<Array<Object>>} Observation rows, id ascending.
 */
function observationsForJob(jobId) {
    return query(
        `SELECT o.*, (SELECT COUNT(*)::int FROM keyframes k WHERE k.observation_id = o.observation_id) AS keyframe_count
           FROM observations o
          WHERE o.gpu_job_id = :jobId
          ORDER BY o.observation_id`,
        { jobId }
    );
}

beforeAll(async () => {
    // A poll takes the best-priority queued job in the whole database, so
    // anything left queued elsewhere would be leased here and every assertion
    // about which job came back would be about the wrong row. Failing rather
    // than skipping: a suite that quietly stops checking looks like a passing one.
    const [foreign] = await query(
        'SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = \'queued\''
    );

    if (foreign.n > 0) {
        throw new Error(
            `${foreign.n} GPU job(s) are already queued in this database. This suite leases whatever is `
            + 'queued, so it cannot run alongside them. Cancel or finish them first.'
        );
    }

    const cucumber = await speciesRow('California sea cucumber', 'Inverts');
    const anemone = await speciesRow('White-plumed anemone', 'Inverts');
    const urchinInverts = await speciesRow('Red sea urchin', 'Inverts');
    const urchinGulf = await speciesRow('Red sea urchin', 'GULF_Inverts');

    seeded.speciesIds = {
        cucumber,
        anemone,
        urchinInverts,
        urchinGulf,
    };

    const [project] = await db.sequelize.query(
        `INSERT INTO projects (name, "createdAt", "updatedAt")
         VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { replacements: { name: `jest-ingest-project-${runId}` }, type: QueryTypes.INSERT }
    );

    seeded.projectId = project[0].project_id;

    const makeSession = async (dive, line, type) => {
        const [rows] = await db.sequelize.query(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, NULL, :dive, :line, :lineId, :type, NOW(), NOW())
             RETURNING session_id`,
            {
                replacements: {
                    projectId: seeded.projectId,
                    dive,
                    line,
                    lineId: `${dive}_${line}`,
                    type,
                },
                type: QueryTypes.INSERT,
            }
        );

        return rows[0].session_id;
    };

    seeded.invertSessionId = await makeSession('Dive 8', '1000', 'Invert');
    seeded.fishSessionId = await makeSession('Dive 8', '1001', 'Fish');

    const [model] = await db.sequelize.query(
        `INSERT INTO ml_models (name, model_type, architecture_version, status, notes, created_at, updated_at)
         VALUES (:name, 'YOLOv8', 'mixed', 'trained', 'Seeded by tests/gpu-observation-ingest.test.js', NOW(), NOW())
         RETURNING id`,
        { replacements: { name: `jest-ingest-model-${runId}` }, type: QueryTypes.INSERT }
    );

    seeded.modelId = model[0].id;

    // The model's trained-species list. Three species, all on the Inverts list --
    // which is what makes the session-type check meaningful, and what settles
    // "Red sea urchin", a name two species rows carry.
    for (const species of [cucumber, anemone, urchinInverts]) {
        await db.sequelize.query(
            `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
             VALUES (:modelId, :speciesId, NOW(), NOW())`,
            { replacements: { modelId: seeded.modelId, speciesId: species.id } }
        );
    }

    // Sanity: the ambiguity this suite relies on has to actually exist, or the
    // test that proves the model settles it would pass without settling anything.
    expect(urchinGulf.id).not.toBe(urchinInverts.id);

    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-ingest-local-${runId}`,
            name: `jest-ingest-worker-${runId}`,
            slot_count: 32,
            worker_version: '0.0.1-jest',
        });

    expect(enrolled.status).toBe(200);
    workerId = enrolled.body.worker_id;
});

afterAll(async () => {
    if (createdJobIds.length > 0) {
        // Keyframes first, then observations: the observation is what carries the
        // job reference, and its keyframes are what carry the observation.
        await db.sequelize.query(
            `DELETE FROM keyframes WHERE observation_id IN
                 (SELECT observation_id FROM observations WHERE gpu_job_id IN (:jobIds))`,
            { replacements: { jobIds: createdJobIds } }
        );
        await db.sequelize.query('DELETE FROM observations WHERE gpu_job_id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
        await db.sequelize.query('DELETE FROM artifacts WHERE job_id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:jobIds)', {
            replacements: { jobIds: createdJobIds },
        });
    }

    if (workerId) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :workerId', {
            replacements: { workerId },
        });
    }

    for (const sha256 of stagedHashes) {
        await db.sequelize.query('DELETE FROM gpu_artifacts_staging WHERE sha256 = :sha256', {
            replacements: { sha256 },
        });

        const file = path.join(ARTIFACT_DIRECTORY, sha256);

        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }

    if (seeded.modelId) {
        await db.sequelize.query('DELETE FROM model_species WHERE model_id = :modelId', {
            replacements: { modelId: seeded.modelId },
        });
        await db.sequelize.query('DELETE FROM ml_models WHERE id = :modelId', {
            replacements: { modelId: seeded.modelId },
        });
    }

    if (seeded.projectId) {
        await db.sequelize.query('DELETE FROM sessions WHERE project_id = :projectId', {
            replacements: { projectId: seeded.projectId },
        });
        await db.sequelize.query('DELETE FROM projects WHERE project_id = :projectId', {
            replacements: { projectId: seeded.projectId },
        });
    }
});

/**
 * R1, R7, R9, R10, R11, R15 -- the whole of one real run, end to end.
 */
describe('Ingesting a real result file', () => {
    it('writes one observation per finished track, with its keyframes, without being asked', async () => {
        const { job, reported } = await runJob(REAL_RESULT);

        expect(reported.status).toBe(200);
        expect(reported.body.published).toBe(true);

        // R13: the ingest is part of what reporting a result does.
        expect(reported.body.ingest).toMatchObject({
            ingested: true,
            observations: REAL_RESULT.length,
            keyframes: 78,
            session_id: seeded.invertSessionId,
            ml_model_id: seeded.modelId,
        });

        const rows = await observationsForJob(job.id);

        expect(rows).toHaveLength(REAL_RESULT.length);

        // R3: the name became a species. The worker sent neither of these.
        for (const row of rows) {
            expect(row.species_id).toBe(seeded.speciesIds.cucumber.id);
            expect(row.taxserial).toBe(seeded.speciesIds.cucumber.taxserial);
            expect(row.comname).toBe('California sea cucumber');
        }

        // R15 and R6: provenance on every row.
        for (const row of rows) {
            expect(row.ml_model_id).toBe(seeded.modelId);
            expect(row.gpu_job_id).toBe(job.id);
            expect(row.jellyfin_item_id).toBe('4ac4749aae0a8d75ac99f2d8d50717ce');
            expect(row.video_source).toBe('20240730_171520_Fwd.mp4');
            expect(row.session_id).toBe(seeded.invertSessionId);
            expect(row.project_id).toBe(seeded.projectId);

            // A23: null on purpose, not by omission. In the legacy pipeline this
            // was the operator's own local path, which a distributed worker does
            // not have.
            expect(row.videoLocation).toBeNull();
        }

        // R9: the score at the observation frame, as sent, null included.
        expect(rows.map((row) => row.confidence)).toEqual(
            REAL_RESULT.map((row) => row.confidence)
        );

        // R1: every keyframe, and the count per observation.
        expect(rows.map((row) => row.keyframe_count)).toEqual(
            REAL_RESULT.map((row) => row.keyframes.length)
        );

        // R11: three separate series, each consecutive from its own maximum.
        const ids = rows.map((row) => row.observation_id);
        const obsIds = rows.map((row) => row.obsID);

        expect(ids).toEqual(ids.map((_, index) => ids[0] + index));
        expect(obsIds).toEqual(obsIds.map((_, index) => obsIds[0] + index));
        expect(rows.every((row) => row.PobsID !== null)).toBe(true);
    });

    it('passes keyframe geometry through untouched, including a box wider than the frame', async () => {
        const { job } = await runJob(REAL_RESULT);

        const [first] = await observationsForJob(job.id);

        const stored = await query(
            'SELECT * FROM keyframes WHERE observation_id = :id ORDER BY framenum, keyframe_id',
            { id: first.observation_id }
        );

        const sent = [...REAL_RESULT[0].keyframes]
            .sort((a, b) => a.framenum - b.framenum);

        expect(stored).toHaveLength(sent.length);

        for (let index = 0; index < sent.length; index += 1) {
            expect(stored[index].framenum).toBe(sent[index].framenum);
            expect(stored[index].x).toBeCloseTo(sent[index].x, 12);
            expect(stored[index].y).toBeCloseTo(sent[index].y, 12);
            expect(stored[index].width).toBeCloseTo(sent[index].width, 12);
            expect(stored[index].height).toBeCloseTo(sent[index].height, 12);
            expect(stored[index].comname).toBe('California sea cucumber');
            expect(stored[index].subset).toBe('1');
        }

        // start / middle... / end, as the reduction labelled them.
        expect(stored[0].type).toBe('start');
        expect(stored[stored.length - 1].type).toBe('end');
    });
});

/**
 * R7 and R8 -- the timecode columns, which are derived rather than copied.
 */
describe('The timecode columns', () => {
    it('writes derived columns a resync can reproduce, which the worker\'s own strings would not be', async () => {
        const { job } = await runJob(REAL_RESULT);

        const rows = await observationsForJob(job.id);

        for (let index = 0; index < rows.length; index += 1) {
            const verdict = classifyRow(rows[index]);

            // The whole point: `db/timecode.js` recognises these as its own
            // arithmetic, so a timecode resync will not skip machine-written rows
            // as "something else wrote this".
            expect(verdict.readable).toBe(true);
            expect(verdict.tcDerivable).toBe(true);
            expect(verdict.frameDerivable).toBe(true);

            // And the stored position really is the observation's frame, which is
            // what the worker's own string is a millisecond short of in half these
            // rows.
            expect(absoluteFrame(parseTimeSpan(rows[index].actualPosition)))
                .toBe(REAL_RESULT[index].observation_frame);

            // Seven fractional digits, the shape the annotation GUI writes.
            expect(rows[index].actualPosition).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{7}$/);
            expect(rows[index].mediaPosition).toBe(rows[index].actualPosition);
        }
    });

    it('refuses a result whose own timecode disagrees with 25 fps, rather than storing either', async () => {
        const row = { ...REAL_RESULT[0], tc: '01:02:03' };
        const { job, reported } = await runJob([row]);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/25 fps/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });

    it('refuses a result whose sub-second frame index disagrees with its absolute frame', async () => {
        const row = { ...REAL_RESULT[0], frame: '7' };
        const { job, reported } = await runJob([row]);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/sub-second index/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });
});

/**
 * R2 -- a job that found nothing.
 */
describe('A job that detected nothing', () => {
    it('ingests zero observations from an empty result file without erroring', async () => {
        const { job, reported } = await runJob([]);

        expect(reported.status).toBe(200);
        expect(reported.body.job_state).toBe('succeeded');
        expect(reported.body.ingest).toMatchObject({ ingested: true, observations: 0, keyframes: 0 });

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });
});

/**
 * R3 -- the class name becomes a species, or nothing happens at all.
 */
describe('Resolving a class name to a species', () => {
    it('lets the model\'s trained-species list settle a name two species rows carry', async () => {
        const row = {
            ...REAL_RESULT[0],
            comname: 'Red sea urchin',
            keyframes: REAL_RESULT[0].keyframes.map((keyframe) => ({ ...keyframe, comname: 'Red sea urchin' })),
        };

        const { job } = await runJob([row]);
        const [stored] = await observationsForJob(job.id);

        expect(stored.species_id).toBe(seeded.speciesIds.urchinInverts.id);
        expect(stored.taxserial).toBe(seeded.speciesIds.urchinInverts.taxserial);
        expect(stored.species_id).not.toBe(seeded.speciesIds.urchinGulf.id);
    });

    it('fails the whole ingest on a name MARP does not know, rather than skipping the observation', async () => {
        const row = { ...REAL_RESULT[0], comname: `jest-not-a-species-${runId}` };
        const { job, reported } = await runJob([row, REAL_RESULT[1]]);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/is not a species MARP knows/);

        // Nothing, not "everything except the bad line".
        expect(await observationsForJob(job.id)).toHaveLength(0);
    });

    it('records the failure as a coordinator note, so it is visible rather than only logged', async () => {
        const row = { ...REAL_RESULT[0], comname: `jest-not-a-species-${runId}` };
        const { lease } = await runJob([row]);

        const notes = await query(
            'SELECT payload FROM gpu_job_events WHERE attempt_id = :attemptId AND kind = \'note\'',
            { attemptId: lease.attempt_id }
        );

        expect(notes.some((note) => note.payload.note === 'observation ingest failed')).toBe(true);
    });
});

/**
 * R5 -- the session's type is checked against the model, not trusted.
 */
describe('Checking the session against the model', () => {
    it('refuses an inverts model\'s output written into a Fish session', async () => {
        const spec = specFor({ session: { session_id: seeded.fishSessionId } });
        const { job, reported } = await runJob(REAL_RESULT, spec);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/belongs in an inverts session/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });

    it('refuses a session that does not exist', async () => {
        const spec = specFor({ session: { session_id: 2147483000 } });
        const { job, reported } = await runJob(REAL_RESULT, spec);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/does not exist/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });
});

/**
 * R4 -- a job that carries enough to create its session.
 */
describe('A job that describes its session rather than naming one', () => {
    it('creates the session from project, dive, line and type', async () => {
        const spec = specFor({
            session: {
                project_id: seeded.projectId,
                dive: `jest-dive-${runId}`,
                line: '2000',
                type: 'Invert',
            },
        });

        const { job, reported } = await runJob([REAL_RESULT[0]], spec);

        expect(reported.body.ingest).toMatchObject({ ingested: true, session_created: true });

        const [session] = await query(
            'SELECT * FROM sessions WHERE project_id = :projectId AND dive = :dive AND line = :line',
            { projectId: seeded.projectId, dive: `jest-dive-${runId}`, line: '2000' }
        );

        expect(session.type).toBe('Invert');
        expect(session.lineId).toBe(`jest-dive-${runId}_2000`);

        const [stored] = await observationsForJob(job.id);

        expect(stored.session_id).toBe(session.session_id);
    });

    it('reuses that session on a second job rather than creating another', async () => {
        const spec = specFor({
            session: {
                project_id: seeded.projectId,
                dive: `jest-dive-${runId}`,
                line: '2000',
                type: 'Invert',
            },
        });

        const { reported } = await runJob([REAL_RESULT[1]], spec);

        expect(reported.body.ingest).toMatchObject({ ingested: true, session_created: false });

        const sessions = await query(
            'SELECT session_id FROM sessions WHERE project_id = :projectId AND dive = :dive AND line = :line',
            { projectId: seeded.projectId, dive: `jest-dive-${runId}`, line: '2000' }
        );

        expect(sessions).toHaveLength(1);
    });
});

/**
 * R12 -- ingest is idempotent per job, and a re-run is a different job.
 */
describe('Ingesting the same job twice', () => {
    it('writes one set of observations, however many times it is asked', async () => {
        const { job } = await runJob(REAL_RESULT);

        const again = await global.api.post(`/api/v2/gpu/jobs/${job.id}/ingest`).send({});

        expect(again.status).toBe(200);
        expect(again.body.ingested).toBe(false);
        expect(again.body.already_ingested).toBe(REAL_RESULT.length);

        expect(await observationsForJob(job.id)).toHaveLength(REAL_RESULT.length);
    });

    it('gives a re-run its own set, because comparing two runs depends on both surviving', async () => {
        const first = await runJob(REAL_RESULT);
        const second = await runJob(REAL_RESULT);

        expect(second.job.id).not.toBe(first.job.id);

        expect(await observationsForJob(first.job.id)).toHaveLength(REAL_RESULT.length);
        expect(await observationsForJob(second.job.id)).toHaveLength(REAL_RESULT.length);
    });
});

/**
 * R11 -- two ingests at once.
 */
describe('Two jobs ingesting at the same time', () => {
    /**
     * Two jobs whose results published without being ingested, so the write path
     * itself can be raced. A spec carrying no session means auto-ingest is
     * skipped, which leaves the artifact held and no observations written.
     *
     * @async
     * @returns {Promise<Array<number>>} The two job ids.
     */
    async function twoUningestedJobs() {
        const ids = [];

        for (const range of [
            { start_frame: 19000, end_frame: 19300 },
            { start_frame: 19300, end_frame: 19600 },
        ]) {
            const spec = specFor({ range });

            delete spec.session;

            const { job, lease } = await submitAndLease(spec);

            await reportObservations(lease, REAL_RESULT);

            expect(await observationsForJob(job.id)).toHaveLength(0);

            ids.push(job.id);
        }

        return ids;
    }

    it('gives every observation its own key when two writes overlap', async () => {
        const [jobA, jobB] = await twoUningestedJobs();

        // At the repository tier, because key assignment under concurrency is a
        // repository property -- the same reason tests/gpu-lease-race.test.js
        // races claimNextJob there rather than through two HTTP requests.
        const speciesByName = new Map();
        const model = await ingestRepository.getModel(seeded.modelId);
        const session = await ingestRepository.getSession(seeded.invertSessionId);

        const build = async (jobId) => {
            const built = [];

            for (let index = 0; index < REAL_RESULT.length; index += 1) {
                built.push(await ingestService.buildObservation(REAL_RESULT[index], index, {
                    job: { id: jobId, created_by: null },
                    model,
                    sessionRow: session,
                    speciesByName,
                }));
            }

            return {
                jobId,
                sessionId: session.session_id,
                projectId: session.project_id,
                sessionType: session.type,
                observations: built,
            };
        };

        const [writeA, writeB] = [await build(jobA), await build(jobB)];

        const [resultA, resultB] = await Promise.all([
            ingestRepository.writeJobObservations(writeA),
            ingestRepository.writeJobObservations(writeB),
        ]);

        expect(resultA.observations).toBe(REAL_RESULT.length);
        expect(resultB.observations).toBe(REAL_RESULT.length);

        const ids = [...resultA.observation_ids, ...resultB.observation_ids];

        // Disjoint keys, which is the thing the advisory lock buys.
        expect(new Set(ids).size).toBe(ids.length);

        const rowsA = await observationsForJob(jobA);
        const rowsB = await observationsForJob(jobB);

        expect(rowsA).toHaveLength(REAL_RESULT.length);
        expect(rowsB).toHaveLength(REAL_RESULT.length);
    });

    it('negative control: without the lock, two overlapping transactions do compute the same key', async () => {
        // The control exists so the test above cannot quietly stop testing
        // anything. `max + 1` is not safe on its own, and this is what that looks
        // like: two transactions reading the maximum with no lock between them
        // agree on the next key, which is a primary-key violation waiting for the
        // second insert.
        const readNextKey = async (transaction) => {
            const [row] = await db.sequelize.query(
                'SELECT COALESCE(MAX(observation_id), 0)::int + 1 AS next FROM observations',
                { type: QueryTypes.SELECT, transaction }
            );

            return row.next;
        };

        const first = await db.sequelize.transaction();
        const second = await db.sequelize.transaction();

        try {
            const [a, b] = await Promise.all([readNextKey(first), readNextKey(second)]);

            expect(a).toBe(b);
        } finally {
            await first.rollback();
            await second.rollback();
        }
    });
});

/**
 * R9 -- the confidence contract.
 */
describe('The confidence contract', () => {
    it('refuses a result row with no confidence key at all', async () => {
        const { confidence, ...withoutConfidence } = REAL_RESULT[0];
        const { job, reported } = await runJob([withoutConfidence]);

        expect(confidence).not.toBeUndefined();
        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/carries no confidence key/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });

    it('refuses a score outside zero to one rather than clamping it', async () => {
        const { job, reported } = await runJob([{ ...REAL_RESULT[0], confidence: 1.4 }]);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/between zero and one/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });
});

/**
 * R1 -- what is not a reduced observation is refused rather than half-read.
 */
describe('A result file in the wrong shape', () => {
    it('refuses a per-frame detection dump, which shares the observations role', async () => {
        const { job, lease } = await submitAndLease();

        const text = `${JSON.stringify({ frame: 0, detections: [] })}\n`
            + `${JSON.stringify({ frame: 1, detections: [] })}\n`;
        const sha256 = await handOver(text, lease.attempt_id);

        const reported = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'succeeded',
                artifacts: [{ sha256, role: 'observations' }],
            });

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toMatch(/not a reduced observation/);

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });
});

/**
 * R4 and R6 -- what a submission has to say before its result can be ingested.
 */
describe('Submitting a job that says where its observations go', () => {
    it('refuses a session naming both an id and a dive', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                priority: TEST_PRIORITY,
                spec: specFor({
                    session: {
                        session_id: seeded.invertSessionId,
                        project_id: seeded.projectId,
                        dive: 'Dive 8',
                        line: '1000',
                        type: 'Invert',
                    },
                }),
            });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/not both/);
    });

    it('refuses a session described without all four of project, dive, line and type', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                priority: TEST_PRIORITY,
                spec: specFor({ session: { project_id: seeded.projectId, dive: 'Dive 8' } }),
            });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/Missing: line, type/);
    });

    it('refuses a session without a model, because every ingested row records one', async () => {
        const spec = specFor();

        delete spec.model.ml_model_id;

        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({ kind: 'inference', priority: TEST_PRIORITY, spec });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/ml_model_id is required/);
    });

    it('refuses a session on a diagnostic job, which produces no observations', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({ kind: 'diagnostic', priority: TEST_PRIORITY, spec: specFor() });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/produces none/);
    });

    it('still accepts a job with no session at all, and ingests nothing for it', async () => {
        const spec = specFor();

        delete spec.session;

        const { job, reported } = await runJob(REAL_RESULT, spec);

        expect(reported.status).toBe(200);
        expect(reported.body.ingest).toMatchObject({ skipped: 'the job spec names no session' });

        expect(await observationsForJob(job.id)).toHaveLength(0);
    });

    it('refuses an on-request ingest of a job that names no session, saying what is missing', async () => {
        const spec = specFor();

        delete spec.session;

        const { job } = await runJob(REAL_RESULT, spec);

        const response = await global.api.post(`/api/v2/gpu/jobs/${job.id}/ingest`).send({});

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/names no session/);
    });
});
