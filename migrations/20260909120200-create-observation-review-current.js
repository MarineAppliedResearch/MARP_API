/**
 * Creates `observation_review_current`, the maintained projection of which
 * decision is current for an observation and a purpose.
 *
 * **Why a projection rather than deriving it on read, and the reason is
 * correctness rather than speed.** #68's *Concurrent review* settles that the
 * first valid review wins: the first person to approve an observation owns the
 * record, a second reviewer is told it is already done and does not overwrite
 * the original reviewer or timestamp, and the *same* reviewer may still revise
 * their own decision from a committed page. So "current" is not "the latest
 * row" -- it is *the earliest claiming reviewer's latest decision*. Derived on
 * read that is a two-level query no single index serves. As a projection it is
 * one row with a unique key, and the first-wins rule becomes the constraint
 * itself: Phase 5 writes
 * `INSERT ... ON CONFLICT (observation_id, purpose) DO UPDATE ... WHERE
 * observation_review_current.reviewer_id = :me`, so the rule is enforced once
 * rather than re-derived by every reader.
 *
 * **It is a derived value, so it is part of the data contract**, not a cache.
 * A writer that stops maintaining it is data loss. That is why the derivation
 * ships here, in the `-- rebuild:` block below, as the single definition of
 * "current" that the rebuild and `tests/observation-review-current.test.js` both
 * use -- the test asserts projection equals derivation, which is how drift is
 * detected rather than assumed absent.
 *
 * **A withdrawal removes the row rather than sitting in it as a decision.**
 * Undecided is the absence of a row, for both purposes, which is what makes the
 * mosaic's default "unreviewed" filter a primary-key anti-join -- the whole
 * reason this shape was chosen. The CHECK below enforces it: `withdrawn` is
 * legal in the log and illegal here, so Phase 5 must delete the projection row
 * when the claiming reviewer withdraws, and cannot quietly leave a withdrawn
 * observation looking reviewed.
 *
 * Separate from the migration that creates `observation_reviews` so that a
 * different answer about the shape of current state replaces one file rather
 * than editing two features apart.
 *
 * Refs #103.
 *
 * @fileoverview Migration creating the observation_review_current projection and its rebuild definition.
 * @author Isaac Travers
 * @module migrations/create-observation-review-current
 */

'use strict';

/**
 * The single definition of "current": for each observation and purpose, the
 * earliest claiming reviewer's latest decision, excluding a withdrawal.
 *
 * Read by the rebuild below and by the test that asserts the projection has not
 * drifted from it. Both halves of the rule are here and nowhere else:
 *
 * - `claim` reduces the log to one row per reviewer per observation and purpose,
 *   carrying when that reviewer first decided.
 * - `claimer` picks the reviewer who claimed it -- earliest first decision, tied
 *   on the lower `review_id` so the result is deterministic rather than
 *   arbitrary.
 * - `latest` takes that reviewer's most recent decision, tied on the higher
 *   `review_id` for the same reason.
 * - `first_decided_at` stays the claiming reviewer's *first* decision, which is
 *   the timestamp first-wins has to preserve when they revise.
 *
 * Marked with `-- rebuild:begin` / `-- rebuild:end` so a test can read the block
 * out of the committed file and confirm it is what actually runs. The markers
 * are SQL comments, so they cost nothing at execution.
 *
 * @constant
 * @type {string}
 */
const CURRENT_DERIVATION_SQL = `
-- rebuild:begin
WITH claim AS (
    SELECT observation_id,
           purpose,
           reviewer_id,
           MIN(decided_at) AS first_decided_at,
           MIN(review_id)  AS first_review_id
      FROM observation_reviews
     GROUP BY observation_id, purpose, reviewer_id
),
claimer AS (
    SELECT DISTINCT ON (observation_id, purpose)
           observation_id,
           purpose,
           reviewer_id,
           first_decided_at
      FROM claim
     ORDER BY observation_id, purpose, first_decided_at, first_review_id
),
latest AS (
    SELECT DISTINCT ON (r.observation_id, r.purpose)
           r.review_id,
           r.observation_id,
           r.purpose,
           r.decision,
           r.reason,
           r.reviewer_id,
           c.first_decided_at,
           r.decided_at,
           r.observation_version
      FROM observation_reviews r
      JOIN claimer c
        ON c.observation_id = r.observation_id
       AND c.purpose        = r.purpose
       AND c.reviewer_id    = r.reviewer_id
     ORDER BY r.observation_id, r.purpose, r.decided_at DESC, r.review_id DESC
)
SELECT review_id,
       observation_id,
       purpose,
       decision,
       reason,
       reviewer_id,
       first_decided_at,
       decided_at,
       observation_version
  FROM latest
 WHERE decision <> 'withdrawn'
-- rebuild:end
`;

