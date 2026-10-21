'use strict';

/**
 * Carries the "R" convention into the review schema.
 *
 * **Before MARP had a training dimension, an annotator wrote `R` in an observation's
 * note to mean it was approved for training.** That is the whole record of those
 * decisions: there is no code that reads it, nothing in the schema expresses it, and
 * the convention is known to the people who used it. Isaac, 2026-10-21: *"in our
 * production database a note of 'R' means what i've said, i know it doesn't exist in
 * the testing database, and there is no code based on it"*.
 *
 * `#103` gave observations two independent review dimensions -- `scientific`
 * (reviewed/flagged) and `training` (promoted/excluded) -- and nothing carried the old
 * convention across. So every one of those approvals is invisible to the dataset
 * builder, which can only select promoted observations. Until this runs, a decade of
 * "yes, train on this" counts for nothing.
 *
 * **Training only.** `R` meant approved for training, so this writes the `training`
 * purpose and does not touch `scientific`. Whether those observations were also
 * scientifically reviewed is a different question that this note does not answer, and
 * guessing at it would put a decision in somebody's name that they never made.
 *
 * **The note is kept.** It is the original record and the only evidence this migration
 * was ever right. Clearing it would make the transformation irreversible in substance
 * even though `down` removes the rows.
 *
 * **An existing decision always wins.** If somebody has since promoted *or excluded* an
 * observation in the Mosaic Reviewer, that is a person looking at the picture today and
 * it outranks a letter typed years ago -- so this inserts only where the training
 * dimension is still undecided. That also makes it safe to run twice.
 *
 * **The annotator is the reviewer of record.** `observation_reviews.reviewer_id` is NOT
 * NULL and somebody has to own the decision; the person who wrote the note made it.
 * Where the observation has no `user_id`, the row is left alone and counted rather than
 * attributed to somebody who did not decide it -- an unattributable approval is a thing
 * to look at, not to assign.
 *
 * Refs MarineAppliedResearch/MARP_API#268, #103.
 *
 * @fileoverview Migration promoting observations whose note is the legacy "R".
 * @author Isaac Travers
 * @module migrations/an-r-in-the-note-meant-promoted
 */

const { guardDataIntegrity } = require('../db/data-integrity');

/** What the convention looks like: an R, whatever the case or surrounding space. */
const LEGACY_MARK = "upper(btrim(o.note)) = 'R'";

/**
 * Said on every row this writes, so the provenance travels with the decision -- and so
 * `down` can find exactly these rows without touching a decision somebody made.
 *
 * `reason` is `varchar(64)`, which the first draft of this sentence overran.
 */
const REASON = 'Legacy note "R" meant approved for training';

/** @type {Object} */
module.exports = {
    /**
     * Promotes every observation whose note is the legacy mark.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when the decisions are recorded.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'legacy R promotion',
                // Observations are read and never written; the review tables gain rows.
                tables: ['observations'],
                work: async () => {
                    const [{ marked, undecided, unattributable }] = await sequelize.query(
                        `SELECT count(*)::int AS marked,
                                count(*) FILTER (WHERE rt.decision IS NULL)::int AS undecided,
                                count(*) FILTER (WHERE rt.decision IS NULL AND o.user_id IS NULL)::int
                                    AS unattributable
                           FROM observations o
                           LEFT JOIN observation_review_current rt
                                  ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
                          WHERE ${LEGACY_MARK}`,
                        { type: QueryTypes.SELECT, transaction }
                    );

                    console.log(`[legacy R promotion] ${marked} observations carry the mark`);
                    console.log(`[legacy R promotion]   ${undecided} have no training decision yet`);
                    console.log(
                        `[legacy R promotion]   ${marked - undecided} already decided, left alone`
                    );

                    if (unattributable) {
                        console.log(
                            `[legacy R promotion]   ${unattributable} have no annotator and are `
                            + 'skipped: an approval nobody can be said to have made is a thing to '
                            + 'look at rather than to attribute'
                        );
                    }

                    if (!undecided) return;

                    /* The log first, then the projection from it. That is the order the
                       commit route writes in, and `observation_review_current` carries
                       the `review_id` of the row it projects -- so building the
                       projection from the log is the only way it points at anything. */
                    const inserted = await sequelize.query(
                        `INSERT INTO observation_reviews
                             (observation_id, purpose, decision, reason, reviewer_id,
                              observation_version, decided_at, created_at, updated_at)
                         SELECT o.observation_id, 'training', 'promoted', :reason, o.user_id,
                                o.version, NOW(), NOW(), NOW()
                           FROM observations o
                           LEFT JOIN observation_review_current rt
                                  ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
                          WHERE ${LEGACY_MARK}
                            AND rt.decision IS NULL
                            AND o.user_id IS NOT NULL
                         RETURNING review_id`,
                        { replacements: { reason: REASON }, type: QueryTypes.INSERT, transaction }
                    );

                    await sequelize.query(
                        `INSERT INTO observation_review_current
                             (review_id, observation_id, purpose, decision, reason,
                              reviewer_id, decided_at, observation_version)
                         SELECT r.review_id, r.observation_id, r.purpose, r.decision, r.reason,
                                r.reviewer_id, r.decided_at, r.observation_version
                           FROM observation_reviews r
                          WHERE r.reason = :reason
                            AND NOT EXISTS (
                                SELECT 1 FROM observation_review_current c
                                 WHERE c.observation_id = r.observation_id
                                   AND c.purpose = 'training')`,
                        { replacements: { reason: REASON }, transaction }
                    );

                    const written = Array.isArray(inserted && inserted[0]) ? inserted[0].length : undecided;

                    console.log(`[legacy R promotion] ${written} promoted; the notes are untouched`);
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes exactly the decisions this wrote.
     *
     * Identified by the reason rather than by the note, so a decision somebody made
     * themselves in the Mosaic Reviewer is never withdrawn by a rollback — even on an
     * observation that still carries the mark.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when they are gone.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `DELETE FROM observation_review_current c
                  USING observation_reviews r
                  WHERE c.review_id = r.review_id
                    AND r.reason = :reason`,
                { replacements: { reason: REASON }, transaction }
            );

            await sequelize.query(
                'DELETE FROM observation_reviews WHERE reason = :reason',
                { replacements: { reason: REASON }, transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
