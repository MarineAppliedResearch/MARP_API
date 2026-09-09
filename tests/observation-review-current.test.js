/**
 * Tests that `observation_review_current` equals its derivation from the log.
 *
 * D1 and R6 of #103. The projection is a derived value, which `AGENTS.md` makes
 * part of the data contract rather than a cache: once it exists, a writer that
 * stops maintaining it is losing data, not serving something stale. The
 * protection against that is this test plus one committed definition of
 * "current" -- the `-- rebuild:` block in
 * `migrations/20260909120200-create-observation-review-current.js`.
 *
 * So this suite does two separable things:
 *
 * 1. **It reads the definition out of the committed migration file** and
 *    confirms the block in the file is the one the module exports and runs. A
 *    second copy of the rule is the defect class #99 records as the most common
 *    in this application, and this is what makes a second copy fail rather than
 *    drift.
 * 2. **It maintains the projection the way Phase 5 will** -- the
 *    `ON CONFLICT (observation_id, purpose) DO UPDATE ... WHERE reviewer_id`
 *    upsert that makes first-valid-wins a constraint rather than a convention --
 *    and after every decision asserts the projection equals the derivation.
 *
 * Everything runs inside a transaction that is always rolled back.
 *
 * @fileoverview Tests for the observation_review_current projection (#103 D1, R6).
 * @author Isaac Travers
 * @module tests/observation-review-current
 */

const fs = require('fs');
const path = require('path');

const db = require('../model');

const MIGRATION_PATH = path.join(
    __dirname, '..', 'migrations', '20260909120200-create-observation-review-current.js'
);

const migration = require(MIGRATION_PATH);

const { QueryTypes } = db.Sequelize;

/**
 * Pulls the `-- rebuild:` block out of the committed migration file.
 *
 * Read from the file rather than from the module so that the assertion is about
 * what is committed, not about what happens to be in memory.
 *
 * Anchored to the start of a line, which is not fussiness: the file's own
 * documentation mentions both markers inline, and an unanchored pattern matched
 * that sentence instead of the SQL.
 *
 * @param {string} source - The migration file's text.
 * @returns {string} Everything between the markers, inclusive.
 */
function extractRebuildBlock(source) {
    const match = source.match(/^-- rebuild:begin\r?\n[\s\S]*?^-- rebuild:end$/m);
    return match ? match[0] : '';
}

