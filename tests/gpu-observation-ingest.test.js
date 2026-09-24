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
const logger = require('../logger/api.logger');
const jellyfinRepository = require('../repository/jellyfin.repository');
const gpuRepository = require('../repository/gpu.repository');
const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');
const {
    classifyRow, parseTimeSpan, absoluteFrame, deriveTc, deriveFrame,
} = require('../db/timecode');

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
    habitatSessionId: undefined,
    mutableSessionId: undefined,
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

    // **Check first, upload only if asked -- which is what a worker does** (#225).
    // This used to upload unconditionally, and that is the whole defect in
    // miniature. Artifacts are content-addressed, so an artifact this suite
    // hands over is the *same* artifact as every other producer of those bytes:
    // most sharply the empty results file `runJob([])` sends, which every real
    // job that detected nothing produces byte for byte.
    //
    // Uploading it again upserts a staging row the suite did not create, and
    // deleting it afterwards destroyed the corpus's only copy -- 196 attempts
    // had ingested that artifact, and all 179 after it failed with "recorded but
    // its bytes are not on disk".
    //
    // So: ask, and clean up only what this answer says did not exist. The two
    // halves are tracked separately because the risk is not symmetric -- a
    // staging row this run created is always safe to drop, and a *file* it did
    // not create is never safe to.
    const offered = await global.api.post('/api/v2/gpu/artifacts/check').send({ sha256 });

    expect(offered.status).toBe(200);

    const held = offered.body.already_have === true;

    stagedHashes.push({
        sha256,
        row: !held,
        file: !fs.existsSync(path.join(ARTIFACT_DIRECTORY, sha256)),
    });

    if (!held) {
        const uploaded = await global.api
            .post(`/api/v2/gpu/artifacts/upload/${sha256}?attempt_id=${attemptId}`)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes);

        expect(uploaded.status).toBe(200);
    }

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

    // A type MARP allows and the inference engine has no counting rule for. Real,
    // not a typo: `Habitat`, `MarineDebris` and `Substrate60Second` are all in
    // this database and none of them is a branch in `pick_observation_time`.
    seeded.habitatSessionId = await makeSession('Dive 8', '1002', 'Habitat');

    // Its own session, so the test that edits a type after submission cannot
    // disturb anything else.
    seeded.mutableSessionId = await makeSession('Dive 8', '1003', 'Invert');

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

    // Each half only if this run is what brought it into being -- see handOver.
    for (const { sha256, row, file } of stagedHashes) {
        if (row) {
            await db.sequelize.query('DELETE FROM gpu_artifacts_staging WHERE sha256 = :sha256', {
                replacements: { sha256 },
            });
        }

        const stored = path.join(ARTIFACT_DIRECTORY, sha256);

        if (file && fs.existsSync(stored)) {
            fs.unlinkSync(stored);
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
    /**
     * #62. The ingest assigned `max + 1` and never advanced the sequence, so every GPU
     * run pushed the table past it and the next create through the API collided.
     */
    it('takes observation ids from the sequence, so the sequence is never behind them', async () => {
        const { job, reported } = await runJob(REAL_RESULT);

        expect(reported.body.ingest.ingested).toBe(true);

        const ids = (await observationsForJob(job.id)).map((row) => Number(row.observation_id));
        const [sequence] = await query('SELECT last_value FROM observations_observation_id_seq');

        expect(ids).toHaveLength(REAL_RESULT.length);
        expect(Number(sequence.last_value)).toBeGreaterThanOrEqual(Math.max(...ids));
    });

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

    it('persists numeric and null keyframe confidence from a worker result', async () => {
        // The historical artifact predates per-keyframe confidence, so attach
        // distinct contract sentinels without pretending they are recovered scores.
        const keyframes = REAL_RESULT[0].keyframes.map((keyframe, index) => ({
            ...keyframe,
            confidence: index === 1 ? null : (index + 1) / 100,
        }));
        const result = { ...REAL_RESULT[0], keyframes };
        const { job, reported } = await runJob([result]);

        expect(reported.status).toBe(200);
        expect(reported.body.ingest).toMatchObject({
            ingested: true,
            observations: 1,
            keyframes: keyframes.length,
        });

        const [observation] = await observationsForJob(job.id);
        const stored = await query(
            `SELECT framenum, confidence
               FROM keyframes
              WHERE observation_id = :id
              ORDER BY framenum, keyframe_id`,
            { id: observation.observation_id }
        );
        const sent = [...keyframes].sort((a, b) => a.framenum - b.framenum);

        expect(stored).toHaveLength(sent.length);
        expect(stored.map((keyframe) => keyframe.framenum)).toEqual(
            sent.map((keyframe) => keyframe.framenum)
        );
        expect(stored.map((keyframe) => keyframe.confidence)).toEqual(
            sent.map((keyframe) => keyframe.confidence)
        );
        expect(stored.some((keyframe) => keyframe.confidence === null)).toBe(true);
    });
});

