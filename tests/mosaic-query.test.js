/**
 * Tests for the mosaic page-set and status-count endpoints (#105).
 *
 * Phase 4 of #68. Two tiers, and which one a requirement lands in is the decision
 * that matters here:
 *
 * - **`http+db`** — Supertest through the real Express app against the real
 *   development PostgreSQL. Every route requires a permission, so these go through
 *   `tests/setup/authenticated-agent.js`, which leaves an agent holding every
 *   catalog permission on `global.api`. The rows are seeded **committed**, not in a
 *   rolled-back transaction, because an HTTP request cannot see an uncommitted one.
 * - **`sql`** — an assertion against the statement `buildPageSetQuery` emits. Two
 *   requirements are invisible to any test that counts returned rows on a database
 *   holding one observation: **R9**, that the keyframe aggregate stays out of the
 *   matching set, and **R7**, that a status filter is a semi-join or an anti-join
 *   rather than a `coalesce`. Both return identical answers at identical speed on
 *   one row, so the SQL is what is asserted.
 *
 * **Every question this suite asks is scoped to its own seeded rows** — by session,
 * or by the fixture ML model for the rows that deliberately have no session. The
 * database is shared and holds rows this suite did not create, so an unscoped
 * assertion about a count would pass or fail on what somebody else left behind.
 *
 * Refs #105.
 *
 * @fileoverview Endpoint and SQL tests for the mosaic query (#105).
 * @author Isaac Travers
 * @module tests/mosaic-query
 */

const argon2 = require('argon2');
const request = require('supertest');

const app = require('../app');
const db = require('../model');
const mosaic = require('../repository/mosaic.repository');

const { QueryTypes } = db.Sequelize;

/** Where the two routes actually answer. R0 is that this is `/api/v2/`. */
const PAGES = '/api/v2/mosaic/observations/pages';
const COUNTS = '/api/v2/mosaic/observations/counts';

