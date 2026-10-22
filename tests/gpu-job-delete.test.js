/**
 * Tests for deleting every job in one state.
 *
 * **This cannot be tested in place, and that is the whole shape of the file.**
 * `DELETE /api/v2/gpu/jobs?state=failed` deletes *every* failed job in whatever database
 * it is pointed at — 1,184 of them on the workspace database as this was written, and
 * 1,189 on the development one. No amount of seeding scopes it, exactly as
 * `tests/legacy-r-promotion.test.js` found for a migration. So the behaviour is proved
 * on a database this file builds and drops, in a child process bound to it, and only the
 * refusals are exercised against the ordinary test database, because a 400 deletes
 * nothing.
 *
 * What is being pinned:
 *
 * - a job an artifact references is **excluded by the query**, so `artifacts.job_id`'s
 *   RESTRICT never fires and a partial result arrives as `{deleted, blocked}` rather
 *   than as a 500;
 * - the artifacts themselves survive — deleting the output to tidy the record of the
 *   work would be the wrong trade;
 * - attempts cascade, and the event log cascades with them, which is much the larger
 *   half of what a person is agreeing to lose;
 * - jobs in other states are untouched;
 * - `cancelled` is refused. There are four times as many of them and nobody asked.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Tests for bulk deletion of failed jobs.
 * @author Isaac Travers
 * @module tests/gpu-job-delete
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');

/** The scratch database, named per process so two runs cannot collide. */
const SCRATCH_DB = `marp_jobdelete_${process.pid}`;

/** Connection settings for the local server; only the database name differs. */
const connection = (database) => ({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database,
});

/**
 * Runs one statement against a database.
 *
 * @async
 * @param {string} database - Which database.
 * @param {string} sql - The statement.
 * @param {Array} [values] - Positional parameters.
 * @returns {Promise<Array<Object>>} The rows.
 */
async function on(database, sql, values = []) {
    const client = new Client(connection(database));

    await client.connect();

    try {
        return (await client.query(sql, values)).rows;
    } finally {
        await client.end();
    }
}

/**
 * Builds the schema the way `marp db up` and CI build theirs.
 *
 * @param {string} script - Node script to run.
 * @param {string[]} args - Its arguments.
 * @returns {void}
 */
function build(script, args) {
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, DB_NAME: SCRATCH_DB },
    });

    if (result.status !== 0) {
        throw new Error(`${path.basename(script)} failed:\n${result.stdout || ''}${result.stderr || ''}`);
    }
}

/**
 * Calls the repository in a child process bound to the scratch database.
 *
 * The repository takes its connection from `model/`, which binds once at require time,
 * so a child is the only way to point the **real** code at another database. Asserting
 * against a copy of the SQL in this file would prove the copy.
 *
 * @param {string} state - Passed to `deleteJobsInState`.
 * @returns {Object} What the repository returned.
 */
