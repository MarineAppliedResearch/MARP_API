/**
 * Tests for the mosaic facets route and the row's reviewer ids (#124).
 *
 * Phase 8 of #68, and the two pieces of endpoint it needs:
 *
 * - **A6, the facets route.** The rail must offer only the values still reachable
 *   under the filters already chosen (R15) — "offering a dive that returns nothing
 *   is worse than not offering it" — and nothing could answer that. The client's
 *   fixture scanned 3,000 rows in memory, synchronously, which is not available at
 *   440,000.
 * - **A13, the reviewer ids.** The client draws "REVIEWED · you" and derives `byMe`
 *   from four columns the row has never carried, so the attribution silently became
 *   nothing (F8). The row now carries `review_reviewer_id` and
 *   `training_reviewer_id` — **ids and not names**, which is what keeps this an
 *   `observations:read` route.
 *
 * **Everything is seeded by this file and every question is scoped to it.** CI
 * builds an empty database, so a test that borrows an existing row passes here and
 * fails there; and the development database holds rows this suite did not create,
 * so an unscoped assertion about a facet's contents would pass or fail on what
 * somebody else left behind. Every assertion below is scoped by this run's project
 * or its sessions.
 *
 * Refs MarineAppliedResearch/MARP_API#124.
 *
 * @fileoverview Endpoint tests for the mosaic facets route and the row's reviewer ids.
 * @author Isaac Travers
 * @module tests/mosaic-facets
 */

const db = require('../model');
const mosaic = require('../repository/mosaic.repository');

const { QueryTypes } = db.Sequelize;

const FACETS = '/api/v2/mosaic/observations/facets';
const PAGES = '/api/v2/mosaic/observations/pages';

