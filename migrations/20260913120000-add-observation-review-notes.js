'use strict';

/**
 * Adds optional reviewer notes to the review record and its current projection.
 *
 * The history remains the record and the projection remains a lossless derivation of
 * its latest live decision. Existing decisions acquire NULL, which means no note was
 * recorded; no existing scientific value is rewritten or inferred.
 */

const CURRENT_DERIVATION_SQL = `
-- rebuild:begin
WITH boundary AS (
    SELECT observation_id, MAX(review_id) AS at_review_id
      FROM observation_reviews
     WHERE decision = 'corrected'
     GROUP BY observation_id
),
latest AS (
    SELECT DISTINCT ON (r.observation_id, r.purpose)
           r.review_id,
           r.observation_id,
           r.purpose,
           r.decision,
           r.reason,
           r.note,
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
       note,
       reviewer_id,
       decided_at,
       observation_version
  FROM latest
 WHERE decision <> 'withdrawn'
-- rebuild:end
`;

const REBUILD_CURRENT_SQL = `
DELETE FROM observation_review_current;
INSERT INTO observation_review_current (
    review_id, observation_id, purpose, decision, reason, note,
    reviewer_id, decided_at, observation_version
)
${CURRENT_DERIVATION_SQL};
`;

module.exports = {
    CURRENT_DERIVATION_SQL,
    REBUILD_CURRENT_SQL,

    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            const column = {
                type: Sequelize.TEXT,
                allowNull: true,
                comment: 'Optional reviewer-authored plain-text note recorded with this decision.',
            };
            await queryInterface.addColumn('observation_reviews', 'note', column, { transaction });
            await queryInterface.addColumn('observation_review_current', 'note', column, { transaction });
            await queryInterface.sequelize.query(REBUILD_CURRENT_SQL, { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.removeColumn('observation_review_current', 'note', { transaction });
            await queryInterface.removeColumn('observation_reviews', 'note', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