function deleteInScratch(state) {
    const script = `
        const repo = require(${JSON.stringify(path.join(ROOT, 'repository', 'gpu.repository.js'))});
        repo.deleteJobsInState(${JSON.stringify(state)})
            .then((r) => { process.stdout.write('RESULT' + JSON.stringify(r)); process.exit(0); })
            .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, DB_NAME: SCRATCH_DB },
    });

    if (result.status !== 0) {
        throw new Error(`delete in scratch failed: ${result.stderr || result.stdout}`);
    }

    const marker = (result.stdout || '').indexOf('RESULT');

    if (marker < 0) throw new Error(`no result from child: ${result.stdout}`);

    return JSON.parse(result.stdout.slice(marker + 'RESULT'.length));
}

/** Ids seeded in the scratch database, by the case each stands for. */
const seeded = {};

beforeAll(async () => {
    await on('postgres', `DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
    await on('postgres', `CREATE DATABASE "${SCRATCH_DB}"`);

    build(path.join(ROOT, 'scripts', 'init-database.js'), []);
    build(path.join(ROOT, 'node_modules', 'sequelize-cli', 'lib', 'sequelize'), ['db:migrate']);

    const job = async (name, state) => {
        const [row] = await on(
            SCRATCH_DB,
            `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts, created_at, updated_at)
             VALUES ('inference', $1, '{}'::jsonb, $2, 0, 1, 3, NOW(), NOW()) RETURNING id`,
            [name, state]
        );

        return row.id;
    };

    const [worker] = await on(
        SCRATCH_DB,
        `INSERT INTO gpu_workers (name, local_id, state, slot_count, enrolled_at, update_state)
         VALUES ('jest-delete', 'jest-delete', 'paused', 1, NOW(), 'current') RETURNING id`
    );

    seeded.workerId = worker.id;
    seeded.plainFailed = await job('plain failed', 'failed');
    seeded.failedWithAttempt = await job('failed with attempt', 'failed');
    seeded.failedWithArtifact = await job('failed with artifact', 'failed');
    seeded.succeeded = await job('succeeded', 'succeeded');

    /* A failed dataset build. The preview names these separately because a build is the
       record of something somebody ran and its dataset outlives it; the delete treats it
       as any other job, which is the pair worth seeing in one fixture. */
    const [builtRow] = await on(
        SCRATCH_DB,
        `INSERT INTO gpu_jobs (kind, name, spec, state, priority, attempts_made, max_attempts, created_at, updated_at)
         VALUES ('dataset_build', 'failed build', '{"dataset_id": 4242}'::jsonb, 'failed', 0, 1, 3, NOW(), NOW())
         RETURNING id`
    );

    seeded.failedBuild = builtRow.id;
    seeded.cancelled = await job('cancelled', 'cancelled');

    /* A selection: one safe, one holding observations, one held by an artifact. */
    seeded.selectionSafe = await job('selection safe', 'cancelled');
    seeded.selectionWithObservations = await job('selection with observations', 'succeeded');
    seeded.selectionWithArtifact = await job('selection with artifact', 'failed');


    /* An attempt and one event on it, so the cascade is observable rather than assumed. */
    const [attempt] = await on(
        SCRATCH_DB,
        `INSERT INTO gpu_job_attempts (job_id, worker_id, slot_index, lease_epoch, state, leased_at, lease_expires_at, failure_reason)
         VALUES ($1, $2, 0, 1, 'failed', NOW(), NOW(), 'why it failed') RETURNING id`,
        [seeded.failedWithAttempt, seeded.workerId]
    );

    seeded.attemptId = attempt.id;

    await on(
        SCRATCH_DB,
        `INSERT INTO gpu_job_events (attempt_id, seq, at, kind, payload)
         VALUES ($1, 1, NOW(), 'log', '{}'::jsonb)`,
        [attempt.id]
    );

    /* A succeeded job with observations hanging off it: the dangerous case, because
       SET NULL means this delete neither refuses nor cascades. */
    seeded.succeededWithObservations = await job('succeeded with observations', 'succeeded');

    const [project] = await on(
        SCRATCH_DB,
        `INSERT INTO projects (name, "createdAt", "updatedAt") VALUES ('Jest Delete', NOW(), NOW()) RETURNING project_id`
    );
    const [session] = await on(
        SCRATCH_DB,
        `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES ($1, 1, 'JD0001', 'L1', 'LID-JD-1', 'transect', NOW(), NOW()) RETURNING session_id`,
        [project.project_id]
    );

    seeded.observationIds = [];

    for (const n of [1, 2]) {
        const [obs] = await on(
            SCRATCH_DB,
            `INSERT INTO observations (session_id, project_id, "obsID", comname, gpu_job_id, tc, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, 'Jest Delete', $4, '10:00:00', NOW(), NOW()) RETURNING observation_id`,
            [session.session_id, project.project_id, n, seeded.succeededWithObservations]
        );

        seeded.observationIds.push(obs.observation_id);
    }

    /* The selection's own observation-holder, so the selection tests do not depend on
       the single-job tests having run or not run first. */
    for (const n of [3, 4]) {
        await on(
            SCRATCH_DB,
            `INSERT INTO observations (session_id, project_id, "obsID", comname, gpu_job_id, tc, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, 'Jest Delete Selection', $4, '10:00:00', NOW(), NOW())`,
            [session.session_id, project.project_id, n, seeded.selectionWithObservations]
        );
    }

    await on(
        SCRATCH_DB,
        `INSERT INTO artifacts (job_id, artifact_type, path, created_at, updated_at)
         VALUES ($1, 'log', 'jest/selection.log', NOW(), NOW())`,
        [seeded.selectionWithArtifact]
    );

    /* The artifact that makes its job undeletable. */
    await on(
        SCRATCH_DB,
        `INSERT INTO artifacts (job_id, artifact_type, path, created_at, updated_at)
         VALUES ($1, 'log', 'jest/delete.log', NOW(), NOW())`,
        [seeded.failedWithArtifact]
    );
}, 180000);