/** The path the routes are *declared* at. Nothing should answer here. */
const DECLARED_PAGES = '/api/mosaic/observations/pages';

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Everything seeded, so `afterAll` can remove exactly it. */
const seeded = {
    projectId: null,
    modelId: null,
    sessions: {},
    observations: {},
    userIds: [],
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
 * Inserts a set of observations in **one** statement.
 *
 * One statement rather than a loop, deliberately: `NOW()` is the transaction
 * timestamp, so every row gets an identical `updatedAt` and the tie-break test has
 * something genuinely tied to break.
 *
 * @param {Array<Object>} rows - Each `{ sessionKey, projectId, obsID, confidence,
 * comname, tc, speciesId, withModel }`.
 * @returns {Promise<Array<number>>} The new observation ids, ascending.
 */
async function addObservations(rows) {
    const payload = rows.map((row) => ({
        session_id: row.sessionKey ? seeded.sessions[row.sessionKey] : null,
        project_id: row.projectId === undefined ? seeded.projectId : row.projectId,
        obsID: row.obsID,
        confidence: row.confidence === undefined ? null : row.confidence,
        comname: row.comname || `Jest Mosaic ${runId}`,
        tc: row.tc === undefined ? null : row.tc,
        species_id: row.speciesId === undefined ? null : row.speciesId,
        ml_model_id: row.withModel ? seeded.modelId : null,
    }));

    const inserted = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, tc, species_id,
              ml_model_id, "createdAt", "updatedAt")
         SELECT (r->>'session_id')::int, (r->>'project_id')::int, (r->>'obsID')::int,
                (r->>'confidence')::float8, r->>'comname', r->>'tc',
                (r->>'species_id')::int, (r->>'ml_model_id')::int, NOW(), NOW()
           FROM jsonb_array_elements(:rows::jsonb) AS r
          ORDER BY (r->>'obsID')::int
         RETURNING observation_id`,
        { rows: JSON.stringify(payload) }
    );

    const ids = inserted.map((row) => row.observation_id).sort((a, b) => a - b);

    seeded.observations[rows[0].group] = ids;

    return ids;
}

/**
 * Records a decision the way Phase 5 will: append to the log, then project it.
 *
 * The projection is what the endpoint reads (R6), and the log is the record. Going
 * through both rather than writing the projection directly keeps this suite honest
 * about the shape the endpoint will really meet.
 *
 * @param {number} observationId - Which observation.
 * @param {string} purpose - `scientific` or `training`.
 * @param {string} decision - The decision value.
 * @param {string|null} [reason] - Why, where one is recorded.
 * @returns {Promise<void>}
 */
async function decide(observationId, purpose, decision, reason = null) {
    const [review] = await q(
        `INSERT INTO observation_reviews
             (observation_id, purpose, decision, reason, reviewer_id,
              observation_version, decided_at, created_at, updated_at)
         VALUES (:observationId, :purpose, :decision, :reason, 1,
              (SELECT version FROM observations WHERE observation_id = :observationId),
              NOW(), NOW(), NOW())
         RETURNING review_id`,
        { observationId, purpose, decision, reason }
    );

    // No `first_decided_at`: it went with first-valid-review-wins in #111,
    // where it existed only to be preserved across a claiming reviewer's
    // revision. This suite is about the read path and does not care which
    // decision is current, only that one is.
    await db.sequelize.query(
        `INSERT INTO observation_review_current
             (review_id, observation_id, purpose, decision, reason,
              reviewer_id, decided_at, observation_version)
         SELECT review_id, observation_id, purpose, decision, reason,
                reviewer_id, decided_at, observation_version
           FROM observation_reviews
          WHERE review_id = :reviewId`,
        { replacements: { reviewId: review.review_id } }
    );
}

/**
 * Creates an active user holding exactly the named permissions, and logs it in.
 *
 * The global fixture agent holds every permission, which is right for testing what
 * a route does and useless for testing who may call it.
 *
 * @param {string} label - Distinguishes the fixture.
 * @param {Array<string>} permissionKeys - Permissions to grant. May be empty.
 * @returns {Promise<Object>} A logged-in Supertest agent.
 */
async function agentWith(label, permissionKeys) {
    const username = `jest-mosaic-${label}-${runId}`;
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

    return agent;
}

/** Ids in the order the endpoint returned them, across every page of a response. */
const idsOf = (body) => body.pages.flatMap((page) => page.rows.map((row) => row.observation_id));

/** The `matched` CTE only — everything before the `tally` that follows it. */
const matchedCte = (sql) => sql.slice(0, sql.indexOf('tally AS ('));

describe('the mosaic query (#105)', () => {

    /** A caller holding nothing at all. @type {Object} */
    let outsider;

    /** A caller holding `observations:read` and nothing else. @type {Object} */
    let reader;

    beforeAll(async () => {
        const [project] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Mosaic Project ${runId}` }
        );

        seeded.projectId = project.project_id;

        const [model] = await q(
            `INSERT INTO ml_models (name, model_type, status, created_at, updated_at)
             VALUES (:name, 'detector', 'archived', NOW(), NOW()) RETURNING id`,
            { name: `Jest Mosaic Model ${runId}` }
        );

        seeded.modelId = model.id;

        for (const key of ['tied', 'review', 'nulls', 'species', 'clock']) {
            const [session] = await q(
                `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
                 VALUES (:projectId, 1, :dive, 'L1', 'LID1', 'JestFish', NOW(), NOW())
                 RETURNING session_id`,
                { projectId: seeded.projectId, dive: `JEST-${key}-${runId}` }
            );

            seeded.sessions[key] = session.session_id;
        }

        // Six rows, every `confidence` and every `updatedAt` identical, so the only
        // thing that can order them is the appended tie-break.
        await addObservations(Array.from({ length: 6 }, (unused, i) => ({
            group: 'tied', sessionKey: 'tied', obsID: 900000 + i, confidence: 0.5, tc: '10:00:00',
        })));

        // Five rows with a known status distribution, one of them carrying a
        // decision in both dimensions and one carrying none at all.
        const review = await addObservations([0.1, 0.2, 0.3, 0.4, 0.5].map((confidence, i) => ({
            group: 'review', sessionKey: 'review', obsID: 910000 + i, confidence,
        })));

        await decide(review[0], 'scientific', 'reviewed');
        await decide(review[1], 'scientific', 'flagged', 'blurry');
        // review[2] carries nothing: undecided is the absence of a row.
        await decide(review[3], 'scientific', 'flagged', 'ambiguous');
        await decide(review[3], 'training', 'promoted');
        await decide(review[4], 'training', 'excluded', 'occluded');

        // The rows an inner join would drop. Scoped by the fixture model, because
        // the first of them has no session to be scoped by.
        await addObservations([
            { group: 'nulls', sessionKey: null, projectId: null, obsID: 920000, withModel: true },
            { group: 'nulls', sessionKey: 'nulls', projectId: null, obsID: 920001, withModel: true },
            { group: 'nulls', sessionKey: 'nulls', obsID: 920002, withModel: true },
        ]);

        // Two rows sharing a common name and differing in species_id. The lower
        // id is also the one with no confidence, so the default ascending sort has
        // to move it to the end -- which is what makes the nulls-last assertion
        // about the ordering rather than about the ids.
        await addObservations([
            { group: 'species', sessionKey: 'species', obsID: 930000, comname: `Jest Twin ${runId}`, speciesId: 1, confidence: null },
            { group: 'species', sessionKey: 'species', obsID: 930001, comname: `Jest Twin ${runId}`, speciesId: 2, confidence: 0.9 },
        ]);

        // A clock time, and a clock time on the second day of a dive.
        await addObservations([
            { group: 'clock', sessionKey: 'clock', obsID: 940000, tc: '21:57:22' },
            { group: 'clock', sessionKey: 'clock', obsID: 940001, tc: '1.00:15:33' },
        ]);

        // Eight keyframes on one row, three on another: enough for the duplicate
        // -row defect to show if it were there.
        await db.sequelize.query(
            `INSERT INTO keyframes
                 (observation_id, subset, comname, type, framenum, x, y, width, height,
                  "createdAt", "updatedAt")
             SELECT :first, 'train', 'Jest Keyframe', 'box', 3000 + g, 0, 0, 1, 1, NOW(), NOW()
               FROM generate_series(1, 8) AS g
              UNION ALL
             SELECT :second, 'train', 'Jest Keyframe', 'box', 4000 + g, 0, 0, 1, 1, NOW(), NOW()
               FROM generate_series(1, 3) AS g`,
            {
                replacements: {
                    first: seeded.observations.tied[0],
                    second: seeded.observations.tied[1],
                },
            }
        );

        outsider = await agentWith('outsider', []);
        reader = await agentWith('reader', ['observations:read']);
    }, 120000);

    afterAll(async () => {
        const ids = Object.values(seeded.observations).flat();

        if (ids.length) {
            await db.sequelize.query('DELETE FROM keyframes WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_review_current WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_reviews WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids } });
        }

        const sessionIds = Object.values(seeded.sessions);

        if (sessionIds.length) {
            await db.sequelize.query('DELETE FROM sessions WHERE session_id IN (:ids)', { replacements: { ids: sessionIds } });
        }

        if (seeded.modelId) {
            await db.sequelize.query('DELETE FROM ml_models WHERE id = :id', { replacements: { id: seeded.modelId } });
        }

        if (seeded.projectId) {
            await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
        }

        for (const userId of seeded.userIds) {
            await db.user_permissions.destroy({ where: { user_id: userId } });
            await db.auth_identities.destroy({ where: { user_id: userId } });
            await db.users.destroy({ where: { user_id: userId } });
        }
    }, 120000);

    /** The question that selects only the six tied rows. */
    const tiedQuestion = () => ({ filters: { session: [seeded.sessions.tied] } });

    /** The question that selects only the five review-state rows. */
    const reviewQuestion = (filters = {}) => ({
        filters: { session: [seeded.sessions.review], ...filters },
    });

    describe('the routes', () => {

        it('are served under /api/v2/ and nowhere else', async () => {
            const pages = await global.api.post(PAGES).send({ ...tiedQuestion(), pages: [1] });
            const counts = await global.api.post(COUNTS).send(tiedQuestion());

            expect(pages.status).toBe(200);
            expect(counts.status).toBe(200);

            // The path the route is *declared* at is not registered at all --
            // `registerVersionedRoute` derived the prefix, it was not written by
            // hand beside the helper, which would have got the URL and lost the
            // permission wrapper.
            const declared = await global.api.post(DECLARED_PAGES).send({ ...tiedQuestion(), pages: [1] });

            expect(declared.status).toBe(404);
        });

        it('require observations:read rather than a new permission key (R12)', async () => {
            const refusedPages = await outsider.post(PAGES).send({ ...tiedQuestion(), pages: [1] });
            const refusedCounts = await outsider.post(COUNTS).send(tiedQuestion());

            expect(refusedPages.status).toBe(403);
            expect(refusedCounts.status).toBe(403);

            const allowed = await reader.post(PAGES).send({ ...tiedQuestion(), pages: [1] });

            expect(allowed.status).toBe(200);

            // And no key was seeded for the mosaic or for review.
            const invented = await db.permissions.findAll();
            const keys = invented.map((row) => row.key);

            expect(keys.filter((key) => /mosaic|review/i.test(key))).toEqual([]);
        });
    });

    describe('the envelope (R1)', () => {

        it('returns an entry for every page asked for, ascending', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 2, pages: [3, 1, 2, 1],
            });

            expect(res.status).toBe(200);
            expect(res.body.pages.map((page) => page.page)).toEqual([1, 2, 3]);
            expect(res.body.pageSize).toBe(2);
            expect(res.body.excludedForNoDate).toBe(0);
            expect(typeof res.body.servedAt).toBe('string');
            expect(res.body.pages.map((page) => page.rowCount)).toEqual([2, 2, 2]);
        });

        it('carries total and pageCount only when includeTotal', async () => {
            const withTotal = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 2, pages: [1], includeTotal: true,
            });

            expect(withTotal.body.total).toBe(6);
            expect(withTotal.body.pageCount).toBe(3);

            const without = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 2, pages: [1],
            });

            // Absent, not null: the client tells "no total in this response" from
            // the key being missing.
            expect(Object.prototype.hasOwnProperty.call(without.body, 'total')).toBe(false);
            expect(Object.prototype.hasOwnProperty.call(without.body, 'pageCount')).toBe(false);
        });

        it('carries total for a page set entirely past the end (R1, R5)', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 2, pages: [50, 51], includeTotal: true,
            });

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(6);
            expect(res.body.pageCount).toBe(3);
            expect(res.body.pages).toEqual([
                { page: 50, rows: [], rowCount: 0 },
                { page: 51, rows: [], rowCount: 0 },
            ]);
        });

        it('takes the count from an aggregate and never from count(*) OVER ()', () => {
            const { sql } = mosaic.buildPageSetQuery({
                filters: {}, pageSize: 45, pages: [1], includeTotal: true,
            });

            expect(sql).toContain('SELECT count(*)::int AS total FROM matched');
            expect(sql).not.toContain('OVER ()');
            expect(sql).toContain('WITH matched AS MATERIALIZED');
        });
    });

    describe('deterministic ordering (R2)', () => {

        it('puts tied rows in the same order on every call', async () => {
            const ask = () => global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 2, pages: [1, 2, 3],
            });

            const first = await ask();
            const second = await ask();

            const expected = [...seeded.observations.tied].sort((a, b) => a - b);

            expect(idsOf(first.body)).toEqual(expected);
            expect(idsOf(second.body)).toEqual(expected);

            // And page membership, not only the flat order.
            expect(first.body.pages).toEqual(second.body.pages);
        });

        it('appends observation_id even when the client sorts on something else', async () => {
            // Every `updatedAt` is identical, so nothing but the tie-break can
            // order these.
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 6, pages: [1], sort: [{ field: 'updatedAt', dir: 'desc' }],
            });

            expect(idsOf(res.body)).toEqual([...seeded.observations.tied].sort((a, b) => a - b));
        });

        it('appends it exactly once, and refuses a client that names it itself', () => {
            const { sql } = mosaic.buildPageSetQuery({
                filters: {}, sort: [{ field: 'confidence', dir: 'desc' }], pageSize: 45, pages: [1],
            });

            const order = sql.slice(sql.indexOf('row_number() OVER'), sql.indexOf(') AS rn'));

            expect(order).toContain('o.confidence DESC');
            expect(order).toContain('o.observation_id ASC');
            expect(order.match(/observation_id/g)).toHaveLength(1);

            // `observation_id` is not in the closed sort list, so a client naming
            // it is a rejected request rather than a doubled term.
            expect(() => mosaic.buildPageSetQuery({
                filters: {}, sort: [{ field: 'observation_id', dir: 'asc' }], pageSize: 45, pages: [1],
            })).toThrow(mosaic.MosaicRequestError);
        });

        it('puts null confidence last on the default ascending sort', async () => {
            const [unscored, scored] = seeded.observations.species;

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessions.species] }, pageSize: 10, pages: [1], includeTotal: true,
            });

            // The unscored row has the *lower* observation_id, so ascending ids
            // would put it first. Nulls sorting last is what puts it second, and
            // that is why the first pages of the default question are the
            // lowest-confidence scored rows rather than the unscored ones.
            expect(idsOf(res.body)).toEqual([scored, unscored]);
            expect(res.body.pages[0].rows[1].confidence).toBeNull();
        });
    });

    describe('one pass over the matching set (R3, R4)', () => {

        it('returns for [1,3,5] exactly what pages 1, 3 and 5 return singly', async () => {
            const together = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 1, pages: [1, 3, 5],
            });

            const singly = [];

            for (const page of [1, 3, 5]) {
                const one = await global.api.post(PAGES).send({ ...tiedQuestion(), pageSize: 1, pages: [page] });

                singly.push(one.body.pages[0]);
            }

            expect(together.body.pages).toEqual(singly);
        });

        it('numbers a deep page from the same ordering as a shallow one', async () => {
            const all = await global.api.post(PAGES).send({ ...tiedQuestion(), pageSize: 6, pages: [1] });
            const last = await global.api.post(PAGES).send({ ...tiedQuestion(), pageSize: 1, pages: [6] });

            expect(last.body.pages[0].rows.map((row) => row.observation_id))
                .toEqual([all.body.pages[0].rows[5].observation_id]);
        });

        it('asks for one band per requested page, in one statement', () => {
            const { sql } = mosaic.buildPageSetQuery({
                filters: {}, pageSize: 45, pages: [1, 3, 9780],
            });

            expect(sql.match(/m\.rn BETWEEN/g)).toHaveLength(3);
            expect(sql.match(/WITH matched AS MATERIALIZED/g)).toHaveLength(1);
        });
    });

    describe('the cap (R5)', () => {

        it('rejects 13 pages with 400', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 1, pages: Array.from({ length: 13 }, (unused, i) => i + 1),
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('the cap is 12');
        });

        it('rejects more than 600 rows with 400', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 51, pages: Array.from({ length: 12 }, (unused, i) => i + 1),
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('the cap is 600');
        });

        it('rejects a page number that is not one', async () => {
            for (const page of [0, -1, 1.5]) {
                const res = await global.api.post(PAGES).send({ ...tiedQuestion(), pages: [page] });

                expect(res.status).toBe(400);
                expect(res.body.error.message).toContain('is not a page number');
            }
        });

        it('returns an empty page rather than an error past the end', async () => {
            const res = await global.api.post(PAGES).send({ ...tiedQuestion(), pageSize: 2, pages: [4] });

            expect(res.status).toBe(200);
            expect(res.body.pages).toEqual([{ page: 4, rows: [], rowCount: 0 }]);
        });
    });

    describe('the status filter (R6, R7, R8)', () => {

        /** The ids a status question returns, sorted, so a set can be compared. */
        async function idsFor(filters) {
            const res = await global.api.post(PAGES).send({
                ...reviewQuestion(filters), pageSize: 10, pages: [1],
            });

            expect(res.status).toBe(200);

            return idsOf(res.body).slice().sort((a, b) => a - b);
        }

        it('selects exactly the right ids for every set', async () => {
            const [reviewed, flagged, none, both, excluded] = seeded.observations.review;

            // A set excluding the absent value: a semi-join.
            expect(await idsFor({ reviewStatus: ['flagged'] })).toEqual([flagged, both].sort((a, b) => a - b));
            expect(await idsFor({ reviewStatus: ['reviewed'] })).toEqual([reviewed]);
            expect(await idsFor({ reviewStatus: ['reviewed', 'flagged'] }))
                .toEqual([reviewed, flagged, both].sort((a, b) => a - b));

            // A set including it: an anti-join over the complement. `none` and
            // `excluded` carry no scientific decision at all.
            expect(await idsFor({ reviewStatus: ['unreviewed'] }))
                .toEqual([none, excluded].sort((a, b) => a - b));

            // **The mixed set. This is the one a `coalesce` regression fails.**
            expect(await idsFor({ reviewStatus: ['unreviewed', 'flagged'] }))
                .toEqual([flagged, none, both, excluded].sort((a, b) => a - b));

            // Every value, and no value, are the same question: no filter at all.
            const everything = [...seeded.observations.review].sort((a, b) => a - b);

            expect(await idsFor({ reviewStatus: ['unreviewed', 'flagged', 'reviewed'] })).toEqual(everything);
            expect(await idsFor({ reviewStatus: [] })).toEqual(everything);
        });

        it('filters both dimensions independently', async () => {
            const [reviewed, , , both, excluded] = seeded.observations.review;

            expect(await idsFor({ trainingDisposition: ['promoted'] })).toEqual([both]);
            expect(await idsFor({ trainingDisposition: ['excluded'] })).toEqual([excluded]);

            // The row carrying a decision in both is found by a question naming
            // both, and lost by one naming either wrongly.
            expect(await idsFor({ reviewStatus: ['flagged'], trainingDisposition: ['promoted'] })).toEqual([both]);
            expect(await idsFor({ reviewStatus: ['reviewed'], trainingDisposition: ['promoted'] })).toEqual([]);
            expect(await idsFor({ reviewStatus: ['reviewed'], trainingDisposition: ['undecided'] })).toEqual([reviewed]);
        });

        it('treats an empty status array as no filter and never as the mode default', async () => {
            const [, , , , excluded] = seeded.observations.review;

            // `['unreviewed','flagged']` is the scientific mode's default, and it
            // drops the reviewed row. An empty array must not.
            const asked = await idsFor({ reviewStatus: [] });

            expect(asked).toContain(seeded.observations.review[0]);
            expect(asked).toContain(excluded);
        });

        it('rejects a status value outside the dimension vocabulary', async () => {
            const res = await global.api.post(PAGES).send({
                ...reviewQuestion({ reviewStatus: ['promoted'] }), pages: [1],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('does not take "promoted"');
        });

        it('is a semi-join or an anti-join, never a coalesce', () => {
            const anti = mosaic.buildPageSetQuery({
                filters: { reviewStatus: ['unreviewed', 'flagged'] }, pageSize: 45, pages: [1],
            });

            // Every `EXISTS` in the anti-join form is part of a `NOT EXISTS`, and
            // the complement it tests is the single value that was *not* ticked.
            expect(anti.sql.match(/NOT EXISTS/g)).toHaveLength(1);
            expect(anti.sql.match(/EXISTS/g)).toHaveLength(1);
            expect(anti.bind).toContainEqual(['reviewed']);

            const semi = mosaic.buildPageSetQuery({
                filters: { reviewStatus: ['flagged'] }, pageSize: 45, pages: [1],
            });

            expect(semi.sql.match(/EXISTS/g)).toHaveLength(1);
            expect(semi.sql).not.toContain('NOT EXISTS');
            expect(semi.bind).toContainEqual(['flagged']);

            const whole = mosaic.buildPageSetQuery({
                filters: { trainingDisposition: ['undecided', 'promoted', 'excluded'] }, pageSize: 45, pages: [1],
            });

            expect(matchedCte(whole.sql)).not.toContain('EXISTS');

            // Asked of the `matched` CTE, which is where the status predicate
            // lives, rather than of the whole statement. The outer projection
            // grew a legitimate `coalesce` in #118 -- `thumbnail_status` reports
            // `queued` for an observation with no thumbnail record -- and that is
            // a different thing from a status filter degrading into one. Scoped
            // rather than deleted: this assertion is about the filter, and it is
            // exactly as strong about the filter as it was.
            for (const built of [anti, semi, whole]) {
                expect(matchedCte(built.sql).toLowerCase()).not.toContain('coalesce');
            }
        });

        it('reads the projection and never the log (R6)', () => {
            const { sql } = mosaic.buildPageSetQuery({
                filters: { reviewStatus: ['unreviewed'], trainingDisposition: ['promoted'] },
                pageSize: 45,
                pages: [1],
            });

            expect(sql).toContain('observation_review_current');
            expect(sql).not.toContain('observation_reviews');
        });

        it('emits no WHERE term for an absent or empty value on any dimension (R8)', () => {
            const empty = {
                project: [], dive: [], line: [], sessionType: [], session: [], species: [],
                model: [], confidence: null, timeOfDay: { from: null, to: null }, date: null,
                reviewStatus: [], trainingDisposition: [],
            };

            const { sql, bind } = mosaic.buildPageSetQuery({ filters: empty, pageSize: 45, pages: [1] });

            expect(matchedCte(sql)).not.toContain('WHERE');
            // Only the two band bounds.
            expect(bind).toEqual([1, 45]);
        });
    });

    describe('the keyframe aggregate (R9)', () => {

        it('stays out of the matching set for every sort but its own', () => {
            for (const field of ['confidence', 'updatedAt', 'obsID']) {
                const { sql } = mosaic.buildPageSetQuery({
                    filters: {}, sort: [{ field, dir: 'asc' }], pageSize: 45, pages: [1],
                });

                expect(matchedCte(sql)).not.toContain('keyframes');
                // And it is still served, from the outer query.
                expect(sql).toContain('AS keyframe_count');
            }
        });

        it('moves into the matching set for the track-length sort', () => {
            const { sql } = mosaic.buildPageSetQuery({
                filters: {}, sort: [{ field: 'keyframe_count', dir: 'desc' }], pageSize: 45, pages: [1],
            });

            expect(matchedCte(sql)).toContain('FROM keyframes');
            expect(sql).toContain('kc.keyframe_count DESC');
        });

        it('serves the real count and first frame on every row', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 6, pages: [1],
            });

            const byId = new Map(res.body.pages[0].rows.map((row) => [row.observation_id, row]));

            expect(byId.get(seeded.observations.tied[0]).keyframe_count).toBe(8);
            expect(byId.get(seeded.observations.tied[0]).first_framenum).toBe(3001);
            expect(byId.get(seeded.observations.tied[1]).keyframe_count).toBe(3);
            expect(byId.get(seeded.observations.tied[2]).keyframe_count).toBe(0);
            expect(byId.get(seeded.observations.tied[2]).first_framenum).toBeNull();
        });

        it('sorts by track length when asked', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 6, pages: [1], sort: [{ field: 'keyframe_count', dir: 'desc' }],
            });

            expect(res.body.pages[0].rows.map((row) => row.keyframe_count)).toEqual([8, 3, 0, 0, 0, 0]);
        });
    });

    describe('no duplicate rows (R14)', () => {

        it('returns one row for an observation with many keyframes', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 6, pages: [1], includeTotal: true,
            });

            const ids = idsOf(res.body);

            expect(ids).toHaveLength(6);
            expect(new Set(ids).size).toBe(6);
            expect(res.body.total).toBe(6);
        });
    });

    describe('the counts (R10, R11)', () => {

        it('returns all six counts and a total in one pass', async () => {
            const res = await global.api.post(COUNTS).send(reviewQuestion());

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                total: 5,
                unreviewed: 2,
                reviewed: 1,
                flagged: 2,
                undecided: 3,
                promoted: 1,
                excluded: 1,
            });
        });

        it('applies the non-status filters and ignores the status ones', async () => {
            const plain = await global.api.post(COUNTS).send(reviewQuestion());
            const withStatus = await global.api.post(COUNTS)
                .send(reviewQuestion({ reviewStatus: ['flagged'], trainingDisposition: ['promoted'] }));

            expect(withStatus.body).toEqual(plain.body);

            // A non-status filter does move them.
            const narrowed = await global.api.post(COUNTS)
                .send(reviewQuestion({ confidence: { from: 0.25, to: 1 } }));

            expect(narrowed.body.total).toBe(3);
        });

        it('needs no sort and no row numbering', () => {
            const { sql } = mosaic.buildCountsQuery({ filters: { session: [1] } });

            expect(sql).not.toContain('row_number');
            expect(sql).not.toContain('ORDER BY');
            expect(sql).toContain('IS NULL');
            expect(sql.toLowerCase()).not.toContain('coalesce');
        });

        it('counts a total over a larger set than the page query does (R11)', async () => {
            const counted = await global.api.post(COUNTS).send(reviewQuestion());
            const paged = await global.api.post(PAGES)
                .send({ ...reviewQuestion({ reviewStatus: ['unreviewed'] }), pages: [1], includeTotal: true });

            expect(counted.body.total).toBe(5);
            expect(paged.body.total).toBe(2);
            expect(counted.body.total).toBeGreaterThan(paged.body.total);
        });
    });

    describe('the outer joins (A5)', () => {

        /** The three rows scoped by the fixture model, by id. */
        async function modelRows() {
            const res = await global.api.post(PAGES).send({
                filters: { model: [seeded.modelId] }, pageSize: 10, pages: [1], includeTotal: true,
            });

            expect(res.status).toBe(200);

            return { total: res.body.total, byId: new Map(res.body.pages[0].rows.map((r) => [r.observation_id, r])) };
        }

        it('returns an observation with a null session_id', async () => {
            const { total, byId } = await modelRows();
            const row = byId.get(seeded.observations.nulls[0]);

            expect(total).toBe(3);
            expect(row).toBeDefined();
            expect(row.dive).toBeNull();
            expect(row.line).toBeNull();
            expect(row.session_type).toBeNull();
            expect(row.project_name).toBeNull();
        });

        it('returns an observation with a null project_id', async () => {
            const { byId } = await modelRows();
            const row = byId.get(seeded.observations.nulls[1]);

            expect(row).toBeDefined();
            expect(row.dive).toBe(`JEST-nulls-${runId}`);
            expect(row.project_name).toBeNull();
        });

        it('excludes it only when the reviewer filters on that dimension', async () => {
            const res = await global.api.post(PAGES).send({
                filters: { model: [seeded.modelId], dive: [`JEST-nulls-${runId}`] },
                pageSize: 10,
                pages: [1],
                includeTotal: true,
            });

            expect(res.body.total).toBe(2);
            expect(idsOf(res.body)).not.toContain(seeded.observations.nulls[0]);
        });

        it('reaches projects through observations.project_id, not through sessions', () => {
            const { sql } = mosaic.buildPageSetQuery({ filters: {}, pageSize: 45, pages: [1] });

            expect(sql).toContain('LEFT JOIN projects p ON p.project_id = o.project_id');
            expect(sql).toContain('LEFT JOIN sessions s ON s.session_id = o.session_id');
            expect(sql).not.toContain('p.project_id = s.project_id');
        });
    });

    describe('the species filter (A4)', () => {

        it('matches species_id and not comname', async () => {
            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessions.species], species: [1] },
                pageSize: 10,
                pages: [1],
                includeTotal: true,
            });

            expect(res.body.total).toBe(1);
            expect(idsOf(res.body)).toEqual([seeded.observations.species[0]]);

            // Both rows carry the same common name, so a `comname` filter would
            // have returned both.
            const bothRows = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessions.species] }, pageSize: 10, pages: [1], includeTotal: true,
            });

            expect(bothRows.body.total).toBe(2);
            expect(bothRows.body.pages[0].rows.map((row) => row.comname))
                .toEqual([`Jest Twin ${runId}`, `Jest Twin ${runId}`]);
        });

        it('refuses a species name where an id belongs', async () => {
            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessions.species], species: ['Bat Star'] },
                pages: [1],
            });

            // Rejected, rather than silently matching nothing -- which is what the
            // client currently sends, and what Phase 8's rename fixes.
            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('integer ids');
        });
    });

    describe('the date and time-of-day dimensions (A3)', () => {

        /**
         * **This asserted the opposite until #124's A17, and the reversal is the point.**
         *
         * Phase 4 read `date` as unanswerable -- nothing holds the date an observation was
         * made -- and refusing was more honest than a control that excluded everything.
         * A17 was answered differently by the human: *"if there is no date, it'll just
         * default to the time. And if there is a date, then the date will also work."* The
         * reviewer is asking about a **moment**, `tc` is the moment MARP records, and
         * answering with what `tc` can discriminate beats refusing.
         *
         * So the range is served, over the same clock expression `timeOfDay` uses, and it
         * **does not wrap** -- which is now the whole difference between the two controls.
         */
        it('serves an active date filter as a range over tc (A17)', async () => {
            // **Scoped, and `...tiedQuestion()` cannot do it**: a spread whose `filters`
            // is overwritten loses the session scope, and the question then matches every
            // row in a shared database. The first draft of this check did exactly that and
            // asserted 6 against 14.
            const scoped = (date) => ({
                filters: { session: [seeded.sessions.tied], date }, pageSize: 45, pages: [1],
            });

            const res = await global.api.post(PAGES).send(scoped({ from: '00:00', to: '23:59' }));

            expect(res.status).toBe(200);
            // Every seeded row in this group carries tc 10:00:00.
            expect(res.body.pages[0].rowCount).toBe(6);

            const outside = await global.api.post(PAGES).send(scoped({ from: '11:00', to: '12:00' }));

            expect(outside.status).toBe(200);
            expect(outside.body.pages[0].rowCount).toBe(0);
        });

        it('does not wrap a date range, where a time window does (A17)', async () => {
            // 22:00 to 02:00 is one night as a *window* and an empty question as a
            // *range*. Writing the range with the wrapping rule would silently turn the
            // second into the first.
            const asRange = await global.api.post(PAGES).send({
                filters: {
                    session: [seeded.sessions.tied], date: { from: '22:00', to: '02:00' },
                },
                pageSize: 45, pages: [1],
            });

            expect(asRange.status).toBe(200);
            expect(asRange.body.pages[0].rowCount).toBe(0);
        });

        it('reports the rows a date filter could not answer for (#76)', async () => {
            // What #76 built the reporting for, and it had nothing to report while the
            // filter was refused. A row whose `tc` carries no readable clock cannot answer,
            // so it is excluded *and counted* -- a number the reviewer can see is the
            // difference between a filter and a lie.
            const [nulls] = await q(
                `SELECT count(*)::int AS n FROM observations o
                  WHERE o.ml_model_id = :modelId
                    AND substring(o.tc from '^-?(?:[0-9]+\.)?([0-9]{1,2}:[0-9]{2}:[0-9]{2})') IS NULL`,
                { modelId: seeded.modelId }
            );

            const res = await global.api.post(PAGES).send({
                filters: { model: [seeded.modelId], date: { from: '00:00', to: '23:59' } },
                pageSize: 45, pages: [1],
            });

            expect(res.status).toBe(200);
            expect(res.body.excludedForNoDate).toBe(nulls.n);
            expect(nulls.n).toBeGreaterThan(0);
        });

        it('reports zero when the date dimension is not filtering, and costs nothing', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pages: [1],
            });

            expect(res.body.excludedForNoDate).toBe(0);
        });

        it('does not reject a date dimension that is not filtering', async () => {
            for (const date of [null, { from: null, to: null }, undefined]) {
                const res = await global.api.post(PAGES).send({
                    filters: { session: [seeded.sessions.tied], date }, pageSize: 6, pages: [1],
                });

                expect(res.status).toBe(200);
                expect(res.body.pages[0].rowCount).toBe(6);
            }
        });

        it('serves time of day from tc, including a day rollover and a wrapped window', async () => {
            const [evening, afterMidnight] = seeded.observations.clock;

            const ask = async (timeOfDay) => {
                const res = await global.api.post(PAGES).send({
                    filters: { session: [seeded.sessions.clock], timeOfDay },
                    pageSize: 10,
                    pages: [1],
                });

                expect(res.status).toBe(200);

                return idsOf(res.body).slice().sort((a, b) => a - b);
            };

            expect(await ask({ from: '21:00', to: '22:00' })).toEqual([evening]);
            expect(await ask({ from: '01:00', to: '02:00' })).toEqual([]);

            // The day component says the dive rolled over, not which hour it was:
            // `1.00:15:33` is quarter past midnight.
            expect(await ask({ from: '00:00', to: '01:00' })).toEqual([afterMidnight]);

            // Wrapped past midnight, which is one night and therefore an OR.
            expect(await ask({ from: '21:00', to: '02:00' }))
                .toEqual([evening, afterMidnight].sort((a, b) => a - b));

            // One open end.
            expect(await ask({ from: '21:00', to: null })).toEqual([evening]);
            expect(await ask({ from: null, to: '01:00' })).toEqual([afterMidnight]);
        });

        it('refuses a time of day that is not one', async () => {
            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pages: [1], filters: { timeOfDay: { from: 'half past nine', to: null } },
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('HH:MM');
        });
    });

    describe('the excluded set', () => {

        it('suppresses ids the caller already holds pinned', async () => {
            const [first, second] = [...seeded.observations.tied].sort((a, b) => a - b);

            const res = await global.api.post(PAGES).send({
                ...tiedQuestion(), pageSize: 6, pages: [1], exclude: [first, second], includeTotal: true,
            });

            expect(res.body.total).toBe(4);
            expect(idsOf(res.body)).not.toContain(first);
            expect(idsOf(res.body)).not.toContain(second);
        });

        it('reads it from filters.excludeIds too, where the client puts it', async () => {
            const [first] = [...seeded.observations.tied].sort((a, b) => a - b);

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessions.tied], excludeIds: [first] },
                pageSize: 6,
                pages: [1],
                includeTotal: true,
            });

            expect(res.body.total).toBe(5);
            expect(idsOf(res.body)).not.toContain(first);
        });
    });

    describe('the row shape (R13)', () => {

        it('is exactly the agreed key set', async () => {
            const res = await global.api.post(PAGES).send({ ...tiedQuestion(), pageSize: 1, pages: [1] });

            const keys = Object.keys(res.body.pages[0].rows[0]).sort();

            expect(keys).toEqual([
                'comname',
                'confidence',
                'dive',
                'exclusion_reason',
                'first_framenum',
                'flag_reason',
                'keyframe_count',
                'line',
                'obsID',
                'observation_id',
                'project_name',
                'review_decision',
                // Owed to #124's A13, and F8 is the defect it closes: the client draws
                // "REVIEWED by you", the borrowed tag's attribution and `byMe` from
                // `reviewed_by` / `flagged_by` / `training_approved_by` / `excluded_by`,
                // and this row has never carried any of the four -- so all three silently
                // became nothing. **Ids and not names**, which keeps #118's A10 reasoning
                // intact: the catalog separates `reports:read` because it exposes who did
                // how much work, and an id the caller can only compare with its own
                // principal exposes nobody. **Moved into this list rather than the list
                // being loosened** -- naming the exact keys is the tripwire.
                'review_reviewer_id',
                'session_type',
                // Owed to #111, not wanted by the tile either: `comname` above
                // is the annotator's frozen label and a species correction never
                // rewrites it, so without this the row can only report the old
                // animal and a corrected tile renders it for ever. **Moved into
                // this list rather than the list being loosened** -- naming the
                // exact keys is the tripwire, and relaxing it would disable the
                // tripwire permanently to admit one field.
                'species_comname',
                'tc',
                // Owed to #118 R11, and the last field Phase 6 adds to this row:
                // whether the tile has a picture yet. **Moved into this list
                // rather than the list being loosened** -- naming the exact keys
                // is the tripwire, and relaxing it would disable the tripwire
                // permanently to admit one field. The picture's address is
                // derivable from observation_id, so no `thumb` joins it.
                'thumbnail_status',
                'training_decision',
                // The training half of A13's pair. Same reasoning, same list, same rule
                // about being moved in rather than admitted by loosening.
                'training_reviewer_id',
                // Owed to #106's D1, not wanted by the tile: the commit routes
                // require the version the reviewer saw, and this row is the only
                // channel that can carry it.
                'version',
            ]);
        });

        it('carries no processor_name, lineId or scientific_name', async () => {
            const res = await global.api.post(PAGES).send({ ...tiedQuestion(), pageSize: 1, pages: [1] });

            const row = res.body.pages[0].rows[0];

            // A7 turns on `processor_name` staying out: with it, this stops being
            // an `observations:read` route.
            expect(row).not.toHaveProperty('processor_name');
            expect(row).not.toHaveProperty('lineId');
            expect(row).not.toHaveProperty('scientific_name');

            // And the query artefacts are not payload either.
            expect(row).not.toHaveProperty('rn');
            expect(row).not.toHaveProperty('total');
        });

        it('serves the review state as the projection holds it', async () => {
            const res = await global.api.post(PAGES).send({
                ...reviewQuestion(), pageSize: 10, pages: [1],
            });

            const byId = new Map(res.body.pages[0].rows.map((row) => [row.observation_id, row]));
            const [reviewed, flagged, none, both] = seeded.observations.review;

            expect(byId.get(reviewed).review_decision).toBe('reviewed');
            expect(byId.get(flagged).review_decision).toBe('flagged');
            expect(byId.get(flagged).flag_reason).toBe('blurry');
            expect(byId.get(none).review_decision).toBeNull();
            expect(byId.get(none).training_decision).toBeNull();
            expect(byId.get(both).training_decision).toBe('promoted');
        });
    });
});