/**
 * #118's A3, as the human reversed it on 2026-09-10: *"one of our key criteria is
 * that the user never has to wait. So trying to load the page should not be the
 * thing that makes the back end work. When the observation is created, it should
 * get enqueued."*
 *
 * At this tier because this is the tier that can see it. The enqueue happens
 * inside the ingest's own write transaction, and a repository-level test could
 * assert `enqueueMissing` was called while nothing at all was written by a worker
 * reporting a real result -- the class of defect this suite's header names.
 */
describe('Enqueueing a thumbnail when the observation is created', () => {
    it('queues one thumbnail per observation, without anybody asking for a page', async () => {
        const { job } = await runJob(REAL_RESULT);

        const rows = await observationsForJob(job.id);

        expect(rows).toHaveLength(REAL_RESULT.length);

        const thumbnails = await query(
            `SELECT observation_id, status, permanent, attempts, requested_at, filename
               FROM observation_thumbnails
              WHERE observation_id IN (:ids)
              ORDER BY observation_id`,
            { ids: rows.map((row) => row.observation_id) }
        );

        // One per observation. No page of this session has been requested, which
        // is the whole point: creation is what enqueued them.
        expect(thumbnails.map((t) => t.observation_id))
            .toEqual(rows.map((row) => row.observation_id));

        for (const thumbnail of thumbnails) {
            expect(thumbnail.status).toBe('queued');
            expect(thumbnail.permanent).toBe(false);
            expect(thumbnail.attempts).toBe(0);
            expect(thumbnail.requested_at).not.toBeNull();

            // Queued means nothing has been extracted yet. A filename here would
            // be a picture invented rather than made.
            expect(thumbnail.filename).toBeNull();
        }
    });

    it('enqueues nothing extra when the same job is ingested again', async () => {
        // The ingest is idempotent and the enqueue has to be too, or a replay
        // resets a `ready` row to `queued` and re-extracts a picture that exists.
        const { job } = await runJob(REAL_RESULT);

        const ids = (await observationsForJob(job.id)).map((row) => row.observation_id);

        // `filename` is unique, so each row needs its own -- and the value is
        // what the second assertion below reads back to prove nothing rewrote it.
        await db.sequelize.query(
            `UPDATE observation_thumbnails
                SET status = 'ready',
                    filename = 'already-made-' || observation_id || '.jpg',
                    updated_at = NOW()
              WHERE observation_id IN (:ids)`,
            { replacements: { ids } }
        );

        const again = await global.api.post(`/api/v2/gpu/jobs/${job.id}/ingest`).send({});

        expect(again.status).toBe(200);
        expect(again.body.ingested).toBe(false);

        const after = await query(
            `SELECT observation_id, status, filename FROM observation_thumbnails
              WHERE observation_id IN (:ids)
              ORDER BY observation_id`,
            { ids }
        );

        expect(after).toHaveLength(ids.length);
        expect(after.every((t) => t.status === 'ready')).toBe(true);
        expect(after.map((t) => t.filename))
            .toEqual(ids.map((id) => `already-made-${id}.jpg`));
    });

    it('writes no thumbnail when the ingest refuses the whole result', async () => {
        // Same transaction, so a refusal takes the queue entries with the
        // observations rather than leaving rows pointing at nothing.
        const [before] = await query('SELECT COUNT(*)::int AS n FROM observation_thumbnails');

        const unknown = { ...REAL_RESULT[0], comname: `jest-not-a-species-${runId}` };
        const { job, reported } = await runJob([unknown, REAL_RESULT[1]]);

        expect(reported.body.ingest.ingested).toBe(false);
        expect(await observationsForJob(job.id)).toHaveLength(0);

        const [after] = await query('SELECT COUNT(*)::int AS n FROM observation_thumbnails');

        expect(after.n).toBe(before.n);
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

    it('refuses to lease a job naming a session that does not exist, before a GPU spends time on it', async () => {
        // Caught at lease rather than at ingest, because the leased spec has to
        // carry the survey convention and there is no session to take it from.
        // Better here: the alternative is a worker running for hours and the
        // result having nowhere to go.
        const submitted = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                priority: TEST_PRIORITY + createdJobIds.length,
                spec: specFor({ session: { session_id: 2147483000 } }),
            });

        expect(submitted.status).toBe(200);
        createdJobIds.push(submitted.body.jobs[0].id);

        const leased = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

        expect(leased.status).toBe(204);

        const [attempt] = await query(
            'SELECT state, failure_reason FROM gpu_job_attempts WHERE job_id = :id ORDER BY lease_epoch DESC LIMIT 1',
            { id: submitted.body.jobs[0].id }
        );

        expect(attempt.state).toBe('failed');
        expect(attempt.failure_reason).toMatch(/does not exist/);
    });

    it('refuses to ingest when the session was deleted after the job ran', async () => {
        // The ingest-tier refusal is still reachable, and this is how: a session
        // can be deleted between a job finishing and somebody asking for its
        // result again. An empty result so that no observation ends up
        // referencing the session being removed.
        const [rows] = await db.sequelize.query(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, NULL, :dive, '4000', :lineId, 'Invert', NOW(), NOW())
             RETURNING session_id`,
            {
                replacements: {
                    projectId: seeded.projectId,
                    dive: `jest-doomed-${runId}`,
                    lineId: `jest-doomed-${runId}_4000`,
                },
                type: QueryTypes.INSERT,
            }
        );

        const doomedId = rows[0].session_id;
        const { job, reported } = await runJob([], specFor({ session: { session_id: doomedId } }));

        expect(reported.body.ingest).toMatchObject({ ingested: true, observations: 0 });

        await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', {
            replacements: { id: doomedId },
        });

        const response = await global.api.post(`/api/v2/gpu/jobs/${job.id}/ingest`).send({});

        expect(response.status).toBe(409);
        expect(response.body.error.message).toMatch(/does not exist/);
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

/**
 * `params.data_type` -- which survey convention counts, resolved by the
 * coordinator because the worker cannot know it.
 */
describe('The survey convention a worker is handed', () => {
    /**
     * Submit and lease, returning what the worker would actually receive.
     *
     * At the HTTP tier deliberately: what a worker gets is the leased body, and a
     * check one layer down would pass while the body handed over carried no
     * `data_type` at all -- which is precisely the defect being fixed, since the
     * worker's own default for a missing one is `Fish`.
     *
     * @async
     * @param {Object} spec - The spec to submit.
     * @returns {Promise<Object>} The leased spec.
     */
    async function leasedSpec(spec) {
        const { lease } = await submitAndLease(spec);

        return lease.spec;
    }

    it('fills data_type from the type of the session named by id', async () => {
        const spec = await leasedSpec(specFor());

        expect(spec.params.data_type).toBe('Invert');

        // The rest of params survives, rather than being replaced wholesale.
        expect(spec.params.conf).toBe(0.15);
    });

    it('fills data_type from a session the job describes rather than names', async () => {
        const spec = await leasedSpec(specFor({
            session: {
                project_id: seeded.projectId,
                dive: `jest-convention-${runId}`,
                line: '3000',
                type: 'GULF_Inverts',
            },
        }));

        expect(spec.params.data_type).toBe('GULF_Inverts');
    });

    it('leaves a data_type the submitter set deliberately', async () => {
        const submitted = specFor();

        submitted.params = { ...submitted.params, data_type: 'GULF_Fish' };

        const spec = await leasedSpec(submitted);

        // The session is an Invert one, and the submitter still wins: they meant
        // it, the same way a bare video url is not second-guessed.
        expect(spec.params.data_type).toBe('GULF_Fish');
    });

    it('fills nothing for a job with no session, which produces no observations', async () => {
        const submitted = specFor();

        delete submitted.session;

        const spec = await leasedSpec(submitted);

        expect(spec.params.data_type).toBeUndefined();
    });

    it('refuses at submit a session whose type the engine has no counting rule for', async () => {
        const response = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                priority: TEST_PRIORITY,
                spec: specFor({ session: { session_id: seeded.habitatSessionId } }),
            });

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/Habitat/);
        expect(response.body.error.message).toMatch(/first frame of each track/);
    });

    it('accepts that session when the submitter names a convention themselves', async () => {
        const submitted = specFor({ session: { session_id: seeded.habitatSessionId } });

        submitted.params = { ...submitted.params, data_type: 'Invert' };

        const spec = await leasedSpec(submitted);

        expect(spec.params.data_type).toBe('Invert');
    });

    it('fails the attempt rather than guessing when the session type changed after submission', async () => {
        // The authoritative check is at lease time, not at submit, because this
        // is possible: a session's type can be edited while its job sits in the
        // queue, and the spec was validated against the old one.
        const { job } = await submitAndLease(
            specFor({ session: { session_id: seeded.mutableSessionId } })
        );

        // Give the job back so it can be leased again after the edit.
        await global.api.post(`/api/v2/gpu/jobs/${job.id}/cancel`).send({});

        const second = await global.api
            .post('/api/v2/gpu/jobs')
            .send({
                kind: 'inference',
                priority: TEST_PRIORITY + createdJobIds.length,
                spec: specFor({ session: { session_id: seeded.mutableSessionId } }),
            });

        expect(second.status).toBe(200);
        createdJobIds.push(second.body.jobs[0].id);

        await db.sequelize.query(
            `UPDATE sessions SET type = 'MarineDebris' WHERE session_id = :id`,
            { replacements: { id: seeded.mutableSessionId } }
        );

        try {
            const leased = await global.api
                .post('/api/v2/gpu/poll')
                .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

            // No lease handed out, and the attempt records why rather than the
            // worker being blamed for the coordinator's problem.
            expect(leased.status).toBe(204);

            const [attempt] = await query(
                'SELECT state, failure_reason FROM gpu_job_attempts WHERE job_id = :id ORDER BY lease_epoch DESC LIMIT 1',
                { id: second.body.jobs[0].id }
            );

            expect(attempt.state).toBe('failed');
            expect(attempt.failure_reason).toMatch(/could not be resolved/);
            expect(attempt.failure_reason).toMatch(/MarineDebris/);
            expect(attempt.failure_reason).toMatch(/no counting rule/);
        } finally {
            await db.sequelize.query(
                `UPDATE sessions SET type = 'Invert' WHERE session_id = :id`,
                { replacements: { id: seeded.mutableSessionId } }
            );
        }
    });
});

/**
 * A job finished by two machines, one after the other.
 *
 * The case the whole stop-and-resume feature exists for, and the one that was
 * broken: a volunteer stops a run, keeps the frames it did, and somebody else
 * finishes the rest. Both halves have to reach the record.
 */
describe('A job two attempts finished between them', () => {
    it('ingests the second attempt as well as the first', async () => {
        const first = REAL_RESULT.slice(0, 2);
        const second = REAL_RESULT.slice(2, 4);

        expect(first.length).toBeGreaterThan(0);
        expect(second.length).toBeGreaterThan(0);

        // One machine stops part way, keeping what it processed.
        const { job, lease } = await submitAndLease();
        const firstText = `${first.map((row) => JSON.stringify(row)).join('\n')}\n`;
        const firstHash = await handOver(firstText, lease.attempt_id);

        const yielded = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'yielded',
                completed_through_frame: 18150,
                artifacts: [{ sha256: firstHash, role: 'observations' }],
            });

        expect(yielded.status).toBe(200);
        console.log("YIELD INGEST:", JSON.stringify(yielded.body.ingest), "published:", yielded.body.published, "ingestable:", yielded.body.ingestable, "attempt:", yielded.body.attempt_id);
        expect(yielded.body.ingest).toMatchObject({ ingested: true, observations: first.length });

        // The job is back in the queue, so another machine takes it.
        const resumed = await global.api
            .post('/api/v2/gpu/poll')
            .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

        expect(resumed.status).toBe(200);
        expect(resumed.body.job_id).toBe(job.id);

        const secondText = `${second.map((row) => JSON.stringify(row)).join('\n')}\n`;
        const secondHash = await handOver(secondText, resumed.body.attempt_id);

        const finished = await global.api
            .post(`/api/v2/gpu/attempts/${resumed.body.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: resumed.body.lease_epoch,
                outcome: 'succeeded',
                artifacts: [{ sha256: secondHash, role: 'observations' }],
            });

        expect(finished.status).toBe(200);

        // **The assertion that was failing.** Two job-level guards survived the
        // move to a per-attempt one, so the second attempt was answered
        // `already_ingested` -- which reads like success -- and its
        // observations were silently dropped. The job is the unit of
        // scientific work; the attempt is the unit of ingest.
        expect(finished.body.ingest).toMatchObject({
            ingested: true,
            observations: second.length,
        });

        const stored = await observationsForJob(job.id);

        expect(stored).toHaveLength(first.length + second.length);
    }, 30000);
});