afterAll(async () => {
    await on('postgres', `DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
}, 60000);

/**
 * Calls the preview in a child process bound to the scratch database.
 *
 * @param {string} state - Passed to `previewDeleteJobsInState`.
 * @returns {Object} What the repository returned.
 */
function previewInScratch(state) {
    const script = `
        const repo = require(${JSON.stringify(path.join(ROOT, 'repository', 'gpu.repository.js'))});
        repo.previewDeleteJobsInState(${JSON.stringify(state)})
            .then((r) => { process.stdout.write('RESULT' + JSON.stringify(r)); process.exit(0); })
            .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, DB_NAME: SCRATCH_DB },
    });

    if (result.status !== 0) {
        throw new Error(`preview in scratch failed: ${result.stderr || result.stdout}`);
    }

    const marker = (result.stdout || '').indexOf('RESULT');

    if (marker < 0) throw new Error(`no result from child: ${result.stdout}`);

    return JSON.parse(result.stdout.slice(marker + 'RESULT'.length));
}

/* **Before the delete, because it is about to stop being answerable.** The describe below
   empties the failed state in its own `beforeAll`, so a preview asserted afterwards would
   be a preview of nothing and would pass by counting zeroes. Jest runs describes in file
   order; this one has to come first, and that is a dependency between blocks rather than a
   coincidence of layout. */
describe('counting what a clear would take, before it takes it (#268)', () => {

    /** What the preview reported, on the scratch database. */
    let plan;

    beforeAll(() => {
        plan = previewInScratch('failed');
    }, 60000);

    test('counts the jobs the delete would take, and not the one it would not', () => {
        /* Five jobs are `failed`; two of them are held by an artifact -- the one seeded
           for this and the one the selection tests use, which is `failed` as well. The
           preview and the delete exclude both by the same `NOT EXISTS`, which is the
           property worth pinning: two expressions that agreed today would be free to
           drift tomorrow. */
        expect(plan.jobs).toBe(3);
        expect(plan.blocked).toBe(2);
    });

    test('counts the attempts and the events that cascade with them', () => {
        /* One attempt carrying one event, on `failedWithAttempt`. This is the half a
           person is really agreeing to lose, and the half a confirmation has no other
           way to name: nothing else serves it. */
        expect(plan.attempts).toBe(1);
        expect(plan.events).toBe(1);
    });

    test('counts no observations, because no failed job here produced any', () => {
        /* The observation holders are `succeeded`, so a preview that counted them would
           be counting rows this delete cannot reach. */
        expect(plan.observations).toBe(0);
    });

    test('names the dataset build among them, with the dataset it produced', () => {
        /* A failed build is the record of something somebody ran, and its dataset
           outlives it -- so it is named rather than folded into a total. The dataset id
           comes out of the spec, which is where a build keeps it. */
        expect(plan.builds).toEqual([{ id: seeded.failedBuild, dataset_id: 4242 }]);
    });

    test('counting deletes nothing', async () => {
        /* The whole point of it being a separate verb. A preview that had deleted would
           make the four assertions above descriptions of a database that no longer
           exists, and the delete below would then report two jobs rather than three. */
        const rows = await on(SCRATCH_DB, 'SELECT COUNT(*)::int AS n FROM gpu_jobs WHERE state = $1', ['failed']);

        expect(rows[0].n).toBe(5);
    });
});

