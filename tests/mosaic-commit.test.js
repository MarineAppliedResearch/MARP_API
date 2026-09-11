/**
 * Tests for the three mosaic page-commit endpoints (#106).
 *
 * Phase 5 of #68, the write path. Three tiers, and which one a requirement lands
 * in is the decision that matters:
 *
 * - **`http+db`** — Supertest through the real Express app against the real
 *   development PostgreSQL, through `tests/setup/authenticated-agent.js` where a
 *   full-permission caller is wanted and through purpose-built narrow agents where
 *   the question is who may call. Rows are seeded **committed**, not in a
 *   rolled-back transaction, because an HTTP request cannot see an uncommitted one.
 * - **`db`** — reads straight against `observation_reviews`,
 *   `observation_review_current` and the cascade set, after a commit went through
 *   the endpoint. This is the only tier that can see what was *not* written, which
 *   is half of what this phase is about (D2).
 * - **`source`** — one assertion about the committed repository text, for #106's
 *   D6: the write path is append-only by construction, and the check that costs
 *   nothing is the one that fails when somebody adds an UPDATE.
 *
 * **Four of these are meaningless anywhere but against the real database**, which
 * is why they are here and not in a unit test: two commits genuinely racing, the
 * version conflict, the withdrawal's `CHECK`, and the delete cascade. A unit test
 * on a repository method cannot see any of the four.
 *
 * Every question is scoped to this run's own seeded rows. The database is shared
 * and holds rows this suite did not create, so an unscoped assertion about a count
 * would pass or fail on what somebody else left behind.
 *
 * **#111 rewrote the last-wins block.** Those tests changed because the rule
 * changed, not because they broke: the human overruled first-valid-review-wins on
 * 2026-09-09, so a second reviewer is no longer refused and a withdrawal is no
 * longer reviewer-scoped.
 *
 * Refs #106, #111.
 *
 * @fileoverview Endpoint, database and source tests for the mosaic page commit (#106, #111).
 * @author Isaac Travers
 * @module tests/mosaic-commit
 */

const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../app');
const db = require('../model');

const { QueryTypes } = db.Sequelize;

/** Where the three routes actually answer. */
const REVIEW = '/api/v2/mosaic/observations/review';
const TRAINING = '/api/v2/mosaic/observations/training';
const DELETE = '/api/v2/mosaic/observations/delete';

/** The paths the routes are *declared* at. Nothing should answer here. */
const DECLARED_REVIEW = '/api/mosaic/observations/review';

/** The write path, read as text for the append-only assertion (D6). */
const COMMIT_REPOSITORY = path.join(
    __dirname, '..', 'repository', 'mosaic-commit.repository.js'
);

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Everything seeded, so `afterAll` can remove exactly it. */
const seeded = {
    projectId: null,
    sessionId: null,
    datasetId: null,
    observationIds: [],
    userIds: [],
    appId: null,
};

/**
 * Runs one statement and returns its rows.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Named replacements.
 * @returns {Promise<Array<Object>>} The rows.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * The derivation, read off disk once, from whichever migration currently defines
 * it.
 *
 * **Found rather than named**, so that a later redefinition cannot leave this
 * asserting the projection matches a rule nothing runs. See
 * `tests/setup/current-derivation.js`, which also normalises line endings.
 *
 * @type {string}
 */
const { currentDerivationBlock: derivationBlock } = require('./setup/current-derivation');

/**
 * Inserts observations and records them for cleanup.
 *
 * Written with SQL rather than `db.observations.create`, because the model
 * declares the key without `autoIncrement` and Sequelize sends an explicit null
 * (#62).
 *
 * **Each one is given a `ready` thumbnail** (#118 R12). Phase 6 made the server
 * able to judge imagery: an *unmarked* row whose thumbnail is not ready is now
 * `skipped` with reason `no-imagery` rather than accepted, because accepting it
 * would be a reviewer saying "this is right" about a picture they were never
 * shown. Every test in this suite is about commit semantics rather than about
 * imagery, so its fixtures are tiles a reviewer could actually have looked at.
 * The tests that are about the skip use {@link removeImagery} to take it away.
 *
 * The row says `ready` and no file is written, deliberately: the commit path
 * reads the row and never stats the file, and asserting that is part of what
 * keeps a page of 600 from becoming 600 filesystem calls.
 *
 * @param {number} count - How many.
 * @returns {Promise<Array<number>>} The new ids, ascending.
 */