/**
 * A job is not finished until its data is in the database (#225).
 *
 * `publishResult` and the ingest are two steps, and only the first had ever
 * decided what an attempt was. So an attempt whose observations were refused
 * kept `succeeded` with `ingested_at` NULL -- a status that is true and a result
 * that does not exist. 470 attempts were in that state when this was written.
 *
 * Isaac, 2026-09-19: *"we 100% need to make sure that if a job is considered
 * finished the api has actually ingested it's data, otherwise the job isn't
 * finished. In the end there should be no reason why ingest would fail, that
 * just means that we didn't get the data that was supposed to run and that is
 * unacceptable."*
 */
describe('An attempt whose results were not ingested', () => {
    /**
     * The tripwire for the whole issue. A class name MARP cannot resolve is the
     * cheapest way to make the ingest refuse a result whose bytes are perfectly
     * good, which is exactly the shape that used to pass as a success.
     */
    it('is failed rather than succeeded, and its job goes back to the queue', async () => {
        const unknown = { ...REAL_RESULT[0], comname: 'Nothing In This Catalogue 225' };
        const { job, lease, reported } = await runJob([unknown]);

        expect(reported.status).toBe(200);
        expect(reported.body.ingest).toMatchObject({ ingested: false });
        expect(reported.body.ingest.failed).toEqual(expect.any(String));

        // The two assertions the issue is actually about.
        expect(reported.body.attempt_state).toBe('failed');
        expect(reported.body.job_state).toBe('queued');

        const [attempt] = await query(
            'SELECT state, ingested_at, failure_reason FROM gpu_job_attempts WHERE id = :id',
            { id: lease.attempt_id }
        );

        expect(attempt.state).toBe('failed');

        // Still NULL, and now that is consistent rather than contradictory: the
        // attempt no longer claims to have finished.
        expect(attempt.ingested_at).toBeNull();
        expect(attempt.failure_reason).toEqual(expect.any(String));

        const [row] = await query('SELECT state FROM gpu_jobs WHERE id = :id', { id: job.id });

        expect(row.state).toBe('queued');
        expect(await observationsForJob(job.id)).toHaveLength(0);
    });

    /**
     * The half that must NOT change. A job that detected nothing has a genuine
     * empty result, ingests zero observations, and is finished -- if this failed
     * and retried, every empty result in the pool would burn three attempts.
     */
    it('leaves a job that legitimately detected nothing succeeded', async () => {
        const { reported } = await runJob([]);

        expect(reported.body.job_state).toBe('succeeded');
        expect(reported.body.ingest).toMatchObject({ ingested: true, observations: 0 });
        expect(reported.body.attempt_state).toBeUndefined();
    });
});

