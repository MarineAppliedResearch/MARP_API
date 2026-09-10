/**
 * Creates `observation_review_current`, the maintained projection of which
 * decision is current for an observation and a purpose.
 *
 * **Why a projection rather than deriving it on read.** The mosaic's default
 * "unreviewed" filter is exactly "no row here", so as a table it is a
 * primary-key anti-join rather than a correlated subquery over the log -- and
 * the log is the second-busiest write path in the application. The projection is
 * one row per observation per purpose, with the pair as its key, which is what
 * keeps "at most one current decision" true by construction rather than by
 * convention.
 *
 * **The last commit wins.** A second reviewer deciding the same observation is
 * not refused and does not have to be: their decision simply becomes the current
 * one, and the first stays in the log. Nobody is locked out of an observation by
 * whoever reached it first, and a reviewer who wants the current state refreshes
 * and requeries. So "current" is the latest decision per observation and
 * purpose, which one `DISTINCT ON` answers and one index serves.
 *
 * **It is a derived value, so it is part of the data contract**, not a cache.
 * A writer that stops maintaining it is data loss. That is why the derivation
 * ships here, in the `-- rebuild:` block below, as the single definition of
 * "current" that the rebuild and `tests/observation-review-current.test.js` both
 * use -- the test asserts projection equals derivation, which is how drift is
 * detected rather than assumed absent.
 *
 * **A withdrawal removes the row rather than sitting in it as a decision, and a
 * correction never puts one there at all.** Undecided is the absence of a row,
 * for both purposes. The CHECK below enforces it: `withdrawn` and `corrected`
 * are both legal in the log and illegal here, so a writer must delete the
 * projection row rather than quietly leave an observation looking reviewed. The
 * CHECK does this **by naming only the live decisions** -- anything outside its
 * list simply cannot be inserted, so a derivation that stopped excluding one
 * would fail loudly on the next rebuild instead of painting a wrong tile.
 *
 * **A correction ends the round for both purposes.** A relabelled observation
 * has to be reapproved: a promoted training sample carrying the wrong label
 * teaches the model the wrong thing, which is worse than not having the sample
 * at all. That is why the `boundary` CTE below is deliberately unfiltered by
 * purpose -- the correction is one scientific-purpose row, and it has to end the
 * training round too.
 *
 * Separate from the migration that creates `observation_reviews` so that a
 * different answer about the shape of current state replaces one file rather
 * than editing two features apart.
 *
 * Refs #103, #111.
 *
 * @fileoverview Migration creating the observation_review_current projection and its rebuild definition.
 * @author Isaac Travers
 * @module migrations/create-observation-review-current
 */

'use strict';

/**
 * The single definition of "current": for each observation and purpose, the
 * latest decision, ignoring anything a correction has superseded.
 *
 * Read by the rebuild below and by the test that asserts the projection has not
 * drifted from it. Both halves of the rule are here and nowhere else:
 *
 * - `boundary` is the most recent correction per observation, which ends the
 *   round for everything decided before it.
 * - `latest` is one `DISTINCT ON` per observation and purpose, served directly
 *   by `observation_reviews_observation_purpose_decided_idx`.
 *
 * **`review_id`, not `observation_version`, is the boundary token.** It is a
 * gapless BIGINT sequence assigned by the database, strictly increasing, with no
 * ties and no dependence on what else touched the observation row. A version
 * boundary looks natural and is a trap: `observations_bump_version_trigger`
 * fires only `WHEN (old.* IS DISTINCT FROM new.*)`, so a correction that changed
 * nothing would record a boundary at a version that never moved -- invalidating
 * every decision and admitting none, permanently.
 *
 * **`decided_at DESC, review_id DESC` is the tie-break**, and it is not
 * decoration: two decisions inside one clock tick are ordinary rather than
 * exceptional when the last commit wins, and `review_id` is what makes the
 * answer deterministic instead of planner-dependent.
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
WITH boundary AS (
    -- The most recent correction per observation. Deliberately unfiltered by
    -- purpose: a correction is recorded as a scientific decision but it
    -- invalidates the training disposition too, so one row ends the round for
    -- both. A second cause of invalidation is a second branch of this SELECT.
    SELECT observation_id, MAX(review_id) AS at_review_id
      FROM observation_reviews
     WHERE decision = 'corrected'
     GROUP BY observation_id
),
latest AS (
    -- Last write wins. One DISTINCT ON, served by
    -- observation_reviews_observation_purpose_decided_idx.
    SELECT DISTINCT ON (r.observation_id, r.purpose)
           r.review_id,
           r.observation_id,
           r.purpose,
           r.decision,
           r.reason,
           r.reviewer_id,
           r.decided_at,
           r.observation_version
      FROM observation_reviews r
      LEFT JOIN boundary b ON b.observation_id = r.observation_id
     WHERE r.decision <> 'corrected'
       AND (b.at_review_id IS NULL OR r.review_id > b.at_review_id)
     ORDER BY r.observation_id, r.purpose, r.decided_at DESC, r.review_id DESC
)
SELECT review_id,
       observation_id,
       purpose,
       decision,
       reason,
       reviewer_id,
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
    reviewer_id, decided_at, observation_version
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
                        comment: 'Which review: "scientific" or "training". At most one current decision per observation per purpose, which the primary key is what enforces.',
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
                        comment: 'The active decision. Never "withdrawn" and never "corrected" -- neither is a live decision, so both delete this row instead, because undecided is the absence of a row and the mosaic filters on exactly that.',
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
                        comment: 'Who made the current decision. Not an owner: the last commit wins, so this moves whenever somebody else decides later.',
                    },
                    decided_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        comment: 'When the active decision was made.',
                    },
                    observation_version: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        comment: 'The observations.version the active decision applied to.',
                    },
                },
                { transaction }
            );

            // The same compound vocabulary as the log, minus `withdrawn` and
            // `corrected`: neither is a live decision, so both are a deletion
            // here rather than a state. Enforced by naming only what is legal,
            // so a value this list does not carry cannot be inserted at all --
            // which is what makes a derivation that stopped excluding one fail
            // loudly rather than silently hide an observation from the default
            // "unreviewed" filter or paint a corrected tile as reviewed.
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