describe('observation_review_current (#103 D1, R6)', () => {

    /**
     * The migration's own source, with line endings normalised.
     *
     * Normalising is deliberate and not cosmetic. **ECMAScript normalises CRLF to LF
     * inside a template literal**, so `CURRENT_DERIVATION_SQL` always holds LF however
     * the file is stored — while the same file read off disk holds whatever git checked
     * out, which on Windows with `core.autocrlf` is CRLF. The two could then never match.
     *
     * This failed on `develop` the moment the merges caused a fresh checkout, having
     * passed on the branch it was written on, and it passes in CI regardless because CI
     * is Linux and checks out LF. A comparison of SQL should be about the SQL.
     *
     * @type {string}
     */
    const migrationSource = fs
        .readFileSync(MIGRATION_PATH, 'utf8')
        .split('\r\n')
        .join('\n');

    /** @type {string} */
    const fileBlock = extractRebuildBlock(migrationSource);

    describe('the definition of "current" exists once', () => {

        it('ships a -- rebuild: block in the committed migration', () => {
            expect(fileBlock).toContain('-- rebuild:begin');
            expect(fileBlock).toContain('-- rebuild:end');
            // The two halves of the rule, so a block that has been reduced to a
            // plain "latest row" query fails here.
            expect(fileBlock).toContain('DISTINCT ON');
            expect(fileBlock).toContain("decision <> 'withdrawn'");
        });

        it('is the same block the migration exports and runs', () => {
            expect(extractRebuildBlock(migration.CURRENT_DERIVATION_SQL)).toBe(fileBlock);
            expect(migration.REBUILD_CURRENT_SQL).toContain(fileBlock);
        });
    });

    describe('the projection equals the derivation', () => {

        /**
         * How Phase 5 will record a decision: append to the log, then upsert the
         * projection under the constraint that only the claiming reviewer may
         * change it.
         *
         * A withdrawal deletes the projection row instead, because undecided is
         * the absence of a row -- and the projection's CHECK refuses
         * `withdrawn`, so this is enforced rather than remembered.
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
                // Only the claiming reviewer's withdrawal releases the record.
                await db.sequelize.query(
                    `DELETE FROM observation_review_current
                      WHERE observation_id = :observationId
                        AND purpose        = :purpose
                        AND reviewer_id    = :reviewerId`,
                    {
                        replacements: { observationId, purpose, reviewerId },
                        transaction,
                    }
                );
                return review.review_id;
            }

            // First valid review wins. The WHERE on DO UPDATE is the rule: a
            // second reviewer's decision finds the row taken and changes
            // nothing, while the claiming reviewer may revise their own.
            // reviewer_id and first_decided_at are deliberately never updated.
            await db.sequelize.query(
                `INSERT INTO observation_review_current
                     (review_id, observation_id, purpose, decision, reason,
                      reviewer_id, first_decided_at, decided_at, observation_version)
                 SELECT review_id, observation_id, purpose, decision, reason,
                        reviewer_id, decided_at, decided_at, observation_version
                   FROM observation_reviews
                  WHERE review_id = :reviewId
                 ON CONFLICT (observation_id, purpose) DO UPDATE
                    SET review_id           = EXCLUDED.review_id,
                        decision            = EXCLUDED.decision,
                        reason              = EXCLUDED.reason,
                        decided_at          = EXCLUDED.decided_at,
                        observation_version = EXCLUDED.observation_version
                  WHERE observation_review_current.reviewer_id = EXCLUDED.reviewer_id`,
                { replacements: { reviewId: review.review_id }, transaction }
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
                             reviewer_id, first_decided_at, decided_at, observation_version`;

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
                `SELECT * FROM (${fileBlock}\n) derived ORDER BY observation_id, purpose`,
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
         * Two reviewers, taken from whoever exists.
         *
         * @async
         * @param {Object} transaction - Transaction to read within.
         * @returns {Promise<Array<number>>} Two user ids.
         */
        async function twoReviewers(transaction) {
            const users = await db.sequelize.query(
                'SELECT user_id FROM users ORDER BY user_id LIMIT 2',
                { type: QueryTypes.SELECT, transaction }
            );
            return users.map((u) => u.user_id);
        }

        it('agrees with the derivation through a claim, a losing claim, a revision and a withdrawal', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA, reviewerB] = await twoReviewers(transaction);
                expect(reviewerB).toBeDefined();

                // Nothing decided: no row, which is what "unreviewed" is.
                let sides = await bothSides(transaction);
                expect(sides.projection).toEqual([]);
                expect(sides.derivation).toEqual([]);

                // Reviewer A claims the scientific review.
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

                // Reviewer B decides the same thing later. The log keeps it --
                // the full per-reviewer history is retained -- but the record
                // still belongs to A, and neither the reviewer nor the
                // timestamp moves.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'flagged',
                    reason: 'Wrong Species',
                    reviewerId: reviewerB,
                    decidedAt: '2026-09-09 11:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                expect(sides.projection[0].reviewer_id).toBe(reviewerA);
                expect(sides.projection[0].decision).toBe('reviewed');
                expect(sides.projection[0].first_decided_at)
                    .toBe(new Date('2026-09-09 10:00:00+00').toISOString());

                // The training purpose is a separate decision in the same
                // table, and B is free to claim it.
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

                // A revises their own decision from a committed page. The
                // decision moves, first_decided_at does not.
                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'flagged',
                    reason: 'Bounding Box Problem',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 12:00:00+00',
                }, transaction);

                sides = await bothSides(transaction);
                expect(sides.projection).toEqual(sides.derivation);
                const scientific = sides.projection.find((r) => r.purpose === 'scientific');
                expect(scientific.decision).toBe('flagged');
                expect(scientific.reason).toBe('Bounding Box Problem');
                expect(scientific.reviewer_id).toBe(reviewerA);
                expect(scientific.first_decided_at)
                    .toBe(new Date('2026-09-09 10:00:00+00').toISOString());
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

        it('is reproduced exactly by the committed rebuild SQL', async () => {
            const transaction = await db.sequelize.transaction();

            try {
                const observationId = await seedObservation(transaction);
                const [reviewerA, reviewerB] = await twoReviewers(transaction);

                await recordDecision({
                    observationId,
                    purpose: 'scientific',
                    decision: 'reviewed',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 10:00:00+00',
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
                    reason: 'False Detection',
                    reviewerId: reviewerA,
                    decidedAt: '2026-09-09 11:30:00+00',
                }, transaction);

                const before = (await bothSides(transaction)).projection;

                // The recovery path. Throwing the projection away and rebuilding
                // it from the log must land on exactly the same rows -- that is
                // what makes it recoverable rather than authoritative.
                await db.sequelize.query(migration.REBUILD_CURRENT_SQL, { transaction });

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