/**
 * The artifact a job shares with every other job that found nothing (#225).
 *
 * Artifacts are content-addressed, so the empty results file is one file for the
 * whole platform. Two things follow, and both were defects: a test that deletes
 * it destroys the corpus's copy, and a staging row that outlives it makes every
 * later hand-over a no-op -- the worker is told `already_have`, sends nothing,
 * and the ingest then looks for bytes nobody wrote. 179 attempts died that way.
 */
describe('An artifact recorded without its bytes', () => {
    it('is asked for again rather than reported as already held', async () => {
        const bytes = Buffer.from('225 check-artifact bytes\n', 'utf8');
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        const file = path.join(ARTIFACT_DIRECTORY, sha256);

        expect(fs.existsSync(file)).toBe(false);
        stagedHashes.push({ sha256, row: true, file: true });

        const { lease } = await submitAndLease();

        await global.api
            .post(`/api/v2/gpu/artifacts/upload/${sha256}?attempt_id=${lease.attempt_id}`)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes);

        const held = await global.api.post('/api/v2/gpu/artifacts/check').send({ sha256 });

        expect(held.body.already_have).toBe(true);

        // The file goes, the row stays -- which is the state 179 attempts met.
        fs.unlinkSync(file);

        const orphaned = await global.api.post('/api/v2/gpu/artifacts/check').send({ sha256 });

        expect(orphaned.body.already_have).toBe(false);
        expect(orphaned.body.upload_url).toEqual(expect.any(String));
    });

    /**
     * And a result naming it is refused while the worker still holds the file,
     * rather than published and then withdrawn.
     */
    it('refuses a result that names it, so the worker uploads instead', async () => {
        const bytes = Buffer.from('225 report-guard bytes\n', 'utf8');
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

        expect(fs.existsSync(path.join(ARTIFACT_DIRECTORY, sha256))).toBe(false);
        stagedHashes.push({ sha256, row: true, file: true });

        const { lease } = await submitAndLease();

        await global.api
            .post(`/api/v2/gpu/artifacts/upload/${sha256}?attempt_id=${lease.attempt_id}`)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes);

        fs.unlinkSync(path.join(ARTIFACT_DIRECTORY, sha256));

        const reported = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'succeeded',
                artifacts: [{ sha256, role: 'observations' }],
            });

        expect(reported.status).toBe(409);
        expect(reported.body.error.message).toContain('has not been handed over');
    });
});


