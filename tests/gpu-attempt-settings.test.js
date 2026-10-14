/**
 * Endpoint tests for an attempt's record of the inference settings it ran with.
 *
 * The worker reports them as a `settings` event before its first frame (#232),
 * and they land in `gpu_attempt_settings` and `gpu_attempt_ignored_params` beside
 * the event itself. Tested at the HTTP tier because that is the contract the
 * worker speaks, and the one place the validation, the lease check and the write
 * are seen together.
 *
 * **No job here is ever queued.** A poll takes the best-priority queued job in the
 * whole database, and a real worker may be polling this one. So every job is
 * created already `leased`, with its attempt `running` and `max_attempts` 1, which
 * nothing can lease and nothing can requeue. That is also why this suite does not
 * refuse to run while other jobs are queued, the way the orchestration suites do.
 *
 * @fileoverview Endpoint tests for the settings an attempt ran with.
 * @author Isaac Travers
 * @module tests/gpu-attempt-settings
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const ingestRepository = require('../repository/observation-ingest.repository');

/**
 * Unique per run, so a failed run's leftovers are recognisable and two runs
 * cannot collide on the durable id a worker enrols with.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * The engine the seeded catalogue describes.
 *
 * @constant
 * @type {string}
 */
const ENGINE = 'marp_tracking';

/** Rows this suite created, removed in afterAll. @type {Object} */
const created = {
    workerId: null,
    jobIds: [],
    projectId: null,
    sessionId: null,
    catalogueNames: [],
};

/**
 * A report as a worker sends it. Covers every type and every source, plus a real
 * setting that happens to be whole: JSON cannot tell 1.0 from 1.
 *
 * @constant
 * @type {Object}
 */
const REPORT = {
    engine: ENGINE,
    settings: {
        confidence: { value: 0.001, type: 'real', source: 'job' },
        imgsz: { value: 640, type: 'int', source: 'default' },
        augment: { value: true, type: 'bool', source: 'job' },
        match_thresh: { value: 1, type: 'real', source: 'default' },
        class_match_iou: { value: 0.4, type: 'real', source: 'engine' },
    },
    ignored: { track_threshh: 0.5 },
};

/**
 * Run one statement against the development database.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * A running attempt that no poll can take.
 *
 * @async
 * @returns {Promise<{jobId: number, attemptId: number}>} The job and its attempt.
 */
async function liveAttempt() {
    const [job] = await query(
        `INSERT INTO gpu_jobs (kind, spec, state, attempts_made, max_attempts)
         VALUES ('inference', :spec, 'leased', 1, 1)
         RETURNING id`,
        { spec: JSON.stringify({ jest: `gpu-attempt-settings-${runId}` }) }
    );

    created.jobIds.push(job.id);

    const [attempt] = await query(
        `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, lease_expires_at)
         VALUES (:jobId, :workerId, 0, 1, 'running', NOW() + INTERVAL '1 hour')
         RETURNING id`,
        { jobId: job.id, workerId: created.workerId }
    );

    return { jobId: job.id, attemptId: attempt.id };
}

/**
 * Send a batch of events for an attempt, as its worker.
 *
 * @param {number} attemptId - Attempt the events belong to.
 * @param {Array<Object>} events - `{seq, kind, payload}` entries.
 * @returns {Promise<Object>} The Supertest response.
 */
function sendEvents(attemptId, events) {
    return global.api
        .post(`/api/v2/gpu/attempts/${attemptId}/events`)
        .send({ worker_id: created.workerId, lease_epoch: 1, events });
}

/**
 * What an attempt's record says, one row per setting.
 *
 * @param {number} attemptId - Attempt to read.
 * @returns {Promise<Array<Object>>} Name, type, the four value columns and source.
 */
function recorded(attemptId) {
    return query(
        `SELECT s.name, s.value_type, v.value_real, v.value_int, v.value_bool, v.value_text, v.source
           FROM gpu_attempt_settings v
           JOIN inference_settings s ON s.id = v.setting_id
          WHERE v.attempt_id = :attemptId
          ORDER BY s.name`,
        { attemptId }
    );
}

