/**
 * Tests for the mosaic frames route.
 *
 * The ML Dashboard's dataset builder shows four numbers beside a query, and three of
 * them -- observations, videos, species -- are answerable from the counts and facets
 * routes. The fourth asks how many *frames* the query covers, because that is what
 * sizes a training run, and neither route can say: `counts` divides a set by review
 * state and `facets` enumerates dimensions. Both stop at the observation.
 *
 * The number that matters is **not** the keyframe count. A keyframe is where somebody
 * drew a box; the frames between two keyframes are interpolated and are trained on as
 * well, so a dataset built from an observation spanning frames 100 to 140 contains 41
 * frames and not the 2 boxes that bound it. Settled with the human on 2026-10-20:
 * *"a dataset trains on the interpolated frames too, so count the span between a
 * keyframe and the next."*
 *
 * **Everything is seeded by this file and every question is scoped to it.** CI builds
 * an empty database, so a test that borrows an existing row passes here and fails
 * there; and the development database holds observations this suite did not create, so
 * an unscoped `frames` assertion would be a claim about whatever else is in it.
 *
 * Refs MarineAppliedResearch/MARP_API#104.
 *
 * @fileoverview Endpoint tests for the mosaic frames route.
 * @author Isaac Travers
 * @module tests/mosaic-frames
 */

const db = require('../model');

const { QueryTypes } = db.Sequelize;

const FRAMES = '/api/v2/mosaic/observations/frames';