// ---------------------------------------------------------------------------
// #231 and #230: a video that is not exactly 25 fps, and the retry after it.
// ---------------------------------------------------------------------------

/**
 * The frame rate Jellyfin reports for the CAMPA2026 video #231 was found on,
 * `20260611_161158_Fwd`, as `AverageFrameRate`. Its `RealFrameRate` is 25.
 *
 * @constant
 * @type {number}
 */
const OTHER_FPS = 29.97;

/**
 * The Jellyfin item these tests' jobs name. Every Jellyfin call is stubbed, so
 * this never reaches the media server.
 *
 * @constant
 * @type {string}
 */
const ITEM_231 = `jest-231-item-${runId}`;

/**
 * A spec naming a Jellyfin item, so the ingest has a video to read a rate for.
 *
 * @returns {Object} A submittable spec.
 */
function itemSpecFor() {
    return specFor({ video: { jellyfin_item_id: ITEM_231, source_name: 'jest-231.mp4' } });
}

/**
 * The real result rows as a worker would write them for a video at `fps`: the
 * same absolute frames, with `tc` and `frame` derived at that rate.
 *
 * @param {Array<Object>} rows - Rows as recorded at 25 fps.
 * @param {number} fps - The video's frame rate.
 * @returns {Array<Object>} Rows consistent at `fps`.
 */
function atRate(rows, fps) {
    return rows.map((row) => {
        const milliseconds = Math.floor((row.observation_frame * 1000) / fps);

        return { ...row, tc: deriveTc(milliseconds), frame: deriveFrame(milliseconds, fps) };
    });
}