describe('deleting failed jobs (#268)', () => {

    /** What the repository reported, on the scratch database. */
    let result;

    beforeAll(() => {
        result = deleteInScratch('failed');
    }, 60000);

    test('deletes the failed jobs that nothing holds', () => {
        expect(result.deleted.sort()).toEqual(
            [seeded.plainFailed, seeded.failedWithAttempt, seeded.failedBuild].sort());
    });

    test('a job an artifact references is reported, not attempted', () => {
        /* The RESTRICT never fires: the query excludes it. Attempted and caught, this
           would be an error path on a bulk delete, and 19 of his 1,189 are like this. */
        expect(result.blocked.sort()).toEqual(
            [seeded.failedWithArtifact, seeded.selectionWithArtifact].sort()
        );
    });

    test('and that job, and its artifact, are both still there', async () => {
        const jobs = await on(SCRATCH_DB, 'SELECT id FROM gpu_jobs WHERE id = $1', [seeded.failedWithArtifact]);
        const artifacts = await on(SCRATCH_DB, 'SELECT id FROM artifacts WHERE job_id = $1', [seeded.failedWithArtifact]);

        expect(jobs).toHaveLength(1);
        expect(artifacts).toHaveLength(1);
    });

    test('the attempts go with the job, and the event log goes with them', async () => {
        /* The larger half of what somebody agrees to lose: `failure_reason` is on the
           attempt and the log is on the events, several times as many rows. */
        const attempts = await on(SCRATCH_DB, 'SELECT id FROM gpu_job_attempts WHERE id = $1', [seeded.attemptId]);
        const events = await on(SCRATCH_DB, 'SELECT attempt_id FROM gpu_job_events WHERE attempt_id = $1', [seeded.attemptId]);

        expect(attempts).toHaveLength(0);
        expect(events).toHaveLength(0);
    });

    test('jobs in other states are untouched', async () => {
        const rows = await on(SCRATCH_DB, 'SELECT id, state FROM gpu_jobs WHERE id = ANY($1) ORDER BY id', [[seeded.succeeded, seeded.cancelled]]);

        expect(rows.map((r) => r.state).sort()).toEqual(['cancelled', 'succeeded']);
    });

    test('running it again deletes nothing and still reports the blocked one', () => {
        const again = deleteInScratch('failed');

        expect(again.deleted).toEqual([]);
        expect(again.blocked.sort()).toEqual(
            [seeded.failedWithArtifact, seeded.selectionWithArtifact].sort()
        );
    }, 60000);
});

/**
 * Calls the service for one job in the scratch database, the same way.
 *
 * @param {number} jobId - The job.
 * @param {boolean} ack - Whether the caller acknowledged the observation loss.
 * @returns {Object} `{ok, body}` -- the result, or the ApiError's status and message.
 */
function deleteOneInScratch(jobId, ack) {
    const script = `
        const svc = require(${JSON.stringify(path.join(ROOT, 'service', 'gpu.service.js'))});
        svc.deleteJob(${JSON.stringify(String(jobId))}, { acknowledgeObservations: ${ack ? 'true' : 'false'} })
            .then((r) => { process.stdout.write('RESULT' + JSON.stringify({ ok: true, body: r })); process.exit(0); })
            .catch((e) => { process.stdout.write('RESULT' + JSON.stringify({ ok: false, status: e.statusCode || e.status, message: String(e.message) })); process.exit(0); });
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_NAME: SCRATCH_DB },
    });

    const marker = (result.stdout || '').indexOf('RESULT');

    if (marker < 0) throw new Error(`no result from child: ${result.stdout} ${result.stderr}`);

    return JSON.parse(result.stdout.slice(marker + 'RESULT'.length));
}

describe('deleting one job, whatever state it is in (#268)', () => {

    test('a job that produced observations refuses, and says how many', () => {
        const refused = deleteOneInScratch(seeded.succeededWithObservations, false);

        /* `observations.gpu_job_id` is SET NULL, so this delete would not refuse and
           would not cascade -- it would quietly unlink the provenance of every one of
           them. On the real corpus that is 114,866 rows across the succeeded jobs. */
        expect(refused.ok).toBe(false);
        expect(refused.status).toBe(409);
        expect(refused.message).toMatch(/produced 2 observations/);
    }, 60000);

    test('and it is still there afterwards, with its observations still linked', async () => {
        const jobs = await on(SCRATCH_DB, 'SELECT id FROM gpu_jobs WHERE id = $1', [seeded.succeededWithObservations]);
        const linked = await on(SCRATCH_DB, 'SELECT count(*)::int n FROM observations WHERE gpu_job_id = $1', [seeded.succeededWithObservations]);

        expect(jobs).toHaveLength(1);
        expect(linked[0].n).toBe(2);
    });

    test('acknowledged, it deletes and reports what it unlinked', async () => {
        const done = deleteOneInScratch(seeded.succeededWithObservations, true);

        expect(done.ok).toBe(true);
        expect(done.body.observationsUnlinked).toBe(2);

        const linked = await on(SCRATCH_DB, 'SELECT count(*)::int n FROM observations WHERE gpu_job_id = $1', [seeded.succeededWithObservations]);
        const kept = await on(SCRATCH_DB, 'SELECT count(*)::int n FROM observations WHERE observation_id = ANY($1)', [seeded.observationIds]);

        /* The observations survive -- that is what SET NULL means, and it is the whole
           reason the warning has to be explicit. Only the link goes. */
        expect(linked[0].n).toBe(0);
        expect(kept[0].n).toBe(2);
    }, 60000);

    test('a job with no observations needs no acknowledgement', () => {
        const done = deleteOneInScratch(seeded.cancelled, false);

        expect(done.ok).toBe(true);
        expect(done.body.observationsUnlinked).toBe(0);
    }, 60000);

    test('an artifact refuses the delete outright', () => {
        const refused = deleteOneInScratch(seeded.failedWithArtifact, true);

        // Even acknowledged: the acknowledgement is about observations, not artifacts.
        expect(refused.ok).toBe(false);
        expect(refused.status).toBe(409);
        expect(refused.message).toMatch(/artifact/);
    }, 60000);
});

/**
 * Delete a selection in the scratch database, through the service.
 *
 * @param {number[]} ids - The selection.
 * @returns {Object} `{ok, body}` or the error's status and message.
 */
function deleteSelectionInScratch(ids) {
    const script = `
        const svc = require(${JSON.stringify(path.join(ROOT, 'service', 'gpu.service.js'))});
        svc.deleteJobsByIds({ ids: ${JSON.stringify(ids.join(','))} })
            .then((r) => { process.stdout.write('RESULT' + JSON.stringify({ ok: true, body: r })); process.exit(0); })
            .catch((e) => { process.stdout.write('RESULT' + JSON.stringify({ ok: false, status: e.statusCode || e.status, message: String(e.message) })); process.exit(0); });
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_NAME: SCRATCH_DB },
    });

    const marker = (result.stdout || '').indexOf('RESULT');

    if (marker < 0) throw new Error(`no result from child: ${result.stdout} ${result.stderr}`);

    return JSON.parse(result.stdout.slice(marker + 'RESULT'.length));
}