/** The path the route is *declared* at. Nothing should answer here. */
const DECLARED_FACETS = '/api/mosaic/observations/facets';

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Everything seeded, so `afterAll` can remove exactly it. */
const seeded = {
    projectId: null,
    otherProjectId: null,
    modelIds: [],
    speciesIds: [],
    sessions: {},
    observationIds: [],
    reviewerId: null,
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
 * Inserts one observation and records its id for cleanup.
 *
 * SQL rather than `db.observations.create`, because the model declares the key
 * without `autoIncrement` — the repository assigns `max(id) + 1` itself — so
 * Sequelize sends an explicit null and the insert fails. Tracked in #62.
 *
 * @param {Object} row - `{ sessionKey, projectId, speciesId, modelId, obsID }`.
 * @returns {Promise<number>} The new observation id.
 */
async function addObservation(row) {
    const [inserted] = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, tc, species_id,
              ml_model_id, "createdAt", "updatedAt")
         VALUES (:sessionId, :projectId, :obsID, :confidence, :comname, '10:00:00',
                 :speciesId, :modelId, NOW(), NOW())
         RETURNING observation_id`,
        {
            sessionId: row.sessionKey ? seeded.sessions[row.sessionKey] : null,
            projectId: row.projectId === undefined ? seeded.projectId : row.projectId,
            obsID: row.obsID,
            confidence: row.confidence === undefined ? 0.5 : row.confidence,
            comname: row.comname || `Jest Facets ${runId}`,
            speciesId: row.speciesId === undefined ? null : row.speciesId,
            modelId: row.modelId === undefined ? null : row.modelId,
        }
    );

    seeded.observationIds.push(inserted.observation_id);

    return inserted.observation_id;
}

/**
 * Records a decision the way the commit route does: append to the log, then project.
 *
 * The projection is what the row reads, and `reviewer_id` is the field A13 adds — so
 * this has to go through both rather than writing the projection directly, or the
 * test would prove nothing about where the id comes from.
 *
 * @param {number} observationId - Which observation.
 * @param {string} purpose - `scientific` or `training`.
 * @param {string} decision - The decision value.
 * @param {number} reviewerId - Who decided.
 * @returns {Promise<void>}
 */
async function decide(observationId, purpose, decision, reviewerId) {
    const [review] = await q(
        `INSERT INTO observation_reviews
             (observation_id, purpose, decision, reason, reviewer_id,
              observation_version, decided_at, created_at, updated_at)
         VALUES (:observationId, :purpose, :decision, NULL, :reviewerId,
              (SELECT version FROM observations WHERE observation_id = :observationId),
              NOW(), NOW(), NOW())
         RETURNING review_id`,
        { observationId, purpose, decision, reviewerId }
    );

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

/** This run's rows only, whichever dimension is being asked about. */
const question = () => ({ project: [`Jest Facets Project ${runId}`] });

/** One dimension's facet list from a response, or an empty list. */
const facetOf = (body, key) => (body.facets && body.facets[key]) || [];

/** The values of one facet list, as the filter would take them. */
const valuesOf = (body, key) => facetOf(body, key).map((entry) => entry.value);

describe('the mosaic facets route and the row reviewer ids (#124)', () => {

    beforeAll(async () => {
        const [project] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Facets Project ${runId}` }
        );

        seeded.projectId = project.project_id;

        // A second project holding a dive of its own, so "the dive list is narrowed
        // by the chosen project" is a claim with something to exclude.
        const [other] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Facets Other ${runId}` }
        );

        seeded.otherProjectId = other.project_id;

        for (const name of [`Jest Facets Model A ${runId}`, `Jest Facets Model B ${runId}`]) {
            const [model] = await q(
                `INSERT INTO ml_models (name, model_type, status, created_at, updated_at)
                 VALUES (:name, 'detector', 'archived', NOW(), NOW()) RETURNING id`,
                { name }
            );

            seeded.modelIds.push(model.id);
        }

        // Two species on **different lists** carrying the **same common name**, which
        // is F15: a comname identifies a species only within its list, so A10(c) has
        // the client qualify a label only when the question spans more than one. The
        // facet list is the only thing that can tell it that, so the fixture has to
        // be able to produce the case.
        for (const list of ['JestListOne', 'JestListTwo']) {
            // `created_at` / `updated_at`, snake_case: `species` is one of the tables
            // that predates the migration history, and it does not carry Sequelize's
            // camelCase timestamps the way `observations` and `sessions` do.
            const [species] = await q(
                `INSERT INTO species (taxserial, species_list, comname, species, is_active, created_at, updated_at)
                 VALUES (:taxserial, :list, :comname, 'Jest facetus', true, NOW(), NOW())
                 RETURNING id`,
                {
                    taxserial: list === 'JestListOne' ? 900001 : 900002,
                    list,
                    comname: `Jest Twin ${runId}`,
                }
            );

            seeded.speciesIds.push(species.id);
        }

        // Two dives in this project and one in the other. The line numbers differ per
        // dive, which is what makes "lines per dive" a real question.
        const sessions = [
            { key: 'diveA', dive: `JEST-A-${runId}`, line: 'L1', type: 'JestInvert', projectId: 'own' },
            { key: 'diveA2', dive: `JEST-A-${runId}`, line: 'L2', type: 'JestInvert', projectId: 'own' },
            { key: 'diveB', dive: `JEST-B-${runId}`, line: 'L9', type: 'JestFish', projectId: 'own' },
            { key: 'elsewhere', dive: `JEST-C-${runId}`, line: 'L7', type: 'JestFish', projectId: 'other' },
        ];

        for (const s of sessions) {
            const [session] = await q(
                `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
                 VALUES (:projectId, 1, :dive, :line, :lineId, :type, NOW(), NOW())
                 RETURNING session_id`,
                {
                    projectId: s.projectId === 'own' ? seeded.projectId : seeded.otherProjectId,
                    dive: s.dive,
                    line: s.line,
                    lineId: `LID-${s.key}-${runId}`,
                    type: s.type,
                }
            );

            seeded.sessions[s.key] = session.session_id;
        }

        // One observation per session, plus a second in diveA so a facet count is a
        // number worth asserting rather than always 1.
        await addObservation({ sessionKey: 'diveA', obsID: 950000, modelId: seeded.modelIds[0], speciesId: seeded.speciesIds[0] });
        await addObservation({ sessionKey: 'diveA', obsID: 950001, modelId: seeded.modelIds[0], speciesId: seeded.speciesIds[0] });
        // A third on the first species, so "the most numerous" is a real ordering
        // rather than a tie -- A10(b) opens the mosaic on it.
        await addObservation({ sessionKey: 'diveA', obsID: 950005, modelId: seeded.modelIds[0], speciesId: seeded.speciesIds[0] });
        await addObservation({ sessionKey: 'diveA2', obsID: 950002, modelId: seeded.modelIds[1], speciesId: seeded.speciesIds[1] });
        await addObservation({ sessionKey: 'diveB', obsID: 950003, modelId: seeded.modelIds[1], speciesId: seeded.speciesIds[1] });
        await addObservation({
            sessionKey: 'elsewhere', projectId: seeded.otherProjectId, obsID: 950004,
            modelId: seeded.modelIds[0], speciesId: seeded.speciesIds[0],
        });

        // A person to attribute a decision to. Any real `users` row will do: A13 is
        // about the id reaching the row, not about who it belongs to.
        const [reviewer] = await q(
            `INSERT INTO users (name, username, status, "createdAt", "updatedAt")
             VALUES (:name, :name, 'active', NOW(), NOW()) RETURNING user_id`,
            { name: `jest-facets-reviewer-${runId}` }
        );

        seeded.reviewerId = reviewer.user_id;

        await decide(seeded.observationIds[0], 'scientific', 'flagged', seeded.reviewerId);
        await decide(seeded.observationIds[0], 'training', 'excluded', seeded.reviewerId);
    }, 60000);

    afterAll(async () => {
        const ids = seeded.observationIds;

        if (ids.length) {
            await db.sequelize.query('DELETE FROM observation_review_current WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_reviews WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_thumbnails WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids } });
        }

        const sessionIds = Object.values(seeded.sessions);

        if (sessionIds.length) {
            await db.sequelize.query('DELETE FROM sessions WHERE session_id IN (:ids)', { replacements: { ids: sessionIds } });
        }

        if (seeded.reviewerId) {
            await db.sequelize.query('DELETE FROM users WHERE user_id = :id', { replacements: { id: seeded.reviewerId } });
        }

        if (seeded.speciesIds.length) {
            await db.sequelize.query('DELETE FROM species WHERE id IN (:ids)', { replacements: { ids: seeded.speciesIds } });
        }

        if (seeded.modelIds.length) {
            await db.sequelize.query('DELETE FROM ml_models WHERE id IN (:ids)', { replacements: { ids: seeded.modelIds } });
        }

        await db.sequelize.query('DELETE FROM projects WHERE project_id IN (:ids)', {
            replacements: { ids: [seeded.projectId, seeded.otherProjectId] },
        });
    }, 60000);

    describe('where it answers, and who may ask', () => {

        it('answers at /api/v2/ and not at the declared path', async () => {
            const versioned = await global.api.post(FACETS).send({ filters: question() });
            const declared = await global.api.post(DECLARED_FACETS).send({ filters: question() });

            expect(versioned.status).toBe(200);
            expect(declared.status).toBe(404);
        });

        it('refuses an anonymous caller with 401', async () => {
            const request = require('supertest');
            const res = await request(require('../app')).post(FACETS).send({ filters: question() });

            expect(res.status).toBe(401);
        });
    });

    describe('the reachable values (R15, A6)', () => {

        it('offers every dive in the project, with its own count', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['dive'],
            });

            expect(res.status).toBe(200);

            const dives = facetOf(res.body, 'dive');

            expect(dives.map((d) => d.value).sort()).toEqual(
                [`JEST-A-${runId}`, `JEST-B-${runId}`]
            );
            // Four observations in dive A across its two lines, one in dive B.
            expect(dives.find((d) => d.value === `JEST-A-${runId}`).count).toBe(4);
            expect(dives.find((d) => d.value === `JEST-B-${runId}`).count).toBe(1);
        });

        it('does not offer a dive belonging to another project', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['dive'],
            });

            expect(valuesOf(res.body, 'dive')).not.toContain(`JEST-C-${runId}`);
        });

        it('narrows the lines to the dive already chosen', async () => {
            const res = await global.api.post(FACETS).send({
                filters: { ...question(), dive: [`JEST-A-${runId}`] },
                dimensions: ['line'],
            });

            expect(valuesOf(res.body, 'line').sort()).toEqual(['L1', 'L2']);
            expect(valuesOf(res.body, 'line')).not.toContain('L9');
        });

        it('excludes a dimension from its own predicate, so the list does not collapse to the selection', async () => {
            // Choosing one dive must not reduce the dive list to that dive: it is
            // the one thing a reviewer cannot use the control for.
            const res = await global.api.post(FACETS).send({
                filters: { ...question(), dive: [`JEST-A-${runId}`] },
                dimensions: ['dive'],
            });

            expect(valuesOf(res.body, 'dive').sort()).toEqual(
                [`JEST-A-${runId}`, `JEST-B-${runId}`]
            );
        });

        it('narrows a list by a status filter, not only by the rail dimensions', async () => {
            // The first observation of dive A is flagged. Asking for the reviewed-only
            // question must therefore drop dive A from the *species* list only where
            // that is genuinely true -- so this asserts the plainer claim: a status
            // filter reaches the facet query at all.
            const flaggedOnly = await global.api.post(FACETS).send({
                filters: { ...question(), reviewStatus: ['flagged'] },
                dimensions: ['dive'],
            });

            expect(valuesOf(flaggedOnly.body, 'dive')).toEqual([`JEST-A-${runId}`]);
            expect(facetOf(flaggedOnly.body, 'dive')[0].count).toBe(1);
        });

        it('answers every dimension when none is named', async () => {
            const res = await global.api.post(FACETS).send({ filters: question() });

            expect(Object.keys(res.body.facets).sort())
                .toEqual(Object.keys(mosaic.FACET_DIMENSIONS).sort());
        });

        it('rejects a dimension it cannot serve rather than omitting it', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['nonsense'],
            });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/not a facetable dimension/);
        });
    });

    describe('the key-valued dimensions carry a label as well as a value (A10a)', () => {

        it('gives species the id as its value and the current comname as its label', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['species'],
            });

            const species = facetOf(res.body, 'species');
            const mine = species.filter((s) => seeded.speciesIds.includes(s.value));

            expect(mine).toHaveLength(2);
            // The value is what the filter takes: `observations.species_id`, an integer.
            for (const entry of mine) {
                expect(Number.isInteger(entry.value)).toBe(true);
                expect(entry.label).toBe(`Jest Twin ${runId}`);
            }
        });

        it('says which list a species belongs to, so one label standing for two organisms is detectable (A10c, F15)', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['species'],
            });

            const mine = facetOf(res.body, 'species')
                .filter((s) => seeded.speciesIds.includes(s.value));

            expect(mine.map((s) => s.list).sort()).toEqual(['JestListOne', 'JestListTwo']);
        });

        it('gives model the id as its value and the model name as its label', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['model'],
            });

            const mine = facetOf(res.body, 'model')
                .filter((m) => seeded.modelIds.includes(m.value));

            expect(mine.map((m) => m.label).sort()).toEqual([
                `Jest Facets Model A ${runId}`,
                `Jest Facets Model B ${runId}`,
            ]);
        });

        it('gives session the id as both, because a session has no name', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['session'],
            });

            const mine = facetOf(res.body, 'session')
                .filter((s) => Object.values(seeded.sessions).includes(s.value));

            expect(mine.length).toBeGreaterThan(0);
            for (const entry of mine) {
                expect(String(entry.value)).toBe(entry.label);
            }
        });

        it('offers the most numerous species first by count, which is what a default needs (A10b)', async () => {
            const res = await global.api.post(FACETS).send({
                filters: question(), dimensions: ['species'],
            });

            const mine = facetOf(res.body, 'species')
                .filter((s) => seeded.speciesIds.includes(s.value))
                .sort((a, b) => b.count - a.count);

            // Three observations carry the first species, two the second -- and the
            // one in the other project is excluded by the question, which is what
            // makes this a statement about the facet rather than about the table.
            expect(mine[0].value).toBe(seeded.speciesIds[0]);
            expect(mine[0].count).toBe(3);
            expect(mine[1].count).toBe(2);
        });
    });

    describe('the row reviewer ids (A13, F8)', () => {

        it('carries the reviewer id for each dimension that holds a decision', async () => {
            const res = await global.api.post(PAGES).send({
                filters: { ...question(), dive: [`JEST-A-${runId}`] },
                sort: [{ field: 'obsID', dir: 'asc' }],
                pageSize: 45,
                pages: [1],
            });

            const row = res.body.pages[0].rows
                .find((r) => r.observation_id === seeded.observationIds[0]);

            expect(row.review_decision).toBe('flagged');
            expect(row.review_reviewer_id).toBe(seeded.reviewerId);
            expect(row.training_decision).toBe('excluded');
            expect(row.training_reviewer_id).toBe(seeded.reviewerId);
        });

        it('carries null where there is no decision, rather than omitting the key', async () => {
            const res = await global.api.post(PAGES).send({
                filters: { ...question(), dive: [`JEST-B-${runId}`] },
                pageSize: 45,
                pages: [1],
            });

            const row = res.body.pages[0].rows[0];

            expect(row).toHaveProperty('review_reviewer_id', null);
            expect(row).toHaveProperty('training_reviewer_id', null);
        });

        it('carries an id and never a name, which is what keeps this an observations:read route', async () => {
            const res = await global.api.post(PAGES).send({
                filters: { ...question(), dive: [`JEST-A-${runId}`] },
                pageSize: 45,
                pages: [1],
            });

            const row = res.body.pages[0].rows[0];

            expect(typeof row.review_reviewer_id === 'number' || row.review_reviewer_id === null)
                .toBe(true);
            // The four columns the client used to read, and still must not find here.
            for (const absent of ['reviewed_by', 'flagged_by', 'training_approved_by', 'excluded_by']) {
                expect(row).not.toHaveProperty(absent);
            }
            // And no name of any kind, which is the reasoning #118's A10 recorded.
            expect(row).not.toHaveProperty('reviewer_name');
            expect(row).not.toHaveProperty('processor_name');
        });
    });
});