/**
 * Stub every Jellyfin call a job naming an item makes -- at lease, at the
 * playback stop, and at ingest -- with the frame rate the video is to report.
 *
 * @param {number|null|Error} rate - The `AverageFrameRate` Jellyfin reports:
 *   a number, null for a stream that reports none, or an Error for a server
 *   that cannot be reached.
 * @returns {void}
 */
function stubJellyfin(rate, average = rate) {
    jest.spyOn(jellyfinRepository, 'buildDirectStreamUrl')
        .mockResolvedValue(`http://jellyfin.invalid/Videos/${ITEM_231}/stream?static=true`);
    jest.spyOn(jellyfinRepository, 'getItem').mockResolvedValue({
        id: ITEM_231, name: 'jest-231', type: 'Video', path: 'C:/media/jest-231.mp4',
        isFolder: false, mediaType: 'Video', runtimeTicks: 36000000000, childCount: null,
    });
    jest.spyOn(jellyfinRepository, 'reportPlaybackStarted').mockResolvedValue();
    jest.spyOn(jellyfinRepository, 'reportPlaybackProgress').mockResolvedValue();
    jest.spyOn(jellyfinRepository, 'reportPlaybackStopped').mockResolvedValue();
    jest.spyOn(jellyfinRepository, 'getPlaybackSession').mockResolvedValue(null);

    const rates = jest.spyOn(jellyfinRepository, 'getVideoFrameRate');

    if (rate instanceof Error) {
        rates.mockRejectedValue(rate);
    } else {
        rates.mockResolvedValue({ averageFrameRate: average, realFrameRate: rate });
    }
}

/**
 * Lease a job that has gone back to the queue.
 *
 * @async
 * @param {number} jobId - The job expected to come back.
 * @returns {Promise<Object>} The new lease.
 */
async function leaseAgain(jobId) {
    const leased = await global.api
        .post('/api/v2/gpu/poll')
        .send({ worker_id: workerId, slot_indexes: [0], wait_seconds: 0 });

    expect(leased.status).toBe(200);
    expect(leased.body.job_id).toBe(jobId);

    return leased.body;
}

/**
 * Take a job this suite left queued out of the queue, so no later poll leases it.
 *
 * @async
 * @param {number} jobId - The job.
 * @returns {Promise<void>}
 */
async function cancel(jobId) {
    const response = await global.api.post(`/api/v2/gpu/jobs/${jobId}/cancel`);

    expect(response.status).toBe(200);
}

/**
 * R1-R4 of #231: the timecode columns are derived at the video's own rate.
 */
describe('A video that is not exactly 25 fps (#231)', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('ingests a result derived at the rate Jellyfin reports, and every timecode agrees with it', async () => {
        stubJellyfin(OTHER_FPS);
        const rows = atRate(REAL_RESULT, OTHER_FPS);

        // The fixture has to exercise the difference, or this proves nothing:
        // at these frames the two rates disagree about the second.
        expect(rows.some((row, index) => row.tc !== REAL_RESULT[index].tc)).toBe(true);

        const { job, reported } = await runJob(rows, itemSpecFor());

        expect(reported.status).toBe(200);
        expect(reported.body.ingest).toMatchObject({
            ingested: true,
            frame_rate: OTHER_FPS,
            frame_rate_source: 'jellyfin RealFrameRate',
        });

        const stored = await observationsForJob(job.id);

        expect(stored).toHaveLength(rows.length);

        for (let index = 0; index < stored.length; index += 1) {
            const position = parseTimeSpan(stored[index].actualPosition);

            // The stored moment is the frame's time at 24.946 fps, truncated to the millisecond.
            const behind = (rows[index].observation_frame * 1000) / OTHER_FPS - position;

            expect(behind).toBeGreaterThanOrEqual(0);
            expect(behind).toBeLessThan(1);
            expect(stored[index].tc).toBe(rows[index].tc);
            expect(String(stored[index].frame)).toBe(rows[index].frame);
            expect(stored[index].mediaPosition).toBe(stored[index].actualPosition);
        }
    });

    /**
     * Frame 923 starts at 36.99991 s. The worker truncates and says 36; rounding
     * the milliseconds said 37 and refused the line. 91 frames in two hours do this.
     */
    it('puts a frame just under a whole second in that second, as the worker does', () => {
        const row = { observation_frame: 923, tc: '00:00:36', frame: '24' };
        const derived = ingestService.deriveTimecodes(row, 'line 1', 24.946007);

        expect(derived).toMatchObject({ tc: '00:00:36', frame: '24' });
        expect(derived.actualPosition).toBe('00:00:36.9990000');
    });

    it('still refuses a result that disagrees with itself at the video\'s rate', async () => {
        stubJellyfin(OTHER_FPS);

        // Consistent at 25, which is not this video's rate.
        const { job, reported } = await runJob(REAL_RESULT, itemSpecFor());

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toContain(`${OTHER_FPS} fps`);
        expect(await observationsForJob(job.id)).toHaveLength(0);

        await cancel(job.id);
    });

    it('derives at 25 when Jellyfin cannot be read, so a 25 fps result still ingests', async () => {
        stubJellyfin(new Error('jellyfin.invalid is unreachable'));

        const { job, reported } = await runJob(REAL_RESULT, itemSpecFor());

        expect(reported.body.ingest).toMatchObject({ ingested: true, frame_rate: 25 });
        expect(reported.body.ingest.frame_rate_source).toMatch(/^assumed: Jellyfin could not be read/);
        expect(await observationsForJob(job.id)).toHaveLength(REAL_RESULT.length);
    });

    it('refuses rather than stores wrong when no rate is reported and the video is not 25 fps', async () => {
        stubJellyfin(null);

        const { job, reported } = await runJob(atRate(REAL_RESULT, OTHER_FPS), itemSpecFor());

        expect(reported.body.ingest.ingested).toBe(false);
        expect(reported.body.ingest.failed).toContain('25 fps');
        expect(await observationsForJob(job.id)).toHaveLength(0);

        await cancel(job.id);
    });

    /**
     * R6. The pieces #231 cost were refused, and then #230 marked them
     * succeeded with nothing ingested. The recovery route reads a succeeded
     * job's staged artifact, so once the rate is readable it takes them in.
     */
    it('re-ingests a piece refused for its frame rate, once the rate is read', async () => {
        stubJellyfin(null);
        const rows = atRate(REAL_RESULT, OTHER_FPS);
        const { job, reported } = await runJob(rows, itemSpecFor());

        expect(reported.body.ingest.ingested).toBe(false);

        // The state #230 left 505 jobs in: succeeded, with nothing ingested.
        await db.sequelize.query("UPDATE gpu_jobs SET state = 'succeeded' WHERE id = :id", {
            replacements: { id: job.id },
        });

        jest.restoreAllMocks();
        stubJellyfin(OTHER_FPS);

        const recovered = await global.api.post(`/api/v2/gpu/jobs/${job.id}/ingest`);

        expect(recovered.status).toBe(200);
        expect(recovered.body).toMatchObject({ ingested: true, frame_rate: OTHER_FPS });
        expect(await observationsForJob(job.id)).toHaveLength(rows.length);
    });
});

