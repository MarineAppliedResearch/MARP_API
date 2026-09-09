/**
 * Tests that `observation_review_current` equals its derivation from the log.
 *
 * D1 and R6 of #103, carried forward to #111's R11. The projection is a derived
 * value, which `AGENTS.md` makes part of the data contract rather than a cache:
 * once it exists, a writer that stops maintaining it is losing data, not serving
 * something stale. The protection against that is this test plus one committed
 * definition of "current".
 *
 * So this suite does two separable things:
 *
 * 1. **It finds the migration that currently defines "current"** and confirms
 *    the block in that file is the one the module exports and runs. #111
 *    supersedes #103's definition with a second migration rather than editing an
 *    applied one, so the invariant is now *exactly one definition is current and
 *    it is the newest* -- see `tests/setup/current-derivation.js` for why the
 *    path is found rather than named.
 * 2. **It maintains the projection the way Phase 5 does** -- an unconditional
 *    upsert, because the last commit wins -- and after every decision asserts
 *    the projection equals the derivation.
 *
 * **The rule these assert changed in #111**, and the tests changed with it
 * rather than because they broke: the human settled that the last commit wins
 * (*"if they want to update they can just refresh their page and requery"*),
 * which overrules the first-valid-review-wins that #103 and #106 built. There is
 * no claiming reviewer and no `first_decided_at`.
 *
 * Everything runs inside a transaction that is always rolled back.
 *
 * @fileoverview Tests for the observation_review_current projection (#103 D1/R6, #111 R11).
 * @author Isaac Travers
 * @module tests/observation-review-current
 */

const db = require('../model');

const {
    CURRENT_MIGRATION_PATH,
    currentDerivationBlock,
    currentMigration,
    extractRebuildBlock,
    migrationsDefiningCurrent,
} = require('./setup/current-derivation');

const { QueryTypes } = db.Sequelize;

/** Distinguishes this run's fixtures from anything already in the database. */
const runId = Date.now();