/**
 * The recorded value, from whichever column holds it. `value_int` is BIGINT,
 * which the driver returns as a string.
 *
 * @param {Object} row - A row from `recorded`.
 * @returns {*} The value.
 */
function valueOf(row) {
    if (row.value_int !== null) return Number(row.value_int);
    if (row.value_real !== null) return row.value_real;
    if (row.value_bool !== null) return row.value_bool;
    return row.value_text;
}

beforeAll(async () => {
    const enrolled = await global.api
        .post('/api/v2/gpu/workers/enrol')
        .send({
            local_id: `jest-settings-local-${runId}`,
            name: `jest-settings-worker-${runId}`,
            slot_count: 8,
            worker_version: '0.0.1-jest',
            capabilities: { gpus: [], engines: [ENGINE] },
        });

    expect(enrolled.status).toBe(200);
    created.workerId = enrolled.body.worker_id;

    const [project] = await query(
        `INSERT INTO projects (name, "createdAt", "updatedAt")
         VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { name: `jest-settings-project-${runId}` }
    );
    created.projectId = project.project_id;

    const [session] = await query(
        `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:projectId, NULL, 'Dive 232', '1', 'Dive 232_1', 'Invert', NOW(), NOW())
         RETURNING session_id`,
        { projectId: created.projectId }
    );
    created.sessionId = session.session_id;
});

afterAll(async () => {
    if (created.jobIds.length > 0) {
        // Observations first: they point at the attempts, and are this suite's.
        await db.sequelize.query('DELETE FROM observations WHERE gpu_job_id IN (:jobIds)', {
            replacements: { jobIds: created.jobIds },
        });

        // Attempts, their events and their settings rows go with the job, by cascade.
        await db.sequelize.query('DELETE FROM gpu_jobs WHERE id IN (:jobIds)', {
            replacements: { jobIds: created.jobIds },
        });
    }

    // Only after the values are gone: the catalogue key is RESTRICT.
    if (created.catalogueNames.length > 0) {
        await db.sequelize.query(
            'DELETE FROM inference_settings WHERE engine = :engine AND name IN (:names)',
            { replacements: { engine: ENGINE, names: created.catalogueNames } }
        );
    }

    if (created.sessionId) {
        await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', {
            replacements: { id: created.sessionId },
        });
    }

    if (created.projectId) {
        await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', {
            replacements: { id: created.projectId },
        });
    }

    if (created.workerId) {
        await db.sequelize.query('DELETE FROM gpu_workers WHERE id = :id', {
            replacements: { id: created.workerId },
        });
    }
});

/**
 * R1, R2, R3, R5: the report becomes typed, queryable rows.
 */
describe('A worker reporting the settings it ran with', () => {
    let attemptId;

    beforeAll(async () => {
        ({ attemptId } = await liveAttempt());

        const response = await sendEvents(attemptId, [{ seq: 0, kind: 'settings', payload: REPORT }]);

        expect(response.status).toBe(200);
        expect(response.body.accepted).toBe(1);
    });

    it('records every setting in the column its type names, with where it came from', async () => {
        const rows = await recorded(attemptId);

        expect(rows.map((row) => [row.name, valueOf(row), row.source])).toEqual([
            ['augment', true, 'job'],
            ['class_match_iou', 0.4, 'engine'],
            ['confidence', 0.001, 'job'],
            ['imgsz', 640, 'default'],
            ['match_thresh', 1, 'default'],
        ]);

        // A whole real is still stored as a real, because the catalogue says so.
        const match = rows.find((row) => row.name === 'match_thresh');
        expect(match.value_real).toBe(1);
        expect(match.value_int).toBeNull();
    });

    it('records a default as the value that was used, not as its absence', async () => {
        const imgsz = (await recorded(attemptId)).find((row) => row.name === 'imgsz');

        expect(imgsz.source).toBe('default');
        expect(Number(imgsz.value_int)).toBe(640);
    });

    it('records what the job asked for that the worker did not honour', async () => {
        const ignored = await query(
            'SELECT key, requested_value FROM gpu_attempt_ignored_params WHERE attempt_id = :attemptId',
            { attemptId }
        );

        expect(ignored).toEqual([{ key: 'track_threshh', requested_value: '0.5' }]);
    });

    it('can be queried setting by setting, which is the point of the tables', async () => {
        const deepSea = await query(
            `SELECT v.attempt_id
               FROM gpu_attempt_settings v
               JOIN inference_settings s ON s.id = v.setting_id
              WHERE s.engine = :engine AND s.name = 'confidence' AND v.value_real < 0.01
                AND v.attempt_id = :attemptId`,
            { engine: ENGINE, attemptId }
        );

        expect(deepSea).toEqual([{ attempt_id: attemptId }]);
    });

    it('keeps the report as an event too', async () => {
        const [event] = await query(
            "SELECT payload FROM gpu_job_events WHERE attempt_id = :attemptId AND kind = 'settings'",
            { attemptId }
        );

        expect(event.payload.engine).toBe(ENGINE);
        expect(event.payload.settings.confidence.value).toBe(0.001);
    });
});

/**
 * The first report is the record.
 */
describe('Reporting again', () => {
    let attemptId;

    beforeAll(async () => {
        ({ attemptId } = await liveAttempt());

        const first = await sendEvents(attemptId, [{ seq: 0, kind: 'settings', payload: REPORT }]);
        expect(first.status).toBe(200);
    });

    it('writes nothing new when the same batch is replayed', async () => {
        const before = await recorded(attemptId);

        const replay = await sendEvents(attemptId, [{ seq: 0, kind: 'settings', payload: REPORT }]);

        expect(replay.status).toBe(200);
        expect(replay.body.duplicates).toBe(1);
        expect(await recorded(attemptId)).toEqual(before);
    });

    it('keeps the first report when a later one says something different', async () => {
        const changed = {
            ...REPORT,
            settings: { ...REPORT.settings, confidence: { value: 0.9, type: 'real', source: 'job' } },
        };

        const later = await sendEvents(attemptId, [{ seq: 1, kind: 'settings', payload: changed }]);

        // Kept as an event, so nothing the worker said is lost...
        expect(later.status).toBe(200);
        expect(later.body.accepted).toBe(1);

        // ...but the record is still the first report.
        const confidence = (await recorded(attemptId)).find((row) => row.name === 'confidence');
        expect(confidence.value_real).toBe(0.001);
    });
});

/**
 * An unknown setting is registered, never refused.
 */
describe('A setting the catalogue has not seen', () => {
    it('is registered with the type the worker declared, and its value recorded', async () => {
        const { attemptId } = await liveAttempt();
        const name = `jest_setting_${runId}`;

        created.catalogueNames.push(name);

        const response = await sendEvents(attemptId, [{
            seq: 0,
            kind: 'settings',
            payload: { engine: ENGINE, settings: { [name]: { value: 0.25, type: 'real', source: 'job' } } },
        }]);

        expect(response.status).toBe(200);

        const [entry] = await query(
            'SELECT value_type, description FROM inference_settings WHERE engine = :engine AND name = :name',
            { engine: ENGINE, name }
        );

        expect(entry).toEqual({ value_type: 'real', description: null });
        expect((await recorded(attemptId)).map((row) => [row.name, valueOf(row)])).toEqual([[name, 0.25]]);
    });
});

/**
 * A malformed report is refused whole, and nothing is written -- not the rows,
 * and not the event either.
 */
describe('A malformed report', () => {
    /**
     * Send one bad report and check it left no trace.
     *
     * @async
     * @param {Object} payload - The report.
     * @returns {Promise<Object>} The response.
     */
    async function refused(payload) {
        const { attemptId } = await liveAttempt();
        const response = await sendEvents(attemptId, [{ seq: 0, kind: 'settings', payload }]);

        expect(response.status).toBe(400);
        expect(await recorded(attemptId)).toEqual([]);

        const events = await query('SELECT seq FROM gpu_job_events WHERE attempt_id = :attemptId', { attemptId });
        expect(events).toEqual([]);

        return response;
    }

    it('is refused when a value disagrees with its catalogue type', async () => {
        const response = await refused({
            engine: ENGINE,
            settings: { imgsz: { value: 640.5, type: 'real', source: 'job' } },
        });

        expect(JSON.stringify(response.body)).toContain('imgsz');
    });

    it('is refused when a value is null, since a default is recorded as its value', async () => {
        await refused({ engine: ENGINE, settings: { iou: { value: null, type: 'real', source: 'default' } } });
    });

    it('is refused when a value is not the type it declares', async () => {
        await refused({ engine: ENGINE, settings: { half: { value: 'yes', type: 'bool', source: 'job' } } });
    });

    it('is refused when the source is not job, default or engine', async () => {
        await refused({ engine: ENGINE, settings: { iou: { value: 0.2, type: 'real', source: 'guessed' } } });
    });
});

/**
 * R4, as far as the API can see it: a record made before the attempt ended
 * survives however it ended.
 */
describe('An attempt that ends badly', () => {
    it('still has its settings after it reports failure', async () => {
        const { jobId, attemptId } = await liveAttempt();

        const report = await sendEvents(attemptId, [{ seq: 0, kind: 'settings', payload: REPORT }]);
        expect(report.status).toBe(200);

        const result = await global.api
            .post(`/api/v2/gpu/attempts/${attemptId}/result`)
            .send({
                worker_id: created.workerId,
                lease_epoch: 1,
                outcome: 'failed',
                failure_reason: 'jest: failed after its settings were resolved',
                artifacts: [],
            });

        expect(result.status).toBe(200);
        expect(await recorded(attemptId)).toHaveLength(Object.keys(REPORT.settings).length);

        // And it was not put back in the queue for a real worker to take.
        const [job] = await query('SELECT state FROM gpu_jobs WHERE id = :jobId', { jobId });
        expect(job.state).not.toBe('queued');
    });
});

/**
 * R7: a worker without this change reports no settings, and that is fine.
 */
describe('An attempt from a worker that reports no settings', () => {
    it('records nothing, and its other events are accepted as before', async () => {
        const { attemptId } = await liveAttempt();

        const response = await sendEvents(attemptId, [
            { seq: 0, kind: 'log', payload: { level: 'info', message: 'an older worker' } },
        ]);

        expect(response.status).toBe(200);
        expect(response.body.accepted).toBe(1);
        expect(await recorded(attemptId)).toEqual([]);
    });
});

/**
 * R6: an observation reaches the settings it was produced under.
 */
describe('An observation ingested from an attempt', () => {
    /**
     * Write one observation for a job through the ingest repository, which is
     * where the attempt is attached.
     *
     * @async
     * @param {number} jobId - Job the row belongs to.
     * @param {number|undefined} attemptId - Attempt handing it over, or none.
     * @returns {Promise<number>} The new observation's id.
     */
    async function ingestOne(jobId, attemptId) {
        const written = await ingestRepository.writeJobObservations({
            jobId,
            sessionId: created.sessionId,
            projectId: created.projectId,
            sessionType: 'Invert',
            attemptId,
            observations: [{
                row: {
                    comname: 'jest',
                    count: 1,
                    confidence: 0.5,
                    video_source: `jest-settings-${runId}.mp4`,
                },
                keyframes: [],
            }],
        });

        return written.observation_ids[0];
    }

    it('carries the attempt it came from, and so reaches that attempt\'s settings', async () => {
        const { jobId, attemptId } = await liveAttempt();
        await sendEvents(attemptId, [{ seq: 0, kind: 'settings', payload: REPORT }]);

        const observationId = await ingestOne(jobId, attemptId);

        const [row] = await query(
            `SELECT v.value_real AS confidence
               FROM observations o
               JOIN gpu_attempt_settings v ON v.attempt_id = o.gpu_attempt_id
               JOIN inference_settings s ON s.id = v.setting_id AND s.name = 'confidence'
              WHERE o.observation_id = :observationId`,
            { observationId }
        );

        expect(row).toEqual({ confidence: 0.001 });
    });

    it('carries no attempt on the ingest path that has none', async () => {
        const { jobId } = await liveAttempt();

        const observationId = await ingestOne(jobId, undefined);

        const [row] = await query(
            'SELECT gpu_attempt_id FROM observations WHERE observation_id = :observationId',
            { observationId }
        );

        expect(row.gpu_attempt_id).toBeNull();
    });
});