/**
 * #231, the second half. A video whose timestamps jump is 25 fps on either side of
 * the jump, and its average rate is the jump spread over the file. A worker that
 * counts frames numbers everything after the jump early. Its result is stored
 * anyway, by the human's decision, and the log says so.
 */
describe('A video whose timestamps jump (#231)', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('stores a result that counted its frames, and says so in the log', async () => {
        stubJellyfin(25, 24.946007);
        const logged = jest.spyOn(logger, 'info');

        const { job, reported } = await runJob(REAL_RESULT, itemSpecFor());

        expect(reported.body.ingest).toMatchObject({ ingested: true, frame_rate: 25 });
        expect(await observationsForJob(job.id)).toHaveLength(REAL_RESULT.length);
        expect(logged.mock.calls.some(([message]) => /timestamps jump/.test(message))).toBe(true);
    });

    it('stores a result on the playback clock, at the nominal rate', async () => {
        stubJellyfin(25, 24.946007);
        const rows = REAL_RESULT.map((row) => ({ ...row, frame_clock: 'playback' }));

        const { job, reported } = await runJob(rows, itemSpecFor());

        expect(reported.body.ingest).toMatchObject({
            ingested: true,
            frame_rate: 25,
            frame_rate_source: 'jellyfin RealFrameRate',
        });
        expect(await observationsForJob(job.id)).toHaveLength(rows.length);
    });
});

/**
 * #230: a retry of a refused attempt is ingested, and a success with nothing
 * handed over is not a success.
 */
