/**
 * Tests for the mosaic species-correction endpoint (#111).
 *
 * Phase 7 of #68. Three tiers, and which one a requirement lands in is the
 * decision that matters:
 *
 * - **`http+db`** — Supertest through the real Express app against the real
 *   development PostgreSQL. Rows are seeded **committed**, not in a rolled-back
 *   transaction, because an HTTP request cannot see an uncommitted one.
 * - **`db`** — reads straight against `observations`, `observation_reviews` and
 *   `observation_review_current` after a request went through the endpoint. This
 *   is the only tier that can see what was *not* written, which is half of what
 *   this phase is about: a refused correction must leave nothing behind.
 * - **`source`** — one assertion that the four mosaic write routes each read
 *   their own permission constant, which is #68's *Authorization* obligation and
 *   is a property of the text rather than of any response.
 *
 * **Everything is seeded, nothing is borrowed.** CI builds the baseline plus the
 * migrations and holds no observations, no sessions and no projects, so a test
 * that borrows an existing row passes here and fails there — that happened on
 * Phase 3. Species are seeded too: the 854 on a development machine come from
 * the CSV import migration, and relying on a particular one of them would be the
 * same mistake one level down.
 *
 * Refs #111.
 *
 * @fileoverview Endpoint, database and source tests for the species correction (#111).
 * @author Isaac Travers
 * @module tests/mosaic-correction
 */

const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../app');
const db = require('../model');

const { QueryTypes } = db.Sequelize;

/** Where the route actually answers. */
const CORRECT = '/api/v2/mosaic/observations/species';

/** The path it is *declared* at. Nothing should answer here. */
const DECLARED_CORRECT = '/api/mosaic/observations/species';

/** Sibling routes, for the coupling assertion. */
const REVIEW = '/api/v2/mosaic/observations/review';
const TRAINING = '/api/v2/mosaic/observations/training';

/** The two route files, read as text for the permission-coupling assertion. */
const COMMIT_ROUTES = path.join(__dirname, '..', 'routes', 'mosaic-commit.routes.js');
const CORRECTION_ROUTES = path.join(__dirname, '..', 'routes', 'mosaic-correction.routes.js');

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Everything seeded, so `afterAll` can remove exactly it. */
const seeded = {
    projectId: null,
    sessionId: null,
    observationIds: [],
    speciesIds: [],
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
 * Inserts observations and records them for cleanup.
 *
 * SQL rather than `db.observations.create`, because the model declares the key
 * without `autoIncrement` and Sequelize sends an explicit null (#62).
 *
 * @param {number} count - How many.
 * @param {number|null} [speciesId] - The species they start with, or null.
 * @returns {Promise<Array<number>>} The new ids, ascending.
 */
async function addObservations(count, speciesId = null) {
    const rows = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, taxserial, species_id,
              tc, "createdAt", "updatedAt")
         SELECT :sessionId, :projectId, 960000 + g, 0.5, :comname, 166730, :speciesId,
              '10:00:00', NOW(), NOW()
           FROM generate_series(1, :count) AS g
         RETURNING observation_id`,
        {
            sessionId: seeded.sessionId,
            projectId: seeded.projectId,
            comname: `Jest Correction ${runId}`,
            speciesId,
            count,
        }
    );

    const ids = rows.map((row) => row.observation_id).sort((a, b) => a - b);

    seeded.observationIds.push(...ids);

    return ids;
}

/**
 * The observation's whole row, for the "nothing else changed" assertion.
 *
 * @param {number} observationId - Which observation.
 * @returns {Promise<Object>} Every column this phase promises not to touch, plus the ones it does.
 */
async function observationRow(observationId) {
    const [row] = await q(
        `SELECT observation_id, version, species_id, comname, taxserial, "taxReview",
                sizereview, tc, etc, "mediaPosition", "actualPosition", frame
           FROM observations WHERE observation_id = :observationId`,
        { observationId }
    );

    return row;
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
                previous_species_id, corrected_species_id, reviewed_keyframe_count,
                reviewed_keyframe_max_updated_at, representative_keyframe_id
           FROM observation_reviews
          WHERE observation_id = :observationId
          ORDER BY review_id`,
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
        `SELECT purpose, decision, reviewer_id FROM observation_review_current
          WHERE observation_id = :observationId ORDER BY purpose`,
        { observationId }
    );
}