/**
 * Rebuilds the projection from the log, in full.
 *
 * The recovery path, and the definition of correct: after this runs the
 * projection is exactly what the log says it should be. Safe to run at any time
 * inside a transaction.
 *
 * @constant
 * @type {string}
 */
const REBUILD_CURRENT_SQL = `
DELETE FROM observation_review_current;
INSERT INTO observation_review_current (
    review_id, observation_id, purpose, decision, reason,
    reviewer_id, first_decided_at, decided_at, observation_version
)
${CURRENT_DERIVATION_SQL};
`;

/** @type {Object} */
module.exports = {
    CURRENT_DERIVATION_SQL,
    REBUILD_CURRENT_SQL,

    /**
     * Creates the projection, its CHECK and its status-filter index, then runs
     * the rebuild once so the table starts in a state the derivation agrees
     * with.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the table, constraint and index exist.
     * @throws {Error} Re-throws after rolling back if creation fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.createTable(
                'observation_review_current',
                {
                    observation_id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        primaryKey: true,
                        references: { model: 'observations', key: 'observation_id' },
                        // Deletion is real; the projection row goes with the
                        // observation, like the log rows it reflects.
                        onDelete: 'CASCADE',
                        onUpdate: 'CASCADE',
                        comment: 'The observation whose current state this is.',
                    },
                    purpose: {
                        type: Sequelize.STRING(32),
                        allowNull: false,
                        primaryKey: true,
                        comment: 'Which review: "scientific" or "training". At most one current decision per observation per purpose, which is what makes first-valid-wins enforceable by the primary key.',
                    },
                    review_id: {
                        type: Sequelize.BIGINT,
                        allowNull: false,
                        references: { model: 'observation_reviews', key: 'review_id' },
                        onDelete: 'CASCADE',
                        onUpdate: 'CASCADE',
                        comment: 'The observation_reviews row this projects. The log is the record; this is derived from it.',
                    },
                    decision: {
                        type: Sequelize.STRING(32),
                        allowNull: false,
                        comment: 'The active decision. Never "withdrawn" -- a withdrawal deletes this row, because undecided is the absence of a row and the mosaic filters on exactly that.',
                    },
                    reason: {
                        type: Sequelize.STRING(64),
                        allowNull: true,
                        comment: 'The reason recorded with the active decision.',
                    },
                    reviewer_id: {
                        // Mirrored from the log, which holds the foreign key to
                        // users. Not constrained twice: this table is derived,
                        // and the row it is derived from already forbids the
                        // reviewer vanishing.
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        comment: 'The reviewer who owns this record -- the earliest claiming reviewer. Phase 5 compares against this to enforce first-valid-wins.',
                    },
                    first_decided_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        comment: 'When the claiming reviewer first decided. Preserved when they revise their own decision, which is what first-valid-wins has to keep.',
                    },
                    decided_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        comment: 'When the active decision was made -- later than first_decided_at if the claiming reviewer has revised it.',
                    },
                    observation_version: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        comment: 'The observations.version the active decision applied to.',
                    },
                },
                { transaction }
            );

            // The same compound vocabulary as the log, minus `withdrawn`: a
            // withdrawal is a deletion here, not a state. Enforced rather than
            // documented, because a withdrawn row left in place would silently
            // hide an observation from the default "unreviewed" filter.
            await sequelize.query(
                `ALTER TABLE observation_review_current
                   ADD CONSTRAINT observation_review_current_purpose_decision_check
                   CHECK (
                       (purpose = 'scientific' AND decision IN ('reviewed', 'flagged'))
                    OR (purpose = 'training'   AND decision IN ('promoted', 'excluded'))
                   )`,
                { transaction }
            );

            // The status filter, with #68's mandatory observation_id tie-break
            // as the last column -- the tie-break is part of the ordering
            // rather than something appended to it.
            await sequelize.query(
                `CREATE INDEX observation_review_current_purpose_decision_idx
                   ON observation_review_current (purpose, decision, observation_id)`,
                { transaction }
            );

            // Instant: the table is new, so there is nothing to index yet.
            // CONCURRENTLY would be pointless here -- see migration
            // 20260909120400 for the case where it is not.

            // Run the rebuild once, so the table does not merely start empty
            // but starts in a state the derivation agrees with. On a database
            // with no review log this inserts nothing, and that is the proof
            // that the definition executes.
            await sequelize.query(REBUILD_CURRENT_SQL, { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the projection. Its constraint and index go with it, and the log it
     * was derived from is untouched.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the table is gone.
     */
    async down(queryInterface) {
        await queryInterface.dropTable('observation_review_current');
    },
};