/** The path the route is *declared* at. Nothing should answer here. */
const DECLARED_FRAMES = '/api/mosaic/observations/frames';

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Everything seeded, so `afterAll` can remove exactly it. */
const seeded = {
    projectId: null,
    sessionId: null,
    observationIds: [],
    keyframeIds: [],
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
 * without `autoIncrement` -- the repository assigns `max(id) + 1` itself -- so
 * Sequelize sends an explicit null and the insert fails. Tracked in #62.
 *
 * `obsID` is an **integer** column -- the annotator's own numbering, not a label --
 * so the fixture counts rather than naming. A string there is a 400 from Postgres
 * with no hint that the column is the problem.
 *
 * @param {Object} [row] - `{confidence, obsID}`.
 * @returns {Promise<number>} The new observation id.
 */
async function addObservation(row = {}) {
    const [inserted] = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, tc,
              "createdAt", "updatedAt")
         VALUES (:sessionId, :projectId, :obsID, :confidence, :comname, '10:00:00',
                 NOW(), NOW())
         RETURNING observation_id`,
        {
            sessionId: seeded.sessionId,
            projectId: seeded.projectId,
            obsID: row.obsID,
            confidence: row.confidence === undefined ? 0.9 : row.confidence,
            comname: `Jest Frames ${runId}`,
        }
    );

    seeded.observationIds.push(inserted.observation_id);

    return inserted.observation_id;
}

/**
 * Draws keyframes on an observation at the given frame numbers.
 *
 * @param {number} observationId - Which observation.
 * @param {number[]} framenums - Where the boxes are.
 * @returns {Promise<void>}
 */
async function addKeyframes(observationId, framenums) {
    for (const framenum of framenums) {
        const [inserted] = await q(
            `INSERT INTO keyframes
                 (observation_id, subset, comname, type, framenum, x, y, width, height,
                  "createdAt", "updatedAt")
             VALUES (:observationId, 'train', :comname, 'box', :framenum,
                     0.1, 0.1, 0.2, 0.2, NOW(), NOW())
             RETURNING keyframe_id`,
            { observationId, framenum, comname: `Jest Frames ${runId}` }
        );

        seeded.keyframeIds.push(inserted.keyframe_id);
    }
}

/**
 * Records a training decision the way the commit route does: append, then project.
 *
 * @param {number} observationId - Which observation.
 * @param {string} decision - `promoted` or `excluded`.
 * @returns {Promise<void>}
 */
async function decide(observationId, decision) {
    const [review] = await q(
        `INSERT INTO observation_reviews
             (observation_id, purpose, decision, reason, reviewer_id,
              observation_version, decided_at, created_at, updated_at)
         VALUES (:observationId, 'training', :decision, NULL, 1,
              (SELECT version FROM observations WHERE observation_id = :observationId),
              NOW(), NOW(), NOW())
         RETURNING review_id`,
        { observationId, decision }
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

/** This run's rows only. */
const question = (extra = {}) => ({ project: [`Jest Frames Project ${runId}`], ...extra });

describe('the mosaic frames route (#104)', () => {

    beforeAll(async () => {
        const [project] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Frames Project ${runId}` }
        );

        seeded.projectId = project.project_id;

        const [session] = await q(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, 1, :dive, 'L1', :lineId, 'transect', NOW(), NOW())
             RETURNING session_id`,
            { projectId: seeded.projectId, dive: `JF${runId}`.slice(-6), lineId: `LID-JF-${runId}` }
        );

        seeded.sessionId = session.session_id;

        /* Four observations, each chosen for one claim:
           - spanning: 100..140, three boxes. Span 41, keyframes 3.
           - single:   one box. Span 1, keyframes 1 -- the off-by-one case.
           - gapped:   boxes at 10, 20 and 300. Span 291, which is the whole reach
                       and not the two short runs, so the test pins which it is.
           - bare:     no keyframes at all. Contributes 0 to both, and must not
                       drop the observation from the count.  */
        seeded.spanning = await addObservation({ obsID: 1 });
        await addKeyframes(seeded.spanning, [100, 120, 140]);

        seeded.single = await addObservation({ obsID: 2 });
        await addKeyframes(seeded.single, [7]);

        seeded.gapped = await addObservation({ obsID: 3, confidence: 0.2 });
        await addKeyframes(seeded.gapped, [10, 20, 300]);

        seeded.bare = await addObservation({ obsID: 4 });

        await decide(seeded.spanning, 'promoted');
        await decide(seeded.single, 'promoted');
        await decide(seeded.gapped, 'excluded');
    }, 60000);

    afterAll(async () => {
        if (seeded.keyframeIds.length) {
            await db.sequelize.query('DELETE FROM keyframes WHERE keyframe_id IN (:ids)', {
                replacements: { ids: seeded.keyframeIds },
            });
        }

        const ids = seeded.observationIds;

        if (ids.length) {
            await db.sequelize.query('DELETE FROM observation_review_current WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_reviews WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observation_thumbnails WHERE observation_id IN (:ids)', { replacements: { ids } });
            await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', { replacements: { ids } });
        }

        if (seeded.sessionId) {
            await db.sequelize.query('DELETE FROM sessions WHERE session_id = :id', { replacements: { id: seeded.sessionId } });
        }

        if (seeded.projectId) {
            await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', { replacements: { id: seeded.projectId } });
        }
    }, 60000);

    describe('where it answers, and who may ask', () => {

        it('answers at /api/v2/ and not at the declared path', async () => {
            const versioned = await global.api.post(FRAMES).send({ filters: question() });
            const declared = await global.api.post(DECLARED_FRAMES).send({ filters: question() });

            expect(versioned.status).toBe(200);
            expect(declared.status).toBe(404);
        });

        it('refuses an anonymous caller with 401', async () => {
            const request = require('supertest');
            const res = await request(require('../app')).post(FRAMES).send({ filters: question() });

            expect(res.status).toBe(401);
        });
    });

    describe('what it counts', () => {

        it('counts the frames between the keyframes, not the keyframes', async () => {
            const { body } = await global.api.post(FRAMES)
                .send({ filters: question() })
                .expect(200);

            // 41 + 1 + 291 + 0. The keyframes alone would be 7, which is the number
            // this route exists to not report.
            expect(body).toEqual({ observations: 4, keyframes: 7, frames: 333 });
        });

        it('gives a single keyframe a span of one, not zero', async () => {
            const { body } = await global.api.post(FRAMES)
                .send({ filters: question({ confidence: { from: 0.89, to: 0.91 } }) })
                .expect(200);

            // spanning (0.9) + single (0.9) + bare (0.9); gapped is 0.2.
            expect(body.observations).toBe(3);
            expect(body.frames).toBe(42);
        });

        it('keeps an observation with no keyframes in the count, contributing no frames', async () => {
            const { body } = await global.api.post(FRAMES)
                .send({ filters: question({ reviewStatus: ['unreviewed'] }) })
                .expect(200);

            expect(body.observations).toBe(4);
            expect(body.keyframes + 0).toBe(7);
        });

        it('applies the training disposition, unlike the counts route beside it', async () => {
            const { body } = await global.api.post(FRAMES)
                .send({ filters: question({ trainingDisposition: ['promoted'] }) })
                .expect(200);

            // spanning (41) + single (1). The excluded and the undecided are out.
            expect(body).toEqual({ observations: 2, keyframes: 4, frames: 42 });
        });

        it('answers zero rather than null for a question matching nothing', async () => {
            const { body } = await global.api.post(FRAMES)
                .send({ filters: { project: [`No Such Project ${runId}`] } })
                .expect(200);

            expect(body).toEqual({ observations: 0, keyframes: 0, frames: 0 });
        });
    });

    describe('what it refuses', () => {

        it('rejects a species filter given names instead of ids', async () => {
            const response = await global.api.post(FRAMES)
                .send({ filters: question({ species: ['Rockfish'] }) });

            expect(response.status).toBe(400);
            expect(response.body.error.message).toMatch(/integer ids/i);
        });

        it('treats a missing body as no filters rather than failing', async () => {
            const response = await global.api.post(FRAMES).send({});

            expect(response.status).toBe(200);
            expect(response.body.observations).toBeGreaterThanOrEqual(4);
        });
    });
});