describe('observation_review_current (#103 D1, R6 · #111 R11)', () => {

    describe('the definition of "current" exists once', () => {

        it('ships a -- rebuild: block in the migration that currently defines it', () => {
            expect(currentDerivationBlock).toContain('-- rebuild:begin');
            expect(currentDerivationBlock).toContain('-- rebuild:end');
            // The three halves of the rule, so a block reduced to a plain
            // "latest row" query fails here rather than drifting.
            expect(currentDerivationBlock).toContain('DISTINCT ON');
            expect(currentDerivationBlock).toContain("decision <> 'withdrawn'");
            expect(currentDerivationBlock).toContain("decision <> 'corrected'");
        });

        it('is the same block that migration exports and runs', () => {
            expect(extractRebuildBlock(currentMigration.CURRENT_DERIVATION_SQL))
                .toBe(currentDerivationBlock);
            expect(currentMigration.REBUILD_CURRENT_SQL).toContain(currentDerivationBlock);
        });

        it('is the newest of the migrations that define it, and there is more than one', () => {
            const defining = migrationsDefiningCurrent();

            // #111 supersedes #103's definition rather than editing an applied
            // migration, so two files carry a block and only the last is in
            // force. A suite that hard-coded the older path would assert the
            // projection matches a rule nothing runs.
            expect(defining.length).toBeGreaterThan(1);
            expect(defining[defining.length - 1]).toBe(CURRENT_MIGRATION_PATH);
        });

        it('no longer derives a first_decided_at, because there is no claimer', () => {
            expect(currentDerivationBlock).not.toContain('first_decided_at');
            expect(currentDerivationBlock).not.toContain('claimer');
        });
    });

    describe('the projection equals the derivation', () => {

        /**
         * How Phase 5 records a decision: append to the log, then upsert the
         * projection unconditionally.
         *
         * **Unconditional is the rule** (#111 A6). Where this once carried
         * `WHERE observation_review_current.reviewer_id = EXCLUDED.reviewer_id`
         * to enforce first-valid-wins, the last commit now wins and
         * `reviewer_id` is in the `SET` list because it moves with the decision.
         *
         * A withdrawal deletes the projection row instead, because undecided is
         * the absence of a row -- and the projection's CHECK refuses
         * `withdrawn`, so this is enforced rather than remembered. It is no
         * longer scoped to the withdrawing reviewer: a withdrawal by anyone
         * clears the current decision.
         *
         * @async
         * @param {Object} decision - The decision to record.
         * @param {number} decision.observationId - Observation being decided.
         * @param {string} decision.purpose - 'scientific' or 'training'.
         * @param {string} decision.decision - The decision value.
         * @param {number} decision.reviewerId - Who decided.
         * @param {string} decision.decidedAt - Timestamp, as SQL text.
         * @param {string|null} [decision.reason] - Why, where recorded.
         * @param {Object} transaction - Transaction to write within.
         * @returns {Promise<string>} The new review_id.
         */
        async function recordDecision(decision, transaction) {
            const {
                observationId, purpose, reviewerId, decidedAt, reason = null,
            } = decision;

            const [review] = await db.sequelize.query(
                `INSERT INTO observation_reviews
                     (observation_id, purpose, decision, reason, reviewer_id,
                      observation_version, decided_at, created_at, updated_at)
                 VALUES (:observationId, :purpose, :decision, :reason, :reviewerId,
                      (SELECT version FROM observations WHERE observation_id = :observationId),
                      :decidedAt, NOW(), NOW())
                 RETURNING review_id`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        observationId,
                        purpose,
                        decision: decision.decision,
                        reason,
                        reviewerId,
                        decidedAt,
                    },
                    transaction,
                }
            );

            if (decision.decision === 'withdrawn') {
                await db.sequelize.query(
                    `DELETE FROM observation_review_current
                      WHERE observation_id = :observationId
                        AND purpose        = :purpose`,
                    { replacements: { observationId, purpose }, transaction }
                );
                return review.review_id;
            }

            await db.sequelize.query(
                `INSERT INTO observation_review_current
                     (review_id, observation_id, purpose, decision, reason,
                      reviewer_id, decided_at, observation_version)
                 SELECT review_id, observation_id, purpose, decision, reason,
                        reviewer_id, decided_at, observation_version
                   FROM observation_reviews
                  WHERE review_id = :reviewId
                 ON CONFLICT (observation_id, purpose) DO UPDATE
                    SET review_id           = EXCLUDED.review_id,
                        decision            = EXCLUDED.decision,
                        reason              = EXCLUDED.reason,
                        reviewer_id         = EXCLUDED.reviewer_id,
                        decided_at          = EXCLUDED.decided_at,
                        observation_version = EXCLUDED.observation_version`,
                { replacements: { reviewId: review.review_id }, transaction }
            );

            return review.review_id;
        }

        /**
         * How the correction endpoint records one: a scientific-purpose log row
         * that never projects, plus the removal of **both** purposes' rows.
         *
         * Both, regardless of reviewer, because a relabel invalidates both --
         * the human, 2026-09-09: *"yes if someone relabels something it needs to
         * be reapproved."* A promoted training sample carrying the wrong label
         * teaches the model the wrong thing.
         *
         * @async
         * @param {Object} correction - The correction.
         * @param {number} correction.observationId - Observation being corrected.
         * @param {number} correction.reviewerId - Who corrected it.
         * @param {string} correction.decidedAt - Timestamp, as SQL text.
         * @param {number|null} correction.previousSpeciesId - Species before.
         * @param {number} correction.correctedSpeciesId - Species after.
         * @param {Object} transaction - Transaction to write within.
         * @returns {Promise<string>} The new review_id.
         */
        async function recordCorrection(correction, transaction) {
            const {
                observationId, reviewerId, decidedAt, previousSpeciesId, correctedSpeciesId,
            } = correction;

            const [review] = await db.sequelize.query(
                `INSERT INTO observation_reviews
                     (observation_id, purpose, decision, reason, reviewer_id,
                      observation_version, previous_species_id, corrected_species_id,
                      decided_at, created_at, updated_at)
                 VALUES (:observationId, 'scientific', 'corrected', NULL, :reviewerId,
                      (SELECT version FROM observations WHERE observation_id = :observationId),
                      :previousSpeciesId, :correctedSpeciesId,
                      :decidedAt, NOW(), NOW())
                 RETURNING review_id`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        observationId, reviewerId, decidedAt, previousSpeciesId, correctedSpeciesId,
                    },
                    transaction,
                }
            );

            await db.sequelize.query(
                'DELETE FROM observation_review_current WHERE observation_id = :observationId',
                { replacements: { observationId }, transaction }
            );

            return review.review_id;
        }

        /**
         * Normalizes a result row so two sources can be compared as values,
         * with timestamps as ISO strings rather than Date objects.
         *
         * @param {Object} row - A projection or derivation row.
         * @returns {Object} The same row, comparable.
         */
        function normalize(row) {
            const out = {};
            for (const [key, value] of Object.entries(row)) {
                out[key] = value instanceof Date ? value.toISOString() : value;
            }
            return out;
        }

        /**
         * Reads the maintained projection and the derivation from the log, both
         * in the same order and shape.
         *
         * @async
         * @param {Object} transaction - Transaction to read within.
         * @returns {Promise<{projection: Array<Object>, derivation: Array<Object>}>} Both sides.
         */
        async function bothSides(transaction) {
            const columns = `review_id, observation_id, purpose, decision, reason,
                             reviewer_id, decided_at, observation_version`;

            const projection = await db.sequelize.query(
                `SELECT ${columns} FROM observation_review_current
                  ORDER BY observation_id, purpose`,
                { type: QueryTypes.SELECT, transaction }
            );

            // The derivation is read out of the committed migration file, so
            // this compares the projection against what is on disk. The newline
            // after the block matters: its last line is a SQL comment, and
            // without one the closing paren is commented out.
            const derivation = await db.sequelize.query(
                `SELECT * FROM (${currentDerivationBlock}\n) derived ORDER BY observation_id, purpose`,
                { type: QueryTypes.SELECT, transaction }
            );

            return {
                projection: projection.map(normalize),
                derivation: derivation.map(normalize),
            };
        }

        /**
         * Seeds one observation to decide about.
         *
         * Written with SQL because the model declares the key without
         * `autoIncrement` and Sequelize sends an explicit null (#62).
         *
         * @async
         * @param {Object} transaction - Transaction to seed within.
         * @returns {Promise<number>} The new observation_id.
         */
        async function seedObservation(transaction) {
            const [observation] = await db.sequelize.query(
                `INSERT INTO observations ("obsID", comname, "createdAt", "updatedAt")
                 VALUES (999004, 'Jest Projection Subject', NOW(), NOW())
                 RETURNING observation_id`,
                { type: QueryTypes.SELECT, transaction }
            );
            return observation.observation_id;
        }

        /**
         * Two reviewers, **seeded rather than borrowed**.
         *
         * This used to read `SELECT user_id FROM users ORDER BY user_id LIMIT 2`
         * and assert the second was defined. That is the Phase 3 failure class
         * exactly: **CI builds the baseline plus migrations and holds no rows**,
         * so a suite that borrows whatever happens to exist passes here and
         * fails there. Seeded inside the suite's transaction, so the rollback
         * removes them.
         *
         * @async
         * @param {Object} transaction - Transaction to seed within.
         * @returns {Promise<Array<number>>} Two user ids.
         */
        async function twoReviewers(transaction) {
            const users = await db.sequelize.query(
                `INSERT INTO users (name, username, status, "createdAt", "updatedAt")
                 SELECT :name || g, :username || g, 'active', NOW(), NOW()
                   FROM generate_series(1, 2) AS g
                 RETURNING user_id`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        name: `Jest Projection Reviewer ${runId}-`,
                        username: `jest-projection-${runId}-`,
                    },
                    transaction,
                }
            );

            return users.map((u) => u.user_id);
        }

        /**
         * Two species to correct between, seeded for the same reason.
         *
         * The 854 rows on a development machine are import data; CI has none.
         *
         * @async
         * @param {Object} transaction - Transaction to seed within.
         * @returns {Promise<Array<number>>} Two species ids.
         */
        async function twoSpecies(transaction) {
            // `taxserial` is NOT NULL and the timestamps are snake_case here,
            // unlike `observations` and `users`. Read from information_schema
            // rather than assumed -- the first attempt assumed the camelCase
            // pair and failed.
            const species = await db.sequelize.query(
                `INSERT INTO species (taxserial, comname, species, created_at, updated_at)
                 SELECT 990000000 + g, :comname || g, :scientific || g, NOW(), NOW()
                   FROM generate_series(1, 2) AS g
                 RETURNING id`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        comname: `Jest Projection Fish ${runId}-`,
                        scientific: `Jestus projectionus ${runId}-`,
                    },
                    transaction,
                }
            );

            return species.map((s) => s.id);
        }

        it('agrees with the derivation through a decision, a superseding decision, a revision and a withdrawal', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA, reviewerB] = await twoReviewers(transaction);
                expect(reviewerB).toBeDefined();

                // Nothing decided: no row, which is what "unreviewed" is.
                let sides = await bothSides(transaction);
                expect(sides.projection).toEqual([]);
                expect(sides.derivation).toEqual([]);

                // Reviewer A decides the scientific review.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toHaveLength(1);
                expect(sides.projection[0].reviewer_id).toBe(reviewerA);
                expect(sides.projection[0].decision).toBe('reviewed');

                // Reviewer B decides the same thing later. **The last commit
                // wins**, so the record moves to B -- where under first-valid-
                // wins it would have stayed with A. The log keeps both.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'flagged',
                    reason: 'Wrong species',
                    reviewerId: reviewerB,
                    decidedAt: '2026-09-09 11:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection[0].reviewer_id).toBe(reviewerB);
                expect(sides.projection[0].decision).toBe('flagged');

                // The training purpose is a separate decision in the same
                // table, and is unaffected by anything above.
                await recordDecision({
                    observationId,
                    purpose: 'training',
                    decision: 'promoted',
                    reviewerId: reviewerB,
                    decidedAt: '2026-09-09 11:05:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toHaveLength(2);

                // A decides again, later still, and takes the record back.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'flagged',
                    reason: 'Bounding box',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 12:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                const scientific = sides.projection.find((r) => r.purpose === 'scientific');
                expect(scientific.decision).toBe('flagged');
                expect(scientific.reason).toBe('Bounding box');
                expect(scientific.reviewer_id).toBe(reviewerA);
                expect(scientific.decided_at)
                    .toBe(new Date('2026-09-09 12:00:00+00').toISOString());

                // A withdraws. Undecided is the absence of a row, so the
                // scientific projection row goes and the training one stays.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'withdrawn',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 13:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toHaveLength(1);
                expect(sides.projection[0].purpose).toBe('training');

                // The whole history is still there: five decisions, in order.
                const history = await db.sequelize.query(
                    `SELECT purpose, decision, reviewer_id
                       FROM observation_reviews
                      WHERE observation_id = :observationId
                      ORDER BY decided_at, review_id`,
                    {
                        type: QueryTypes.SELECT,
                        replacements: { observationId },
                        transaction,
                    }
                );
                expect(history).toHaveLength(5);
            } finally {
                await transaction.rollback();
            }
        });

        it('agrees with the derivation across an invalidation in the middle of the log (R11)', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA, reviewerB] = await twoReviewers(transaction);
                const [speciesOne, speciesTwo] = await twoSpecies(transaction);

                // Reviewer A approves both purposes. Two live decisions, by one
                // person, which is the state a correction has to demolish.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:00:00+00',
                }, transaction);
                await recordDecision({
                    observationId,
                    purpose: 'training',
                    decision: 'promoted',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:01:00+00',
                }, transaction);

                let sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toHaveLength(2);

                // Reviewer B corrects the species. **Both purposes clear.**
                await recordCorrection({
                    observationId,
                    reviewerId: reviewerB,
                    decidedAt: '2026-09-09 11:00:00+00',
                    previousSpeciesId: speciesOne,
                    correctedSpeciesId: speciesTwo,
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toEqual([]);

                // And the audit history survives: three rows, the correction
                // among them, carrying what it changed and what it changed from.
                const afterCorrection = await db.sequelize.query(
                    `SELECT decision, previous_species_id, corrected_species_id
                       FROM observation_reviews
                      WHERE observation_id = :observationId
                      ORDER BY review_id`,
                    { type: QueryTypes.SELECT, replacements: { observationId }, transaction }
                );
                expect(afterCorrection.map((r) => r.decision))
                    .toEqual(['reviewed', 'promoted', 'corrected']);
                expect(afterCorrection[2].previous_species_id).toBe(speciesOne);
                expect(afterCorrection[2].corrected_species_id).toBe(speciesTwo);

                // A **different** reviewer decides afterwards. Under
                // first-valid-wins this was the impossible case: A was the
                // earliest claimant for ever and nobody else could take the
                // record. Now it simply lands.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerB,
                    decidedAt: '2026-09-09 12:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toHaveLength(1);
                expect(sides.projection[0].reviewer_id).toBe(reviewerB);
                expect(sides.projection[0].decision).toBe('reviewed');

                // The pre-correction decisions stay invalidated: the boundary is
                // a review_id, so nothing before it can come back, and the
                // training purpose is still undecided even though no training
                // row followed the correction.
                expect(sides.projection.find((r) => r.purpose === 'training')).toBeUndefined();

                // A second correction, so the chain is more than one link. The
                // scientific decision B just made is invalidated in its turn.
                await recordCorrection({
                    observationId,
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 13:00:00+00',
                    previousSpeciesId: speciesTwo,
                    correctedSpeciesId: speciesOne,
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection).toEqual([]);

                // Five rows, three reviewers' worth of decisions in sequence,
                // and the correction chain reconstructs from the two columns --
                // which a single previous_species_id could not do.
                const history = await db.sequelize.query(
                    `SELECT decision, previous_species_id, corrected_species_id
                       FROM observation_reviews
                      WHERE observation_id = :observationId
                      ORDER BY review_id`,
                    { type: QueryTypes.SELECT, replacements: { observationId }, transaction }
                );
                expect(history).toHaveLength(5);

                const corrections = history.filter((r) => r.decision === 'corrected');
                expect(corrections.map((r) => [r.previous_species_id, r.corrected_species_id]))
                    .toEqual([[speciesOne, speciesTwo], [speciesTwo, speciesOne]]);
            } finally {
                await transaction.rollback();
            }
        });

        it('is reproduced exactly by the committed rebuild SQL', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA, reviewerB] = await twoReviewers(transaction);
                const [speciesOne, speciesTwo] = await twoSpecies(transaction);

                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:00:00+00',
                }, transaction);
                await recordCorrection({
                    observationId,
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:30:00+00',
                    previousSpeciesId: speciesOne,
                    correctedSpeciesId: speciesTwo,
                }, transaction);
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'flagged',
                    reviewerId: reviewerB,
                    decidedAt: '2026-09-09 11:00:00+00',
                }, transaction);
                await recordDecision({
                    observationId,
                    purpose: 'training',
                    decision: 'excluded',
                    reason: 'Too small',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 11:30:00+00',
                }, transaction);

                const before = (await bothSides(transaction)).projection;

                // The recovery path. Throwing the projection away and rebuilding
                // it from the log must land on exactly the same rows -- that is
                // what makes it recoverable rather than authoritative. With a
                // correction in the log, this is also what proves the rebuild
                // does not try to project one: the projection's CHECK does not
                // name `corrected`, so it would fail outright rather than
                // quietly.
                await db.sequelize.query(currentMigration.REBUILD_CURRENT_SQL, { transaction });

                const after = (await bothSides(transaction)).projection;
                expect(after).toEqual(before);
                expect(after).toHaveLength(2);
            } finally {
                await transaction.rollback();
            }
        });

        it('refuses a withdrawn decision in the projection', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA] = await twoReviewers(transaction);

                const reviewId = await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:00:00+00',
                }, transaction);

                // A writer that tried to park a withdrawal in the projection
                // would hide the observation from the default "unreviewed"
                // filter. The CHECK stops it, so the rule is enforced rather
                // than remembered.
                await expect(
                    db.sequelize.query(
                        `UPDATE observation_review_current SET decision = 'withdrawn'
                          WHERE review_id = :reviewId`,
                        { replacements: { reviewId }, transaction }
                    )
                ).rejects.toThrow(/observation_review_current_purpose_decision_check/);
            } finally {
                await transaction.rollback();
            }
        });

        it('refuses a corrected decision in the projection', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA] = await twoReviewers(transaction);

                const reviewId = await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:00:00+00',
                }, transaction);

                // D1: a correction is the vocabulary's second non-projectable
                // state, and the projection's CHECK enforces it **without being
                // changed at all** -- any value it does not name cannot be
                // inserted. So a derivation that stopped excluding corrections
                // would fail loudly on the next rebuild rather than quietly
                // painting a corrected tile as reviewed.
                await expect(
                    db.sequelize.query(
                        `UPDATE observation_review_current SET decision = 'corrected'
                          WHERE review_id = :reviewId`,
                        { replacements: { reviewId }, transaction }
                    )
                ).rejects.toThrow(/observation_review_current_purpose_decision_check/);
            } finally {
                await transaction.rollback();
            }
        });

        it('refuses a training decision recorded against the scientific purpose', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA] = await twoReviewers(transaction);

                // R3's vocabulary, per purpose, in the log itself.
                await expect(
                    recordDecision({
                        observationId,
                        purpose: 'scientific',
                        decision: 'promoted',
                        reviewerId: reviewerA,
                        decidedAt: '2026-09-09 10:00:00+00',
                    }, transaction)
                ).rejects.toThrow(/observation_reviews_purpose_decision_check/);
            } finally {
                await transaction.rollback();
            }
        });
    });
});