describe('A retry of an attempt whose results were refused (#230)', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * The four-for-four pattern from the sweep, with no GPU: the first attempt
     * hands over its artifact and is refused; the retry produces the same bytes,
     * is told `already_have`, and names the same hash.
     */
    it('gives the retry its own artifact row, so it is ingested rather than skipped', async () => {
        stubJellyfin(null);
        const rows = atRate(REAL_RESULT, OTHER_FPS);
        const { job, lease, reported } = await runJob(rows, itemSpecFor());

        expect(reported.body.attempt_state).toBe('failed');
        expect(reported.body.job_state).toBe('queued');

        // The rate is readable by the time of the retry.
        jest.restoreAllMocks();
        stubJellyfin(OTHER_FPS);

        const retry = await leaseAgain(job.id);
        const again = await reportObservations(retry, rows);

        expect(again.status).toBe(200);
        expect(again.body.ingest).toMatchObject({ ingested: true });
        expect(again.body.job_state).toBe('succeeded');

        const artifacts = await query(
            "SELECT metadata FROM artifacts WHERE job_id = :id AND artifact_type = 'observations'",
            { id: job.id }
        );

        // One row per attempt, both naming the same bytes.
        expect(artifacts.map((row) => Number(row.metadata.attempt_id)).sort((a, b) => a - b))
            .toEqual([lease.attempt_id, retry.attempt_id].sort((a, b) => a - b));
        expect(new Set(artifacts.map((row) => row.metadata.sha256)).size).toBe(1);

        expect(await observationsForJob(job.id)).toHaveLength(rows.length);
    });

    /**
     * The half of the dedupe that must not change: a replay is the same attempt
     * reporting twice, and still records once.
     */
    it('still records one row when the same attempt hands the same bytes over twice', async () => {
        const { job, lease } = await runJob(REAL_RESULT);
        const [recorded] = await query(
            "SELECT hash FROM artifacts WHERE job_id = :id AND artifact_type = 'observations'",
            { id: job.id }
        );
        const [attempt] = await query('SELECT * FROM gpu_job_attempts WHERE id = :id', { id: lease.attempt_id });
        const [jobRow] = await query('SELECT * FROM gpu_jobs WHERE id = :id', { id: job.id });

        const written = await gpuRepository.recordJobArtifacts({
            job: jobRow,
            attempt,
            artifacts: [{ sha256: recorded.hash, role: 'observations' }],
        });

        expect(written).toBe(0);

        const [count] = await query(
            "SELECT count(*)::int AS n FROM artifacts WHERE job_id = :id AND artifact_type = 'observations'",
            { id: job.id }
        );

        expect(count.n).toBe(1);
    });

    it('withdraws a success that hands over no artifacts, for a job that names a session', async () => {
        const { job, lease } = await submitAndLease(specFor());

        const reported = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({ worker_id: workerId, lease_epoch: lease.lease_epoch, outcome: 'succeeded', artifacts: [] });

        expect(reported.status).toBe(200);
        expect(reported.body.ingest.failed).toMatch(/handed over no artifacts/);
        expect(reported.body.attempt_state).toBe('failed');
        expect(reported.body.job_state).not.toBe('succeeded');

        const [attempt] = await query('SELECT state FROM gpu_job_attempts WHERE id = :id', { id: lease.attempt_id });

        expect(attempt.state).toBe('failed');

        await cancel(job.id);
    });

    it('leaves a stop that handed over nothing as a stop, not a failure', async () => {
        const { job, lease } = await submitAndLease(specFor());

        const reported = await global.api
            .post(`/api/v2/gpu/attempts/${lease.attempt_id}/result`)
            .send({
                worker_id: workerId,
                lease_epoch: lease.lease_epoch,
                outcome: 'yielded',
                completed_through_frame: 18100,
                artifacts: [],
            });

        expect(reported.status).toBe(200);
        expect(reported.body.ingest).toMatchObject({ ingested: false, skipped: 'this attempt handed over no artifacts' });

        const [attempt] = await query('SELECT state FROM gpu_job_attempts WHERE id = :id', { id: lease.attempt_id });

        expect(attempt.state).toBe('yielded');

        await cancel(job.id);
    });
});

/**
 * Where #231's rate comes from: Jellyfin's video stream, its average rather
 * than its nominal one.
 */
describe('Reading a video\'s frame rate from Jellyfin (#231)', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * Answer one item lookup with a raw Jellyfin response.
     *
     * @param {Object} raw - The response body.
     * @returns {void}
     */
    function answerWith(raw) {
        jest.spyOn(jellyfinRepository, '_ensureAuthenticated').mockResolvedValue({ userId: 'jest-user' });
        jest.spyOn(jellyfinRepository, '_authenticatedRequest').mockResolvedValue(raw);
    }

    it('reads both rates from the video stream, not the audio one', async () => {
        answerWith({
            Items: [{
                MediaSources: [{
                    MediaStreams: [
                        { Type: 'Audio', AverageFrameRate: 0 },
                        { Type: 'Video', AverageFrameRate: 24.946007, RealFrameRate: 25 },
                    ],
                }],
            }],
        });

        await expect(jellyfinRepository.getVideoFrameRate(ITEM_231))
            .resolves.toEqual({ averageFrameRate: 24.946007, realFrameRate: 25 });
    });

    it('reports a rate Jellyfin leaves out, or gives as zero, as none', async () => {
        answerWith({ Items: [{ MediaSources: [{ MediaStreams: [{ Type: 'Video', AverageFrameRate: 0 }] }] }] });

        await expect(jellyfinRepository.getVideoFrameRate(ITEM_231))
            .resolves.toEqual({ averageFrameRate: null, realFrameRate: null });
    });

    it('answers null for an item with no video stream', async () => {
        answerWith({ Items: [{ MediaSources: [{ MediaStreams: [{ Type: 'Audio' }] }] }] });

        await expect(jellyfinRepository.getVideoFrameRate(ITEM_231)).resolves.toBeNull();
    });
});