async function addObservations(count) {
    const rows = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, tc, "createdAt", "updatedAt")
         SELECT :sessionId, :projectId, 950000 + g, 0.5, :comname, '10:00:00', NOW(), NOW()
           FROM generate_series(1, :count) AS g
         RETURNING observation_id`,
        {
            sessionId: seeded.sessionId,
            projectId: seeded.projectId,
            comname: `Jest Commit ${runId}`,
            count,
        }
    );

    const ids = rows.map((row) => row.observation_id).sort((a, b) => a - b);

    seeded.observationIds.push(...ids);

    await q(
        // `IN (:ids)` rather than `= ANY(:ids)`: a named replacement holding an
        // array expands to `(1,2,3)`, which makes ANY a syntax error.
        `INSERT INTO observation_thumbnails
             (observation_id, status, permanent, filename, content_type, generation,
              attempts, requested_at, completed_at, created_at, updated_at)
         SELECT o.observation_id, 'ready', false,
                o.observation_id || '-jest-commit.jpg', 'image/jpeg', 1,
                1, NOW(), NOW(), NOW(), NOW()
           FROM observations o
          WHERE o.observation_id IN (:ids)`,
        { ids }
    );

    return ids;
}

/**
 * Takes the picture away from an observation, so it has none at all (#118 R12).
 *
 * Deleting the row rather than failing it, because *no record* is the state a
 * legacy observation nobody has asked about is really in -- and the commit route
 * must treat "never asked for" and "asked for and not arrived" the same way. A
 * separate test covers the `queued` case.
 *
 * @param {number} observationId - Which observation.
 * @returns {Promise<void>}
 */
async function removeImagery(observationId) {
    await q(
        'DELETE FROM observation_thumbnails WHERE observation_id = :observationId',
        { observationId }
    );
}

/**
 * The page entry for one observation, at its live version.
 *
 * The endpoint requires the version the reviewer saw, so a test that wants a
 * clean commit has to read it first — exactly as the client reads it off the
 * mosaic row.
 *
 * @param {number} observationId - Which observation.
 * @returns {Promise<Object>} `{observation_id, version}`.
 */
async function at(observationId) {
    const [row] = await q(
        'SELECT observation_id, version FROM observations WHERE observation_id = :observationId',
        { observationId }
    );

    return { observation_id: row.observation_id, version: row.version };
}

/**
 * The log rows for one observation, oldest first.
 *
 * @param {number} observationId - Which observation.
 * @returns {Promise<Array<Object>>} The decisions.
 */
function logFor(observationId) {
    return q(
        `SELECT review_id, purpose, decision, reason, reviewer_id, observation_version,
                reviewed_keyframe_count, reviewed_keyframe_max_updated_at,
                representative_keyframe_id, decided_at
           FROM observation_reviews
          WHERE observation_id = :observationId
          ORDER BY decided_at, review_id`,
        { observationId }
    );
}

/**
 * The projection rows for one observation.
 *
 * @param {number} observationId - Which observation.
 * @returns {Promise<Array<Object>>} The current decisions.
 */
function currentFor(observationId) {
    return q(
        `SELECT purpose, decision, reason, reviewer_id, decided_at,
                observation_version
           FROM observation_review_current
          WHERE observation_id = :observationId
          ORDER BY purpose`,
        { observationId }
    );
}

/**
 * The projection and its derivation, for this run's observations only.
 *
 * Scoped to the seeded ids because the database is shared: an unscoped comparison
 * would be asserting something about everybody else's rows too, and would fail on
 * drift this suite did not cause.
 *
 * @returns {Promise<{projection: Array<Object>, derivation: Array<Object>}>} Both sides.
 */
async function bothSides() {
    const columns = `review_id, observation_id, purpose, decision, reason,
                     reviewer_id, decided_at, observation_version`;

    const normalize = (row) => {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            out[key] = value instanceof Date ? value.toISOString() : value;
        }
        return out;
    };

    const ids = seeded.observationIds;

    const projection = await q(
        `SELECT ${columns} FROM observation_review_current
          WHERE observation_id IN (:ids)
          ORDER BY observation_id, purpose`,
        { ids }
    );

    // The newline after the block matters: its last line is a SQL comment, and
    // without one the closing paren is commented out.
    const derivation = await q(
        `SELECT * FROM (${derivationBlock}\n) derived
          WHERE observation_id IN (:ids)
          ORDER BY observation_id, purpose`,
        { ids }
    );

    return { projection: projection.map(normalize), derivation: derivation.map(normalize) };
}

/**
 * Creates an active user holding exactly the named permissions, and logs it in.
 *
 * The global fixture agent holds every permission, which is right for testing what
 * a route does and useless for testing who may call it.
 *
 * @param {string} label - Distinguishes the fixture.
 * @param {Array<string>} permissionKeys - Permissions to grant. May be empty.
 * @returns {Promise<{agent: Object, userId: number}>} The logged-in agent and its user id.
 */
async function reviewerAgent(label, permissionKeys) {
    const username = `jest-commit-${label}-${runId}`;
    const password = `pw-${label}-${runId}`;

    const user = await db.users.create({ name: username, username, status: 'active' });

    seeded.userIds.push(user.user_id);

    await db.auth_identities.create({
        user_id: user.user_id,
        provider: 'local',
        provider_subject: null,
        password_hash: await argon2.hash(password),
    });

    for (const key of permissionKeys) {
        const permission = await db.permissions.findOne({ where: { key } });

        await db.user_permissions.create({
            user_id: user.user_id,
            permission_id: permission.permission_id,
            granted_by_user_id: null,
        });
    }

    const agent = request.agent(app);
    const login = await agent.post('/api/v2/auth/login').send({ username, password });

    if (login.status !== 200) {
        throw new Error(`Fixture login failed for ${username}: ${JSON.stringify(login.body)}`);
    }

    return { agent, userId: user.user_id };
}

/** Ids in an outcome array, sorted, so an assertion is about membership not order. */
const idsIn = (entries) => entries.map((entry) => entry.observation_id).sort((a, b) => a - b);

describe('the mosaic page commit (#106)', () => {

    /** A caller holding nothing at all. @type {Object} */
    let outsider;

    /** Reviewer A: `observations:write` and nothing else. @type {Object} */
    let alice;

    /** Reviewer B, the second claimant. @type {Object} */
    let bob;

    /** A raw bearer token holding `observations:write`. @type {string} */
    let serviceToken;

    beforeAll(async () => {
        const [project] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Commit Project ${runId}` }
        );

        seeded.projectId = project.project_id;

        const [session] = await q(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, 1, :dive, 'L1', 'LID1', 'JestFish', NOW(), NOW())
             RETURNING session_id`,
            { projectId: seeded.projectId, dive: `JEST-COMMIT-${runId}` }
        );

        seeded.sessionId = session.session_id;

        const [dataset] = await q(
            `INSERT INTO datasets (name, created_at, updated_at)
             VALUES (:name, NOW(), NOW()) RETURNING id`,
            { name: `Jest Commit Dataset ${runId}` }
        );

        seeded.datasetId = dataset.id;

        outsider = (await reviewerAgent('outsider', [])).agent;

        const a = await reviewerAgent('alice', ['observations:write']);
        const b = await reviewerAgent('bob', ['observations:write']);

        alice = a.agent;
        alice.userId = a.userId;
        bob = b.agent;
        bob.userId = b.userId;

        // A bearer token holding exactly the permission the routes require, so
        // the 403 it gets is about being a service client and not about the key.
        const application = await global.api.post('/api/v2/apps').send({
            name: `Jest Commit App ${runId}`,
            description: 'Created by tests/mosaic-commit.test.js.',
        });

        seeded.appId = application.body.service_client_id;

        const token = await global.api.post('/api/v2/tokens').send({
            serviceClientId: seeded.appId,
        });

        serviceToken = token.body.rawToken;

        await global.api.put(`/api/v2/tokens/${token.body.service_token_id}/permissions`).send({
            permissionKeys: ['observations:write'],
        });
    }, 120000);

    afterAll(async () => {
        const ids = seeded.observationIds;

        if (ids.length) {
            await db.sequelize.query('DELETE FROM dataset_observations WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM keyframes WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_review_current WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_reviews WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids } });
        }

        if (seeded.datasetId) {
            await db.sequelize.query('DELETE FROM datasets WHERE id = :id', { replacements: { id: seeded.datasetId } });
        }

        if (seeded.sessionId) {
            await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', { replacements: { id: seeded.sessionId } });
        }

        if (seeded.projectId) {
            await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
        }

        if (seeded.appId) {
            // Tokens and their grants reference the application, so they go first.
            const tokens = await db.service_tokens.findAll({ where: { service_client_id: seeded.appId } });

            for (const token of tokens) {
                await db.service_token_permissions.destroy({ where: { service_token_id: token.service_token_id } });
            }

            await db.service_tokens.destroy({ where: { service_client_id: seeded.appId } });
            await db.service_clients.destroy({ where: { service_client_id: seeded.appId } });
        }

        for (const userId of seeded.userIds) {
            await db.user_permissions.destroy({ where: { user_id: userId } });
            await db.auth_identities.destroy({ where: { user_id: userId } });
            await db.users.destroy({ where: { user_id: userId } });
        }

        // The trap the last agent left behind: cleanup that ran but removed
        // nothing. Counting afterwards is what makes it a fact.
        const [left] = await q(
            `SELECT count(*)::int AS n FROM observations
               WHERE comname = :comname`,
            { comname: `Jest Commit ${runId}` }
        );

        if (left.n !== 0) {
            throw new Error(`Cleanup left ${left.n} observations behind for run ${runId}.`);
        }
    }, 120000);

    describe('the routes (R1, R9, D5)', () => {

        it('are served under /api/v2/ and nowhere else', async () => {
            const [one] = await addObservations(1);
            const page = { observations: [await at(one)] };

            const review = await alice.post(REVIEW).send(page);
            const training = await alice.post(TRAINING).send(page);
            const remove = await alice.post(DELETE).send(page);

            expect(review.status).toBe(200);
            expect(training.status).toBe(200);
            expect(remove.status).toBe(200);

            // The declared path is not registered at all -- the prefix was
            // derived by `registerVersionedRoute`, not written by hand beside it,
            // which would have got the URL and lost the permission wrapper.
            const declared = await alice.post(DECLARED_REVIEW).send(page);

            expect(declared.status).toBe(404);
        });

        it('require observations:write, and seed no new permission key', async () => {
            const [one] = await addObservations(1);
            const page = { observations: [await at(one)] };

            for (const route of [REVIEW, TRAINING, DELETE]) {
                const refused = await outsider.post(route).send(page);

                expect(refused.status).toBe(403);
            }

            // Alice holds `observations:write` and nothing else, and that is
            // enough for all three.
            expect((await alice.post(REVIEW).send(page)).status).toBe(200);

            const keys = (await db.permissions.findAll()).map((row) => row.key);

            expect(keys.filter((key) => /mosaic|review|delete/i.test(key))).toEqual([]);
        });
    });

    describe('a service token is refused before any write (D4)', () => {

        it('answers 403 on all three routes and writes nothing', async () => {
            const [one] = await addObservations(1);
            const page = { observations: [await at(one)], marks: [{ observation_id: one }] };

            for (const route of [REVIEW, TRAINING, DELETE]) {
                const res = await request(app)
                    .post(route)
                    .set('Authorization', `Bearer ${serviceToken}`)
                    .send(page);

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe('FORBIDDEN');
            }

            // Nothing recorded, and -- the one that matters -- the observation
            // the token asked to destroy is still there.
            expect(await logFor(one)).toEqual([]);
            expect(await currentFor(one)).toEqual([]);

            const [still] = await q(
                'SELECT count(*)::int AS n FROM observations WHERE observation_id = :one',
                { one }
            );

            expect(still.n).toBe(1);
        });
    });

    describe('imagery, and what may be accepted blind (#118 R12)', () => {

        // Phase 6 gave the server a thumbnail state, so it can now make an
        // imagery judgement -- and these tests can now fail, which is why the
        // predecessor comment on SKIP_NOT_FOUND said none was written.

        it('skips an unmarked row with no thumbnail record at all, with reason no-imagery', async () => {
            const [a] = await addObservations(1);

            await removeImagery(a);

            const res = await alice.post(REVIEW).send({ observations: [await at(a)] });

            expect(res.status).toBe(200);
            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'no-imagery' }]);
            expect(res.body.reviewed).toEqual([]);

            // Nothing was written: a skip is not a quiet acceptance.
            expect(await logFor(a)).toEqual([]);
            expect(await currentFor(a)).toEqual([]);
        });

        it('skips an unmarked row whose thumbnail is still queued', async () => {
            const [a] = await addObservations(1);

            await q(
                `UPDATE observation_thumbnails
                    SET status = 'queued', filename = NULL
                  WHERE observation_id = :a`,
                { a }
            );

            const res = await alice.post(REVIEW).send({ observations: [await at(a)] });

            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'no-imagery' }]);
            expect(await logFor(a)).toEqual([]);
        });

        it('skips an unmarked row whose thumbnail failed permanently', async () => {
            const [a] = await addObservations(1);

            await q(
                `UPDATE observation_thumbnails
                    SET status = 'failed', permanent = true, filename = NULL,
                        last_error = 'The observation has no keyframes.'
                  WHERE observation_id = :a`,
                { a }
            );

            const res = await alice.post(REVIEW).send({ observations: [await at(a)] });

            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'no-imagery' }]);
        });

        it('commits a MARKED row with no picture, because flagging needs no imagery', async () => {
            // F15: accepting needs imagery, flagging does not. A reviewer must be
            // able to flag a tile precisely *because* it has no picture.
            const [a] = await addObservations(1);

            await removeImagery(a);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'No imagery' }],
            });

            expect(res.body.flagged).toEqual([{ observation_id: a, outcome: 'flagged' }]);
            expect(res.body.skipped).toEqual([]);

            const current = await currentFor(a);

            expect(current).toHaveLength(1);
            expect(current[0].decision).toBe('flagged');
        });

        it('withdraws a decision from a row with no picture', async () => {
            // A withdrawal is a take-back rather than an acceptance, so imagery
            // has nothing to say about it. Without this the reviewer could flag a
            // pictureless tile and then never undo it.
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'No imagery' }],
            });

            await removeImagery(a);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                withdraw: [a],
            });

            expect(res.body.reverted).toEqual([{ observation_id: a, outcome: 'withdrawn' }]);
            expect(res.body.skipped).toEqual([]);
            expect(await currentFor(a)).toEqual([]);
        });

        it('applies the same rule on the training route', async () => {
            const [a] = await addObservations(1);

            await removeImagery(a);

            const res = await alice.post(TRAINING).send({ observations: [await at(a)] });

            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'no-imagery' }]);
            expect(res.body.reviewed).toEqual([]);
        });

        it('leaves the delete route alone, because it never touches an unmarked row', async () => {
            const [doomed, spared] = await addObservations(2);

            await removeImagery(doomed);
            await removeImagery(spared);

            const res = await alice.post(DELETE).send({
                observations: [await at(doomed), await at(spared)],
                marks: [{ observation_id: doomed }],
            });

            expect(res.status).toBe(200);
            expect(res.body.reviewed).toEqual([{ observation_id: doomed, outcome: 'deleted' }]);
            expect(res.body.skipped).toEqual([]);

            const [gone] = await q(
                'SELECT count(*)::int AS n FROM observations WHERE observation_id = :doomed',
                { doomed }
            );

            expect(gone.n).toBe(0);
        });

        it('divides one page between accepted, flagged and skipped', async () => {
            // The realistic shape: a page where some tiles have pictures and some
            // do not, committed in one request. Per-observation atomicity means
            // the ones with pictures still land.
            const [withPicture, marked, without] = await addObservations(3);

            await removeImagery(without);

            const res = await alice.post(REVIEW).send({
                observations: [await at(withPicture), await at(marked), await at(without)],
                marks: [{ observation_id: marked, reason: 'Wrong species' }],
            });

            expect(res.body.reviewed).toEqual([{ observation_id: withPicture, outcome: 'reviewed' }]);
            expect(res.body.flagged).toEqual([{ observation_id: marked, outcome: 'flagged' }]);
            expect(res.body.skipped).toEqual([{ observation_id: without, reason: 'no-imagery' }]);
        });
    });

    describe('the page commit (R2, R3, R5, R6)', () => {

        it('accepts what is unmarked and flags what is marked', async () => {
            const [a, b, c] = await addObservations(3);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a), await at(b), await at(c)],
                marks: [{ observation_id: b, reason: 'Wrong species' }],
            });

            expect(res.status).toBe(200);
            expect(res.body.atomicity).toBe('per-observation');
            expect(idsIn(res.body.reviewed)).toEqual([a, c].sort((x, y) => x - y));
            expect(res.body.reviewed.every((entry) => entry.outcome === 'reviewed')).toBe(true);
            expect(res.body.flagged).toEqual([{ observation_id: b, outcome: 'flagged' }]);
            expect(res.body.skipped).toEqual([]);
            expect(res.body.conflicted).toEqual([]);
            // Nothing was accepted before, so nothing was taken back.
            expect(res.body.reverted).toEqual([]);
            expect(typeof res.body.committedAt).toBe('string');

            const current = await currentFor(b);

            expect(current).toHaveLength(1);
            expect(current[0].decision).toBe('flagged');
            expect(current[0].reason).toBe('Wrong species');
            expect(current[0].reviewer_id).toBe(alice.userId);
        });

        it('keys every entry by observation_id, never by id or by position', async () => {
            const [a] = await addObservations(1);

            const res = await alice.post(REVIEW).send({ observations: [await at(a)] });

            expect(res.body.reviewed[0]).toEqual({ observation_id: a, outcome: 'reviewed' });
            expect(res.body.reviewed[0]).not.toHaveProperty('id');
        });

        it('promotes on the training route and leaves the scientific decision alone', async () => {
            const [a, b] = await addObservations(2);

            await alice.post(REVIEW).send({ observations: [await at(a), await at(b)] });

            const res = await alice.post(TRAINING).send({
                observations: [await at(a), await at(b)],
                marks: [{ observation_id: b, reason: 'Occluded' }],
            });

            expect(res.status).toBe(200);
            expect(res.body.reviewed).toEqual([{ observation_id: a, outcome: 'promoted' }]);
            expect(res.body.flagged).toEqual([{ observation_id: b, outcome: 'excluded' }]);

            const current = await currentFor(b);

            expect(current.map((row) => [row.purpose, row.decision])).toEqual([
                ['scientific', 'reviewed'],
                ['training', 'excluded'],
            ]);
        });

        it('reports a flag that takes back an acceptance in flagged and reverted both', async () => {
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({ observations: [await at(a)] });

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'False detection' }],
            });

            // The same entry in two arrays. The five arrays are not a partition,
            // and the fixture does exactly this (`data.js:769`).
            expect(res.body.flagged).toEqual([{ observation_id: a, outcome: 'flagged' }]);
            expect(res.body.reverted).toEqual([{ observation_id: a, outcome: 'flagged' }]);
        });

        it('skips an id that is no longer an observation, and skips it for that reason only', async () => {
            const [a] = await addObservations(1);
            const page = [await at(a)];

            await db.sequelize.query('DELETE FROM observations WHERE observation_id = :a', { replacements: { a } });

            const res = await alice.post(REVIEW).send({ observations: page });

            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'not-found' }]);
            expect(res.body.reviewed).toEqual([]);
            expect(res.body.conflicted).toEqual([]);
        });
    });

    describe('a mark carries a kind, and accept is the new one (#126 A5)', () => {

        it('accepts only the marked when every observation in the request is marked', async () => {
            // How the client's main button commits a selection without a new field:
            // `observations` is the set the commit is about, so naming only the marked
            // rows means nothing else is read, accepted or changed. The other two
            // observations here are the page the reviewer was looking at and did not
            // touch, and the point is that this request cannot reach them.
            const [a, b, c] = await addObservations(3);

            const res = await alice.post(REVIEW).send({
                observations: [await at(b)],
                marks: [{ observation_id: b, kind: 'accept' }],
            });

            expect(res.status).toBe(200);
            expect(res.body.reviewed).toEqual([{ observation_id: b, outcome: 'reviewed' }]);
            expect(res.body.flagged).toEqual([]);

            expect(await currentFor(a)).toEqual([]);
            expect(await currentFor(c)).toEqual([]);
            expect((await currentFor(b))[0].decision).toBe('reviewed');
        });

        it('records an accept mark as reviewed and an except mark as flagged, in one request', async () => {
            const [a, b] = await addObservations(2);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a), await at(b)],
                marks: [
                    { observation_id: a, kind: 'accept' },
                    { observation_id: b, kind: 'except', reason: 'Duplicate' },
                ],
            });

            expect(res.status).toBe(200);
            expect(res.body.reviewed).toEqual([{ observation_id: a, outcome: 'reviewed' }]);
            expect(res.body.flagged).toEqual([{ observation_id: b, outcome: 'flagged' }]);
            expect((await currentFor(b))[0].reason).toBe('Duplicate');
            expect((await currentFor(a))[0].reason).toBeNull();
        });

        it('promotes an accept mark on the training route', async () => {
            const [a, b] = await addObservations(2);

            const res = await alice.post(TRAINING).send({
                observations: [await at(a), await at(b)],
                marks: [
                    { observation_id: a, kind: 'accept' },
                    { observation_id: b, kind: 'except', reason: 'Occluded' },
                ],
            });

            expect(res.body.reviewed).toEqual([{ observation_id: a, outcome: 'promoted' }]);
            expect(res.body.flagged).toEqual([{ observation_id: b, outcome: 'excluded' }]);
        });

        it('reads a mark with no kind as the exception, which is what every mark meant before', async () => {
            // The compatibility this rests on. A client that has not been told about
            // kinds sends `{observation_id, reason}` and must still flag.
            const [a, b] = await addObservations(2);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a), await at(b)],
                marks: [{ observation_id: b, reason: 'Duplicate' }],
            });

            expect(res.body.flagged).toEqual([{ observation_id: b, outcome: 'flagged' }]);
            expect(idsIn(res.body.reviewed)).toEqual([a]);
        });

        it('skips an accept mark on a row with no imagery, rather than accepting it blind', async () => {
            // The client refuses this mark at click time (#126 A4). This is the same
            // rule at the end that has to hold: accepting is a reviewer saying "this is
            // right" about a picture they were never shown, and a mark cannot make that
            // true. Flagging the same row still works, which is the older rule.
            const [a] = await addObservations(1);

            await removeImagery(a);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, kind: 'accept' }],
            });

            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'no-imagery' }]);
            expect(res.body.reviewed).toEqual([]);
            expect(await currentFor(a)).toEqual([]);
        });

        it('still flags a row with no imagery when the mark is the exception', async () => {
            const [a] = await addObservations(1);

            await removeImagery(a);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, kind: 'except', reason: 'No imagery' }],
            });

            expect(res.body.flagged).toEqual([{ observation_id: a, outcome: 'flagged' }]);
            expect((await currentFor(a))[0].decision).toBe('flagged');
        });

        it('refuses an accept mark on the delete route, which has no accepted state', async () => {
            const [a] = await addObservations(1);

            const res = await alice.post(DELETE).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, kind: 'accept' }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/records no acceptance/);
            // Refused before any write, so the observation is still there.
            const rows = await q(
                'SELECT observation_id FROM observations WHERE observation_id = :a', { a }
            );

            expect(rows).toHaveLength(1);
        });

        it('refuses a reason on an accept mark, because a reason says what is wrong', async () => {
            const [a] = await addObservations(1);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, kind: 'accept', reason: 'Wrong species' }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/only an exception takes one/);
            expect(await currentFor(a)).toEqual([]);
        });

        it('refuses a kind it does not recognise rather than guessing at it', async () => {
            const [a] = await addObservations(1);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, kind: 'maybe' }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/is not a kind of mark/);
            expect(await currentFor(a)).toEqual([]);
        });

        it('lets an accept mark take back a flag, and reports nothing as reverted', async () => {
            // `reverted` means an *acceptance* was taken back. The other direction is an
            // ordinary acceptance replacing a flag, under last-write-wins.
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'Duplicate' }],
            });

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, kind: 'accept' }],
            });

            expect(res.body.reviewed).toEqual([{ observation_id: a, outcome: 'reviewed' }]);
            expect(res.body.reverted).toEqual([]);
            const current = (await currentFor(a))[0];

            expect(current.decision).toBe('reviewed');
            expect(current.reason).toBeNull();
        });
    });

    describe('the request is refused rather than guessed at (D1, R17)', () => {

        /**
         * Posts a body and returns the response.
         *
         * @param {string} route - Which route.
         * @param {Object} body - The request body.
         * @returns {Promise<Object>} The Supertest response.
         */
        const post = (route, body) => alice.post(route).send(body);

        it('rejects an absent version rather than overwriting silently', async () => {
            const [a] = await addObservations(1);

            const res = await post(REVIEW, { observations: [{ observation_id: a }] });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/carries no version/);
        });

        it('rejects a reason outside the mode vocabulary', async () => {
            const [a] = await addObservations(1);

            const res = await post(REVIEW, {
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'because I said so' }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/not a reason this route records/);
        });

        it('rejects a training reason on the review route, because the vocabularies differ', async () => {
            const [a] = await addObservations(1);

            const res = await post(REVIEW, {
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'Occluded' }],
            });

            expect(res.status).toBe(400);
        });

        it('rejects any reason on delete, which records none', async () => {
            const [a] = await addObservations(1);

            const res = await post(DELETE, {
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'Wrong species' }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/leaves no trace/);
        });

        it('rejects a mark that is not on the page', async () => {
            const [a, b] = await addObservations(2);

            const res = await post(REVIEW, {
                observations: [await at(a)],
                marks: [{ observation_id: b }],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/not on the page/);
        });

        it('rejects a withdrawal on the delete route', async () => {
            const [a] = await addObservations(1);

            const res = await post(DELETE, {
                observations: [await at(a)],
                withdraw: [a],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/no decision to take back/);
        });

        it('rejects an observation that is both marked and withdrawn', async () => {
            const [a] = await addObservations(1);

            const res = await post(REVIEW, {
                observations: [await at(a)],
                marks: [{ observation_id: a }],
                withdraw: [a],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/both marked and withdrawn/);
        });

        it('rejects an empty page and a repeated id', async () => {
            const [a] = await addObservations(1);
            const entry = await at(a);

            expect((await post(REVIEW, { observations: [] })).status).toBe(400);
            expect((await post(REVIEW, { observations: [entry, entry] })).status).toBe(400);
        });
    });

    describe('a version conflict is reported and not recorded (D1, D2, R12)', () => {

        it('answers conflicted with reason version, and writes no log row for it', async () => {
            const [a, b] = await addObservations(2);
            const page = [await at(a), await at(b)];

            // The annotation changes underneath the fetched page. The trigger
            // moves `version`; nothing here writes it.
            await db.sequelize.query(
                'UPDATE observations SET comname = :comname WHERE observation_id = :a',
                { replacements: { comname: `Jest Commit ${runId} corrected`, a } }
            );

            const res = await alice.post(REVIEW).send({ observations: page });

            expect(res.status).toBe(200);
            expect(res.body.conflicted).toEqual([{ observation_id: a, reason: 'version' }]);
            // The rest of the page still landed. That is the whole point of
            // per-observation outcomes.
            expect(res.body.reviewed).toEqual([{ observation_id: b, outcome: 'reviewed' }]);

            // The decisive assertion: a refused decision leaves no trace in the
            // log. Logging it would make this reviewer the earliest claimant
            // under the derivation, and the next rebuild would resurrect a
            // decision the server refused.
            expect(await logFor(a)).toEqual([]);
            expect(await currentFor(a)).toEqual([]);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('conflicts a stale delete rather than destroying the row', async () => {
            const [a] = await addObservations(1);
            const stale = await at(a);

            await db.sequelize.query(
                'UPDATE observations SET confidence = 0.9 WHERE observation_id = :a',
                { replacements: { a } }
            );

            const res = await alice.post(DELETE).send({
                observations: [stale],
                marks: [{ observation_id: a }],
            });

            expect(res.body.conflicted).toEqual([{ observation_id: a, reason: 'version' }]);
            expect(res.body.reviewed).toEqual([]);

            const [still] = await q(
                'SELECT count(*)::int AS n FROM observations WHERE observation_id = :a',
                { a }
            );

            expect(still.n).toBe(1);
        });
    });

    describe('the last commit wins (R11, R13)', () => {

        it('gives the record to the second reviewer, and keeps the first in the log', async () => {
            const [a] = await addObservations(1);
            const page = { observations: [await at(a)] };

            const first = await alice.post(REVIEW).send(page);

            expect(first.body.reviewed).toEqual([{ observation_id: a, outcome: 'reviewed' }]);

            // Bob commits the same observation, at the same version, without
            // ever having seen Alice's decision. **He is not refused.** This
            // asserted the opposite until #111: the human settled that the last
            // commit wins, and a reviewer who wants the current state refreshes
            // and requeries rather than being locked out.
            const second = await bob.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'Wrong species' }],
            });

            expect(second.status).toBe(200);
            expect(second.body.conflicted).toEqual([]);
            expect(second.body.flagged).toEqual([{ observation_id: a, outcome: 'flagged' }]);

            const after = await currentFor(a);

            expect(after).toHaveLength(1);
            expect(after[0].reviewer_id).toBe(bob.userId);
            expect(after[0].decision).toBe('flagged');
            expect(after[0].reason).toBe('Wrong species');

            // Both decisions are in the log, in order. Alice's is superseded,
            // not erased -- the per-reviewer history is the record.
            const history = await logFor(a);

            expect(history).toHaveLength(2);
            expect(history.map((row) => [row.reviewer_id, row.decision])).toEqual([
                [alice.userId, 'reviewed'],
                [bob.userId, 'flagged'],
            ]);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('lets a reviewer revise their own decision', async () => {
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({ observations: [await at(a)] });

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'Bounding box' }],
            });

            expect(res.body.flagged).toEqual([{ observation_id: a, outcome: 'flagged' }]);

            const after = (await currentFor(a))[0];

            expect(after.decision).toBe('flagged');
            expect(after.reason).toBe('Bounding box');
            expect(after.reviewer_id).toBe(alice.userId);

            // Two log rows, one projection row. What survives from the deleted
            // first_decided_at case: revising appends rather than overwrites.
            expect(await logFor(a)).toHaveLength(2);
            expect(await currentFor(a)).toHaveLength(1);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('lets two reviewers hold the two purposes independently', async () => {
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({ observations: [await at(a)] });

            const res = await bob.post(TRAINING).send({ observations: [await at(a)] });

            expect(res.body.reviewed).toEqual([{ observation_id: a, outcome: 'promoted' }]);

            const current = await currentFor(a);

            expect(current.map((row) => [row.purpose, row.reviewer_id])).toEqual([
                ['scientific', alice.userId],
                ['training', bob.userId],
            ]);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('lands both commits when two arrive together, and the projection holds one of them', async () => {
            const [a] = await addObservations(1);
            const page = { observations: [await at(a)] };

            // Both requests are in flight before either has finished. Still
            // meaningless anywhere but against the real database, and still the
            // case #68 calls out -- but **what it proves changed with the rule**.
            // It used to assert that one was refused. Under last-write-wins
            // neither is, and what has to hold instead is that concurrency
            // leaves a *consistent* end state.
            const [one, two] = await Promise.all([
                alice.post(REVIEW).send(page),
                bob.post(REVIEW).send({
                    observations: page.observations,
                    marks: [{ observation_id: a, reason: 'Duplicate' }],
                }),
            ]);

            expect(one.status).toBe(200);
            expect(two.status).toBe(200);

            // Nobody is refused for being second.
            expect(one.body.conflicted).toEqual([]);
            expect(two.body.conflicted).toEqual([]);

            const landed = [one, two].filter((res) => res.body.reviewed.length || res.body.flagged.length);

            expect(landed).toHaveLength(2);

            // Both decisions are history; exactly one is current.
            const history = await logFor(a);

            expect(history).toHaveLength(2);
            expect(new Set(history.map((row) => row.reviewer_id)))
                .toEqual(new Set([alice.userId, bob.userId]));

            const current = await currentFor(a);

            expect(current).toHaveLength(1);

            // The projection points at a real log row and agrees with it about
            // who decided -- the invariant that would break if the unconditional
            // upsert and the log insert ever raced apart. **This deliberately
            // does not assert which reviewer won**: under last-write-wins that
            // is genuinely undetermined, and asserting it would be flaky rather
            // than strict.
            const winner = history.find((row) => row.reviewer_id === current[0].reviewer_id);

            expect(winner).toBeDefined();
            expect(current[0].decision).toBe(winner.decision);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });
    });

    describe('a withdrawal deletes the projection row and keeps the log (R14, D3)', () => {

        it('leaves no projection row and every decision', async () => {
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({ observations: [await at(a)] });
            await alice.post(REVIEW).send({
                observations: [await at(a)],
                marks: [{ observation_id: a, reason: 'No imagery' }],
            });

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                withdraw: [a],
            });

            expect(res.status).toBe(200);
            expect(res.body.reverted).toEqual([{ observation_id: a, outcome: 'withdrawn' }]);
            expect(res.body.reviewed).toEqual([]);
            expect(res.body.flagged).toEqual([]);

            // Undecided is the absence of a row: the CHECK refuses `withdrawn`
            // here outright, so a delete is the only legal expression of it.
            expect(await currentFor(a)).toEqual([]);

            // And the log still holds every decision, in order.
            const history = await logFor(a);

            expect(history.map((row) => row.decision)).toEqual(['reviewed', 'flagged', 'withdrawn']);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('lets any reviewer withdraw the decision that is current', async () => {
            const [a] = await addObservations(1);

            await alice.post(REVIEW).send({ observations: [await at(a)] });

            // Inverted by #111. This refused Bob with `claimed`, which was the
            // claim rule wearing a different hat: `releaseWithdrawn` was scoped
            // to the withdrawing reviewer. Under last-write-wins a withdrawal is
            // simply the latest decision, and anyone may make it.
            const res = await bob.post(REVIEW).send({
                observations: [await at(a)],
                withdraw: [a],
            });

            expect(res.status).toBe(200);
            expect(res.body.conflicted).toEqual([]);
            expect(res.body.reverted).toEqual([{ observation_id: a, outcome: 'withdrawn' }]);

            // Undecided is the absence of a row, and Alice's decision stays in
            // the log beside Bob's withdrawal.
            expect(await currentFor(a)).toEqual([]);

            const history = await logFor(a);

            expect(history.map((row) => [row.reviewer_id, row.decision])).toEqual([
                [alice.userId, 'reviewed'],
                [bob.userId, 'withdrawn'],
            ]);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('is a no-op with no log row when there is nothing to withdraw', async () => {
            const [a] = await addObservations(1);

            const res = await alice.post(REVIEW).send({
                observations: [await at(a)],
                withdraw: [a],
            });

            expect(res.body.reverted).toEqual([{ observation_id: a, outcome: 'withdrawn' }]);

            // Deliberately nothing: logging it would make this reviewer the
            // earliest claimant of an observation nobody has decided, and lock
            // every other reviewer out of it under the derivation.
            expect(await logFor(a)).toEqual([]);
            expect(await currentFor(a)).toEqual([]);
        });
    });

    describe('what the log row records (R15, R16)', () => {

        it('fingerprints the annotation server-side at decision time', async () => {
            const [a] = await addObservations(1);

            await db.sequelize.query(
                `INSERT INTO keyframes
                     (observation_id, subset, comname, type, framenum, x, y, width, height,
                      "createdAt", "updatedAt")
                 SELECT :a, 'train', 'Jest Keyframe', 'box', 5000 + g, 0, 0, 1, 1, NOW(), NOW()
                   FROM generate_series(1, 3) AS g`,
                { replacements: { a } }
            );

            const [maxUpdated] = await q(
                'SELECT max("updatedAt") AS m FROM keyframes WHERE observation_id = :a',
                { a }
            );

            const page = await at(a);

            await alice.post(REVIEW).send({ observations: [page] });

            const [row] = await logFor(a);

            expect(row.reviewed_keyframe_count).toBe(3);
            expect(new Date(row.reviewed_keyframe_max_updated_at).getTime())
                .toBe(new Date(maxUpdated.m).getTime());
            expect(row.observation_version).toBe(page.version);

            // Owed to Phase 6: nothing on `observations` assigns a representative
            // keyframe, and the mosaic row returns `first_framenum` rather than a
            // keyframe id, so this is recorded as unknown rather than guessed.
            expect(row.representative_keyframe_id).toBeNull();
        });

        it('does not write observations.version', async () => {
            const [a] = await addObservations(1);
            const before = await at(a);

            await alice.post(REVIEW).send({ observations: [before] });
            await alice.post(TRAINING).send({ observations: [before] });

            expect(await at(a)).toEqual(before);
        });
    });

    describe('delete (R18, R19, R20)', () => {

        it('destroys only the marked observations and their dependents', async () => {
            const [doomed, spared] = await addObservations(2);

            await db.sequelize.query(
                `INSERT INTO keyframes
                     (observation_id, subset, comname, type, framenum, x, y, width, height,
                      "createdAt", "updatedAt")
                 SELECT :doomed, 'train', 'Jest Keyframe', 'box', 6000 + g, 0, 0, 1, 1, NOW(), NOW()
                   FROM generate_series(1, 2) AS g`,
                { replacements: { doomed } }
            );

            await db.sequelize.query(
                `INSERT INTO dataset_observations
                     (dataset_id, observation_id, inclusion_type, created_at, updated_at)
                 VALUES (:datasetId, :doomed, 'train', NOW(), NOW())`,
                { replacements: { datasetId: seeded.datasetId, doomed } }
            );

            // A decision on the record, so the cascade over the review tables is
            // observable rather than vacuous.
            await alice.post(REVIEW).send({ observations: [await at(doomed)] });

            expect(await logFor(doomed)).toHaveLength(1);

            const res = await alice.post(DELETE).send({
                observations: [await at(doomed), await at(spared)],
                marks: [{ observation_id: doomed }],
            });

            expect(res.status).toBe(200);
            expect(res.body.reviewed).toEqual([{ observation_id: doomed, outcome: 'deleted' }]);
            expect(res.body.conflicted).toEqual([]);
            expect(res.body.skipped).toEqual([]);

            // R5: the unmarked id appears in no array at all.
            expect(idsIn(res.body.reviewed)).not.toContain(spared);
            expect(idsIn(res.body.flagged)).not.toContain(spared);
            expect(idsIn(res.body.reverted)).not.toContain(spared);
            expect(idsIn(res.body.skipped)).not.toContain(spared);
            expect(idsIn(res.body.conflicted)).not.toContain(spared);

            const [counts] = await q(
                `SELECT (SELECT count(*)::int FROM observations WHERE observation_id = :doomed) AS observations,
                        (SELECT count(*)::int FROM keyframes WHERE observation_id = :doomed) AS keyframes,
                        (SELECT count(*)::int FROM dataset_observations WHERE observation_id = :doomed) AS memberships,
                        (SELECT count(*)::int FROM observation_reviews WHERE observation_id = :doomed) AS reviews,
                        (SELECT count(*)::int FROM observation_review_current WHERE observation_id = :doomed) AS current,
                        (SELECT count(*)::int FROM observations WHERE observation_id = :spared) AS spared,
                        (SELECT count(*)::int FROM datasets WHERE id = :datasetId) AS datasets,
                        (SELECT count(*)::int FROM sessions WHERE session_id = :sessionId) AS sessions,
                        (SELECT count(*)::int FROM projects WHERE project_id = :projectId) AS projects`,
                {
                    doomed,
                    spared,
                    datasetId: seeded.datasetId,
                    sessionId: seeded.sessionId,
                    projectId: seeded.projectId,
                }
            );

            // Gone, with everything that hung off it.
            expect(counts.observations).toBe(0);
            expect(counts.keyframes).toBe(0);
            expect(counts.reviews).toBe(0);
            expect(counts.current).toBe(0);
            // The membership row goes and the dataset does not. #103's D3,
            // settled CASCADE so a delete is never blocked -- which means a
            // delete silently removes training-set membership.
            expect(counts.memberships).toBe(0);
            expect(counts.datasets).toBe(1);
            // And no parent is touched.
            expect(counts.spared).toBe(1);
            expect(counts.sessions).toBe(1);
            expect(counts.projects).toBe(1);

            const sides = await bothSides();

            expect(sides.projection).toEqual(sides.derivation);
        });

        it('skips an id that has already gone', async () => {
            const [a] = await addObservations(1);
            const page = await at(a);

            await db.sequelize.query('DELETE FROM observations WHERE observation_id = :a', { replacements: { a } });

            const res = await alice.post(DELETE).send({
                observations: [page],
                marks: [{ observation_id: a }],
            });

            expect(res.body.skipped).toEqual([{ observation_id: a, reason: 'not-found' }]);
            expect(res.body.reviewed).toEqual([]);
        });

        it('deletes nothing when nothing is marked', async () => {
            const [a] = await addObservations(1);

            const res = await alice.post(DELETE).send({ observations: [await at(a)] });

            expect(res.status).toBe(200);
            expect(res.body.reviewed).toEqual([]);
            expect(res.body.skipped).toEqual([]);
            expect(res.body.conflicted).toEqual([]);

            const [still] = await q(
                'SELECT count(*)::int AS n FROM observations WHERE observation_id = :a',
                { a }
            );

            expect(still.n).toBe(1);
        });
    });

    describe('the log is append-only by construction (D6)', () => {

        it('emits no UPDATE or DELETE against observation_reviews', () => {
            const source = fs.readFileSync(COMMIT_REPOSITORY, 'utf8');

            // No trigger enforces this and none should: the table's foreign key
            // to `observations` is ON DELETE CASCADE and #68's permanent delete
            // depends on it, so "nothing is ever deleted" is already false by
            // design. What can be checked for free is that this write path never
            // does either itself -- and this fails the moment somebody adds one.
            expect(source).not.toMatch(/UPDATE\s+observation_reviews/i);
            expect(source).not.toMatch(/DELETE\s+FROM\s+observation_reviews/i);
        });
    });
});