describe('deleting a selection (#268)', () => {

    test('deletes what is safe and says why the rest stayed', () => {
        const result = deleteSelectionInScratch([
            seeded.selectionSafe,
            seeded.selectionWithObservations,
            seeded.selectionWithArtifact,
            999000001,
        ]);

        expect(result.ok).toBe(true);
        expect(result.body.deleted).toBe(1);

        const byId = Object.fromEntries(result.body.blocked.map((b) => [b.id, b.reason]));

        /* The reason travels with the id, so a screen can say "3 left: one produced
           2 observations, one is referenced by artifacts" rather than a bare count. */
        expect(byId[seeded.selectionWithObservations]).toMatch(/produced 2 observations/);
        expect(byId[seeded.selectionWithArtifact]).toMatch(/artifact/);
        expect(byId[999000001]).toBe('no such job');
    }, 60000);

    test('a selection cannot force a job holding observations', async () => {
        /* The whole point of the shape: there is no acknowledgement here, so the only
           way to delete that job is one at a time with its own count in front of you. */
        const rows = await on(SCRATCH_DB, 'SELECT id FROM gpu_jobs WHERE id = $1', [seeded.selectionWithObservations]);

        expect(rows).toHaveLength(1);
    });

    test('an empty or malformed selection is refused', () => {
        expect(deleteSelectionInScratch([]).status).toBe(400);
    }, 60000);
});

describe('what it refuses (#268)', () => {

    /* These run against the ordinary test database on purpose: a refused request
       deletes nothing, so there is nothing to scope and nothing to clean up. */

    test('cancelled is refused rather than quietly included', async () => {
        const response = await global.api.delete('/api/v2/gpu/jobs?state=cancelled');

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/failed/);
    });

    test('an unknown state is refused', async () => {
        const response = await global.api.delete('/api/v2/gpu/jobs?state=banana');

        expect(response.status).toBe(400);
    });

    test('a refused request deletes nothing', async () => {
        const before = await global.api.get('/api/v2/gpu/jobs?state=failed&limit=1');

        await global.api.delete('/api/v2/gpu/jobs?state=cancelled');

        const after = await global.api.get('/api/v2/gpu/jobs?state=failed&limit=1');

        expect(after.body.total).toBe(before.body.total);
    });
});
