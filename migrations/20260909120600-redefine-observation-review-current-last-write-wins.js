/**
 * Redefines "current" as last-write-wins, and drops `first_decided_at`.
 *
 * **This supersedes `20260909120200`; that file is not edited.** Editing an
 * applied migration makes the file disagree with what ran: the ledger already
 * records it, so its `up()` never runs again, and every existing database would
 * keep a projection maintained against a definition the file no longer contains.
 * A superseding migration is honest, applies wherever `db:migrate` runs, and is
 * exactly what #103 planned for -- its own header says the projection is
 * "separate from the migration that creates `observation_reviews` so that a
 * different answer about the shape of current state replaces one file rather
 * than editing two features apart". This is that different answer.
 *
 * The consequence is that **two migration files carry a `-- rebuild:` block**,
 * so the invariant is no longer "the definition exists once" but "exactly one
 * definition is current, and it is the newest". The tests find it rather than
 * hard-coding a path, which is also the shape that survives the next
 * redefinition.
 *
 * ## What changed, and why
 *
 * **Last write wins**, answered by the human on 2026-09-09: *"obviously the last
 * person to commit something wins, in our normal workflow we are not expecting
 * two people to query and review with the same filters, but if they do, the last
 * one to commit should win, and if they want to update they can just refresh
 * their page and requery."* That overrules first-valid-review-wins, which #103
 * and #106 built. The `claim` and `claimer` CTEs go, the whole notion of an
 * earliest claimant goes with them, and the two-level derivation collapses to
 * one `DISTINCT ON` served directly by
 * `observation_reviews_observation_purpose_decided_idx`.
 *
 * **`first_decided_at` does not survive.** Its column comment said what it was
 * for -- "Preserved when they revise their own decision, which is what
 * first-valid-wins has to keep" -- and that purpose has evaporated. It is
 * `NOT NULL`, so keeping it would force every writer to invent a value and the
 * next reader to believe it meant something. It could be redefined as "when this
 * observation was first decided, by anyone", but nobody has asked for that fact,
 * it is in the log if anyone ever does, and computing it would put a second pass
 * back into a derivation that just collapsed to one.
 *
 * **`reviewer_id` survives and changes meaning**, from "the reviewer who owns
 * this record" to "who made the current decision".
 *
 * **A correction ends the round, for both purposes.** Answered by the human on
 * 2026-09-09: *"yes if someone relabels something it needs to be reapproved."*
 * The reason worth keeping is the scientific one rather than the one #68 states:
 * a promoted training sample carrying the wrong label teaches the model the
 * wrong thing, which is worse than not having the sample at all. So the
 * `boundary` CTE below is deliberately **unfiltered by purpose** -- the
 * correction is recorded as one scientific-purpose row (A2) and it has to end
 * the training round too, which it cannot do by being the latest row for a
 * purpose it does not carry.
 *
 * Refs #111, MarineAppliedResearch/MARP_API#68, MarineAppliedResearch/MARP_API#103.
 *
 * @fileoverview Migration redefining observation_review_current for last-write-wins.
 * @author Isaac Travers
 * @module migrations/redefine-observation-review-current-last-write-wins
 */

'use strict';

const previous = require('./20260909120200-create-observation-review-current');

/**
 * The single definition of "current": for each observation and purpose, the
 * latest decision, ignoring anything a correction has superseded.
 *
 * Read by the rebuild below and by the test that asserts the projection has not
 * drifted from it.
 *
 * **`review_id`, not `observation_version`, is the boundary token.** It is a
 * gapless BIGINT sequence assigned by the database, strictly increasing, with no
 * ties and no dependence on what else touched the observation row. A version
 * boundary looks natural and is a trap: `observations_bump_version_trigger`
 * fires only `WHEN (old.* IS DISTINCT FROM new.*)`, so a correction that changed
 * nothing would record a boundary at a version that never moved -- invalidating
 * every decision and admitting none, permanently.
 *
 * **`decided_at DESC, review_id DESC` keeps the tie-break**, and it matters more
 * under last-wins than it did before: two decisions inside one clock tick are
 * now ordinary rather than exceptional, and `review_id` is what makes the answer
 * deterministic instead of planner-dependent.
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
     * Drops `first_decided_at`, restates the two comments whose meaning changed,
     * and rebuilds the projection under the new definition.
     *
     * The rebuild is what makes this migration complete rather than merely
     * structural: after it runs, every database holds a projection the new
     * derivation agrees with, which is exactly what
     * `tests/observation-review-current.test.js` asserts.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the column is gone and the projection rebuilt.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.removeColumn('observation_review_current', 'first_decided_at', { transaction });

            // The comment is part of the contract: leaving the old one would
            // tell the next reader that first-valid-wins is still the rule.
            await sequelize.query(
                `COMMENT ON COLUMN observation_review_current.reviewer_id IS
                 'Who made the current decision. Last write wins, so this moves when somebody else decides later -- it is not an owner.'`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN observation_review_current.purpose IS
                 'Which review: "scientific" or "training". At most one current decision per observation per purpose.'`,
                { transaction }
            );

            await sequelize.query(REBUILD_CURRENT_SQL, { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Restores `first_decided_at` and the first-valid-wins definition.
     *
     * The column is added nullable, backfilled from the log by the definition
     * being restored, and only then made `NOT NULL` -- adding it `NOT NULL`
     * against a populated table would fail, and adding it with a default would
     * put a fabricated timestamp into a derived value.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the column is back and the projection rebuilt.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async down(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.addColumn(
                'observation_review_current',
                'first_decided_at',
                {
                    type: Sequelize.DATE,
                    allowNull: true,
                    comment: 'When the claiming reviewer first decided. Preserved when they revise their own decision, which is what first-valid-wins has to keep.',
                },
                { transaction }
            );

            // The correction rows go, and this is the honest part of `down`.
            // The restored derivation has no `decision <> 'corrected'` filter,
            // so a correction that is the latest row for its observation would
            // be projected -- and the projection's CHECK does not name the
            // value, so the rebuild would fail outright. There is nowhere to put
            // them under the old definition. `down` on 20260909120500 removes
            // them for the same reason a moment later; doing it here as well is
            // what lets this migration be reversed on its own.
            await sequelize.query(
                "DELETE FROM observation_reviews WHERE decision = 'corrected'",
                { transaction }
            );

            await sequelize.query(previous.REBUILD_CURRENT_SQL, { transaction });

            await queryInterface.changeColumn(
                'observation_review_current',
                'first_decided_at',
                { type: Sequelize.DATE, allowNull: false },
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN observation_review_current.reviewer_id IS
                 'The reviewer who owns this record -- the earliest claiming reviewer. Phase 5 compares against this to enforce first-valid-wins.'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