/**
 * Creates an active user holding exactly the named permissions, and logs it in.
 *
 * The global fixture agent holds every permission, which is right for testing
 * what a route does and useless for testing who may call it.
 *
 * @param {string} label - Distinguishes the fixture.
 * @param {Array<string>} permissionKeys - Permissions to grant. May be empty.
 * @returns {Promise<{agent: Object, userId: number}>} The logged-in agent and its user id.
 */
async function reviewerAgent(label, permissionKeys) {
    const username = `jest-correct-${label}-${runId}`;
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

describe('the mosaic species correction (#111)', () => {

    /** Holds `observations:write`. @type {Object} */
    let alice;

    /** A second reviewer, whose approvals get invalidated. @type {Object} */
    let bob;

    /** A third, to prove anyone may review after a correction. @type {Object} */
    let carol;

    /** A caller holding nothing at all. @type {Object} */
    let outsider;

    /** A raw bearer token holding `observations:write`. @type {string} */
    let serviceToken;

    /** Two species to correct between. @type {number} */
    let speciesFrom;
    let speciesTo;

    beforeAll(async () => {
        const [project] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Correction Project ${runId}` }
        );

        seeded.projectId = project.project_id;

        const [session] = await q(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, 1, :dive, 'L1', 'LID1', 'JestFish', NOW(), NOW())
             RETURNING session_id`,
            { projectId: seeded.projectId, dive: `JEST-CORRECT-${runId}` }
        );

        seeded.sessionId = session.session_id;

        // Seeded rather than borrowed: CI has no species beyond what the import
        // migration creates, and depending on a particular catalogue entry is
        // the same failure class one level down.
        const species = await q(
            `INSERT INTO species (taxserial, comname, species, created_at, updated_at)
             SELECT 991000000 + g, :comname || g, :scientific || g, NOW(), NOW()
               FROM generate_series(1, 2) AS g
             RETURNING id`,
            {
                comname: `Jest Correction Fish ${runId}-`,
                scientific: `Jestus correctus ${runId}-`,
            }
        );

        seeded.speciesIds = species.map((s) => s.id);
        [speciesFrom, speciesTo] = seeded.speciesIds;

        const a = await reviewerAgent('alice', ['observations:write']);
        const b = await reviewerAgent('bob', ['observations:write']);
        const c = await reviewerAgent('carol', ['observations:write']);

        alice = a.agent;
        alice.userId = a.userId;
        bob = b.agent;
        bob.userId = b.userId;
        carol = c.agent;
        carol.userId = c.userId;

        outsider = (await reviewerAgent('outsider', [])).agent;

        // A bearer token holding exactly the permission the route requires, so
        // the 403 it gets is provably about being a service client and not about
        // the key.
        const application = await global.api.post('/api/v2/apps').send({
            name: `Jest Correction App ${runId}`,
            description: 'Created by tests/mosaic-correction.test.js.',
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
            await db.sequelize.query('DELETE FROM keyframes WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_review_current WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_reviews WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids } });
        }

        if (seeded.sessionId) {
            await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', { replacements: { id: seeded.sessionId } });
        }

        if (seeded.projectId) {
            await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
        }

        if (seeded.appId) {
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

        // The species go last: the log rows that reference them are RESTRICT, so
        // this fails loudly if an observation_reviews row survived above.
        if (seeded.speciesIds.length) {
            await db.sequelize.query('DELETE FROM species WHERE id IN (:ids)', {
                replacements: { ids: seeded.speciesIds },
            });
        }

        // A cleanup that ran but removed nothing looks exactly like one that
        // worked. Counting afterwards is what makes it a fact.
        const [left] = await q(
            'SELECT count(*)::int AS n FROM observations WHERE comname = :comname',
            { comname: `Jest Correction ${runId}` }
        );

        if (left.n !== 0) {
            throw new Error(`Cleanup left ${left.n} observations behind for run ${runId}.`);
        }
    }, 120000);

    describe('the route (R1, R12)', () => {

        it('answers under /api/v2/ and nowhere else', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const { version } = await observationRow(a);

            const served = await alice.post(CORRECT)
                .send({ observation_id: a, version, species_id: speciesTo });

            expect(served.status).toBe(200);

            // The declared path is not registered at all: the prefix was derived
            // by registerVersionedRoute rather than hand-mounted beside it,
            // which would have got the URL and silently lost requirePermission.
            const declared = await alice.post(DECLARED_CORRECT)
                .send({ observation_id: a, version, species_id: speciesTo });

            expect(declared.status).toBe(404);
        });

        it('seeds no new permission key', async () => {
            const keys = (await q(
                `SELECT key FROM permissions
                  WHERE key ILIKE '%correct%' OR key ILIKE '%mosaic%' OR key ILIKE '%relabel%'`
            )).map((r) => r.key);

            expect(keys).toEqual([]);
        });

        it('gives each of the four mosaic write routes its own permission constant', () => {
            const commit = fs.readFileSync(COMMIT_ROUTES, 'utf8');
            const correction = fs.readFileSync(CORRECTION_ROUTES, 'utf8');

            // #68's *Authorization*: the operations must not be coupled in a way
            // that prevents finer permissions later, since deletion in
            // particular is likely to want its own. Four constants means
            // splitting one is a one-line change; a shared constant would make
            // it a refactor. They hold the same value today, and that is not the
            // point.
            expect(commit).toContain("const REVIEW_PERMISSION = 'observations:write'");
            expect(commit).toContain("const TRAINING_PERMISSION = 'observations:write'");
            expect(commit).toContain("const DELETE_PERMISSION = 'observations:write'");
            expect(correction).toContain("const CORRECTION_PERMISSION = 'observations:write'");

            // And each route is guarded by its own, rather than by whichever
            // constant happened to be in scope.
            expect(commit).toContain('permission: REVIEW_PERMISSION');
            expect(commit).toContain('permission: TRAINING_PERMISSION');
            expect(commit).toContain('permission: DELETE_PERMISSION');
            expect(correction).toContain('permission: CORRECTION_PERMISSION');
        });

        it('tells deniedObservationIds which operation is asking (R15)', () => {
            const commit = fs.readFileSync(COMMIT_ROUTES.replace('routes', 'repository').replace('.routes.', '.repository.'), 'utf8');
            const correction = fs.readFileSync(CORRECTION_ROUTES.replace('routes', 'repository').replace('.routes.', '.repository.'), 'utf8');

            // The named seam for the per-observation authorization #68 asks for
            // on a mixed-project request. It returns [] for every operation
            // today; the requirement is that a per-project delete rule *can* be
            // written in it, which needs the caller's identity.
            expect(commit).toContain('function deniedObservationIds(principal, observationIds, operation)');
            expect(commit).toContain("'delete')");
            expect(correction).toContain("'correct')");
        });
    });

    describe('what a correction changes, and what it must not (R2)', () => {

        it('changes species_id and nothing else on the observation', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const before = await observationRow(a);

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, version: before.version, species_id: speciesTo });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);

            const after = await observationRow(a);

            expect(after.species_id).toBe(speciesTo);

            // Asserted rather than assumed: this is #111's one irreversible
            // rule. `comname` is the label the list entry carried when the
            // annotator pressed the button, and roughly 50,000 observations
            // already disagree with what their list says today -- keeping it
            // frozen is what makes the drift auditable.
            expect(after.comname).toBe(before.comname);
            expect(after.taxserial).toBe(before.taxserial);
            expect(after.taxReview).toBe(before.taxReview);
            expect(after.sizereview).toBe(before.sizereview);
            expect(after.tc).toBe(before.tc);
            expect(after.etc).toBe(before.etc);
            expect(after.mediaPosition).toBe(before.mediaPosition);
            expect(after.actualPosition).toBe(before.actualPosition);
            expect(after.frame).toBe(before.frame);

            // The trigger moved the version, from OLD, so the client has
            // something to send next.
            expect(after.version).toBe(before.version + 1);
        });

        it('does not propagate a name to the keyframes', async () => {
            const [a] = await addObservations(1, speciesFrom);

            await db.sequelize.query(
                `INSERT INTO keyframes
                     (observation_id, subset, comname, type, framenum, x, y, width, height,
                      "createdAt", "updatedAt")
                 VALUES (:a, 'train', 'Jest Keyframe Name', 'box', 6001, 0, 0, 1, 1, NOW(), NOW())`,
                { replacements: { a } }
            );

            const { version } = await observationRow(a);

            await alice.post(CORRECT).send({ observation_id: a, version, species_id: speciesTo });

            // `updateObservation` rewrites every keyframe's comname when the
            // submitted one differs (observation.repository.js:690-712). The
            // correction must not go through it -- and `keyframes` carries no
            // species_id at all, so there is nothing there to correct.
            const [keyframe] = await q(
                'SELECT comname FROM keyframes WHERE observation_id = :a', { a }
            );

            expect(keyframe.comname).toBe('Jest Keyframe Name');
        });
    });

    describe('the log row a correction appends (R5)', () => {

        it('appends exactly one, and records what it changed', async () => {
            const [a] = await addObservations(1, speciesFrom);

            await db.sequelize.query(
                `INSERT INTO keyframes
                     (observation_id, subset, comname, type, framenum, x, y, width, height,
                      "createdAt", "updatedAt")
                 SELECT :a, 'train', 'Jest KF', 'box', 6100 + g, 0, 0, 1, 1, NOW(), NOW()
                   FROM generate_series(1, 3) AS g`,
                { replacements: { a } }
            );

            const { version } = await observationRow(a);

            await alice.post(CORRECT).send({ observation_id: a, version, species_id: speciesTo });

            const log = await logFor(a);

            expect(log).toHaveLength(1);
            expect(log[0].purpose).toBe('scientific');
            expect(log[0].decision).toBe('corrected');
            expect(log[0].reviewer_id).toBe(alice.userId);
            expect(log[0].reason).toBeNull();
            expect(log[0].previous_species_id).toBe(speciesFrom);
            expect(log[0].corrected_species_id).toBe(speciesTo);

            // The version it *applied to*, not the one the trigger produced.
            expect(log[0].observation_version).toBe(version);

            // The fingerprint is computed server-side at decision time, exactly
            // as the commit path computes it: the client is not asked for it.
            expect(log[0].reviewed_keyframe_count).toBe(3);
            expect(log[0].reviewed_keyframe_max_updated_at).not.toBeNull();

            // Owed to Phase 6 rather than guessed: neither side knows which
            // image supported the decision yet.
            expect(log[0].representative_keyframe_id).toBeNull();
        });

        it('records a null previous_species_id when the observation had none', async () => {
            const [a] = await addObservations(1, null);
            const { version } = await observationRow(a);

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, version, species_id: speciesTo });

            expect(res.body.ok).toBe(true);
            expect(res.body.previous.species_id).toBeNull();
            expect(res.body.previous.species_comname).toBeNull();

            // About 4% of production rows carry no species_id, so "the species
            // before the correction" is legitimately absent rather than unknown.
            // The column is nullable and the correction still records.
            const log = await logFor(a);

            expect(log[0].previous_species_id).toBeNull();
            expect(log[0].corrected_species_id).toBe(speciesTo);
        });

        it('reconstructs the chain across a second correction', async () => {
            const [a] = await addObservations(1, speciesFrom);

            const first = await observationRow(a);
            await alice.post(CORRECT)
                .send({ observation_id: a, version: first.version, species_id: speciesTo });

            const second = await observationRow(a);
            await alice.post(CORRECT)
                .send({ observation_id: a, version: second.version, species_id: speciesFrom });

            // Two columns rather than one: after a second correction the current
            // species is no longer what the first changed *to*, so a single
            // previous_species_id would leave this unreconstructable.
            const log = await logFor(a);

            expect(log.map((r) => [r.previous_species_id, r.corrected_species_id])).toEqual([
                [speciesFrom, speciesTo],
                [speciesTo, speciesFrom],
            ]);
        });
    });

    describe('invalidation (R8, R9)', () => {

        it('clears both purposes, whoever made the decisions, and keeps them in the log', async () => {
            const [a] = await addObservations(1, speciesFrom);

            // Alice approves the science; Bob promotes it for training. Two live
            // decisions, by two different people, neither of them the corrector.
            await alice.post(REVIEW).send({ observations: [{ observation_id: a, version: (await observationRow(a)).version }] });
            await bob.post(TRAINING).send({ observations: [{ observation_id: a, version: (await observationRow(a)).version }] });

            expect(await currentFor(a)).toHaveLength(2);

            const { version } = await observationRow(a);

            const res = await carol.post(CORRECT)
                .send({ observation_id: a, version, species_id: speciesTo });

            expect(res.body.ok).toBe(true);

            // **Both**, regardless of reviewer_id. A relabelled observation has
            // to be reapproved: a promoted training sample carrying the wrong
            // label teaches the model the wrong thing, which is worse than not
            // having the sample at all.
            expect(await currentFor(a)).toEqual([]);

            // And the audit history survives, which is the other half of the
            // requirement. Removing the decisions is not the same as erasing
            // them.
            const log = await logFor(a);

            expect(log.map((r) => [r.purpose, r.decision, r.reviewer_id])).toEqual([
                ['scientific', 'reviewed', alice.userId],
                ['training', 'promoted', bob.userId],
                ['scientific', 'corrected', carol.userId],
            ]);
        });

        it('leaves the observation reviewable by anyone, including somebody new', async () => {
            const [a] = await addObservations(1, speciesFrom);

            await alice.post(REVIEW).send({ observations: [{ observation_id: a, version: (await observationRow(a)).version }] });
            await bob.post(CORRECT)
                .send({ observation_id: a, version: (await observationRow(a)).version, species_id: speciesTo });

            // Under first-valid-review-wins this was the impossible case: Alice
            // was the earliest claimant for ever, so a corrected observation
            // could never be re-approved by anyone. It simply lands now.
            const res = await carol.post(REVIEW)
                .send({ observations: [{ observation_id: a, version: (await observationRow(a)).version }] });

            expect(res.status).toBe(200);
            expect(res.body.conflicted).toEqual([]);
            expect(res.body.reviewed).toEqual([{ observation_id: a, outcome: 'reviewed' }]);

            const current = await currentFor(a);

            expect(current).toHaveLength(1);
            expect(current[0].purpose).toBe('scientific');
            expect(current[0].reviewer_id).toBe(carol.userId);
        });

        it('never projects the corrected row itself', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const { version } = await observationRow(a);

            await alice.post(CORRECT).send({ observation_id: a, version, species_id: speciesTo });

            // An observation somebody corrected but nobody has reviewed since is
            // unreviewed, for both purposes. The projection's CHECK does not
            // name `corrected`, so a derivation that stopped excluding it would
            // fail loudly rather than paint the tile.
            expect(await currentFor(a)).toEqual([]);
            expect(await logFor(a)).toHaveLength(1);
        });
    });

    describe('what is refused, and what it writes (R3, R4, R16)', () => {

        it('refuses a stale version and writes nothing at all', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const stale = (await observationRow(a)).version;

            await db.sequelize.query(
                'UPDATE observations SET confidence = 0.9 WHERE observation_id = :a',
                { replacements: { a } }
            );

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, version: stale, species_id: speciesTo });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: false, error: 'conflicted' });

            // Three things, because a refusal that half-applied would still pass
            // a status-only assertion.
            const after = await observationRow(a);

            expect(after.species_id).toBe(speciesFrom);
            expect(await logFor(a)).toEqual([]);
            expect(await currentFor(a)).toEqual([]);
        });

        it('refuses a request carrying no version, with a 400', async () => {
            const [a] = await addObservations(1, speciesFrom);

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, species_id: speciesTo });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/carries no version/);

            expect(await logFor(a)).toEqual([]);
        });

        it('writes nothing when the correction names the species already recorded', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const before = await observationRow(a);

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, version: before.version, species_id: speciesFrom });

            expect(res.body).toEqual({ ok: false, error: 'unchanged' });

            // It would otherwise destroy live review decisions in exchange for
            // changing nothing at all.
            const after = await observationRow(a);

            expect(after.version).toBe(before.version);
            expect(await logFor(a)).toEqual([]);
        });

        it('refuses a species that does not exist, before writing anything', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const before = await observationRow(a);

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, version: before.version, species_id: 2000000001 });

            expect(res.body).toEqual({ ok: false, error: 'not-found' });

            const after = await observationRow(a);

            expect(after.species_id).toBe(speciesFrom);
            expect(after.version).toBe(before.version);
            expect(await logFor(a)).toEqual([]);
        });

        it('refuses an observation that does not exist', async () => {
            const res = await alice.post(CORRECT)
                .send({ observation_id: 2000000002, version: 1, species_id: speciesTo });

            expect(res.body).toEqual({ ok: false, error: 'not-found' });
        });

        it('returns the corrected species name as a field distinct from comname', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const before = await observationRow(a);

            const res = await alice.post(CORRECT)
                .send({ observation_id: a, version: before.version, species_id: speciesTo });

            const [to] = await q('SELECT comname FROM species WHERE id = :id', { id: speciesTo });
            const [from] = await q('SELECT comname FROM species WHERE id = :id', { id: speciesFrom });

            expect(res.body.ok).toBe(true);
            expect(res.body.observation.species_comname).toBe(to.comname);
            expect(res.body.previous.species_comname).toBe(from.comname);

            // The annotator's frozen label is returned unchanged beside it, so
            // nothing can mistake the catalogue's current name for it. Without
            // the separate field a corrected tile would show the old animal for
            // ever.
            expect(res.body.observation.comname).toBe(before.comname);
            expect(res.body.observation.species_comname).not.toBe(res.body.observation.comname);
            expect(res.body.observation.version).toBe(before.version + 1);
        });
    });

    describe('who may correct (R13, R14)', () => {

        it('refuses an anonymous caller with 401', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const { version } = await observationRow(a);

            const res = await request(app).post(CORRECT)
                .send({ observation_id: a, version, species_id: speciesTo });

            expect(res.status).toBe(401);
            expect(await logFor(a)).toEqual([]);
        });

        it('refuses a user without observations:write with 403', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const { version } = await observationRow(a);

            const res = await outsider.post(CORRECT)
                .send({ observation_id: a, version, species_id: speciesTo });

            expect(res.status).toBe(403);

            const after = await observationRow(a);

            expect(after.species_id).toBe(speciesFrom);
            expect(await logFor(a)).toEqual([]);
        });

        it('refuses a service token with 403 and writes nothing', async () => {
            const [a] = await addObservations(1, speciesFrom);
            const { version } = await observationRow(a);

            const res = await request(app).post(CORRECT)
                .set('Authorization', `Bearer ${serviceToken}`)
                .send({ observation_id: a, version, species_id: speciesTo });

            // The token holds `observations:write`, granted above, so the
            // refusal is provably about the principal rather than the key.
            // `observation_reviews.reviewer_id` references users(user_id) while
            // a bearer principal's id is a service_clients.service_client_id --
            // and both sequences start at 1, so the failure is not an error but
            // a correction silently attributed to an unrelated person in the
            // scientific record.
            expect(res.status).toBe(403);

            const after = await observationRow(a);

            expect(after.species_id).toBe(speciesFrom);
            expect(after.version).toBe(version);
            expect(await logFor(a)).toEqual([]);
        });
    });
});
