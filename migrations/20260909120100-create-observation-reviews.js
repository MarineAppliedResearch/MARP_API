/**
 * Creates `observation_reviews`, the append-only log of reviewer decisions.
 *
 * A review belongs to its reviewer, so it is a row here rather than a column on
 * `observations` -- #68 settled that, and it is why `observations` gains no
 * `review_status` and no `training_disposition`. One row per decision event: the
 * row is never updated in place, and it is removed only when its observation is.
 * Changing your mind appends a new row, which is what keeps the per-reviewer
 * history queryable and makes #68's later explicit-validation mode reachable
 * without a data migration.
 *
 * **One table with a `purpose` discriminator, not two.** Independence is a
 * property of the decisions, not of the storage, and it is preserved by
 * `purpose` plus the `(observation_id, purpose)` key on the projection. What one
 * table buys is concrete: Delete Mode filters and displays both status
 * dimensions and is the only mode that does, and #85 settled that every mode
 * shows every workflow's tags -- so the common query wants both, which is one
 * scan of one table. It also means the rule that decides which decision is
 * current is written once rather than twice, and a third purpose later is a
 * value rather than a table. This supersedes #99's spec, which recommended two
 * tables.
 *
 * **Undecided is the absence of a row**, for both purposes, and is never
 * written. There is no `undecided` in the vocabulary and no backfill: having no
 * review row *is* being unreviewed, and the mosaic's default filter is exactly
 * that anti-join.
 *
 * The annotation fingerprint -- `reviewed_keyframe_count` and
 * `reviewed_keyframe_max_updated_at` -- is here because
 * `observations.version` cannot answer "has the annotation changed since I
 * approved this": keyframes are their own table and editing one does not move
 * the observation row. Recorded honestly as a fingerprint rather than a version;
 * two edits within one clock tick that leave the count unchanged would not be
 * detected. A real annotation version means a `version` column and trigger on
 * `keyframes`, which is more schema and more write cost on the second-busiest
 * table, and is not being built now.
 *
 * Refs #103.
 *
 * @fileoverview Migration creating the observation_reviews decision log.
 * @author Isaac Travers
 * @module migrations/create-observation-reviews
 */

'use strict';

/** @type {Object} */
module.exports = {
    /**
     * Creates the table, the compound CHECK that constrains the decision
     * vocabulary per purpose, and the two indexes its own access patterns need.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the table, constraint and indexes exist.
     * @throws {Error} Re-throws after rolling back if creation fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.createTable(
                'observation_reviews',
                {
                    review_id: {
                        // Its own sequence, assigned by the database.
                        // Deliberately not the `observations` pattern, where the
                        // application computes max(id) + 1 and the sequence
                        // drifts unused -- see #62.
                        type: Sequelize.BIGINT,
                        allowNull: false,
                        primaryKey: true,
                        autoIncrement: true,
                        comment: 'Identifier for this decision event.',
                    },
                    observation_id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        references: { model: 'observations', key: 'observation_id' },
                        // Deletion is real and nothing survives it: #68 settled
                        // a permanent delete with no soft-delete marker, and
                        // there is no deletion provenance record to keep.
                        onDelete: 'CASCADE',
                        onUpdate: 'CASCADE',
                        comment: 'The observation this decision is about.',
                    },
                    purpose: {
                        type: Sequelize.STRING(32),
                        allowNull: false,
                        comment: 'Which review this decision belongs to: "scientific" or "training". The two are independent decisions sharing one table.',
                    },
                    decision: {
                        type: Sequelize.STRING(32),
                        allowNull: false,
                        comment: 'What the reviewer decided. "reviewed", "flagged" or "withdrawn" for the scientific purpose; "promoted", "excluded" or "withdrawn" for training. There is no "undecided" -- that is the absence of a row.',
                    },
                    reason: {
                        // No CHECK and no lookup table: #68 records the
                        // controlled vocabulary as unsettled, and changing an
                        // unsettled list should not need a migration. The API
                        // enforces it; converting this to a foreign key later is
                        // additive.
                        type: Sequelize.STRING(64),
                        allowNull: true,
                        comment: 'Why, from the reviewer-facing vocabulary -- initially "Wrong Species", "False Detection", "Duplicate Observation", "Bounding Box Problem", "Other/Unsure". Not settled, so enforced by the API rather than a constraint. Load-bearing rather than decoration: a flagged and a rejected tile are indistinguishable without it.',
                    },
                    reviewer_id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        references: { model: 'users', key: 'user_id' },
                        // A review belongs to its reviewer, so the actor must
                        // not be able to vanish. Safe because users are retired
                        // by a status column rather than deleted -- see
                        // migrations/20260731122000-add-deleted-status-to-users.js.
                        // Deliberately unlike species_pictures.uploaded_by,
                        // which uses SET NULL because an uploader is provenance
                        // rather than the record itself.
                        onDelete: 'RESTRICT',
                        onUpdate: 'CASCADE',
                        comment: 'The reviewer who made this decision. The record belongs to them.',
                    },
                    observation_version: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        comment: 'The observations.version this decision applied to, so a later phase can tell whether the observation row has changed since.',
                    },
                    reviewed_keyframe_count: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'How many keyframes the observation had when the decision was made. Half of the annotation fingerprint: observations.version does not move when a keyframe changes, and #68 counts adding, removing or changing a bounding-box keyframe as a material change.',
                    },
                    reviewed_keyframe_max_updated_at: {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'The greatest keyframes."updatedAt" for the observation when the decision was made. The other half of the fingerprint. A fingerprint, not a version: two edits in one clock tick that leave the count unchanged would not be detected.',
                    },
                    representative_keyframe_id: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        references: { model: 'keyframes', key: 'keyframe_id' },
                        // Keep the decision if the image it was made from is
                        // removed; which image supported it is context, and
                        // losing the context must not lose the review.
                        onDelete: 'SET NULL',
                        onUpdate: 'CASCADE',
                        comment: 'The keyframe whose image supported this decision. Null when the decision was made through the video view rather than a tile.',
                    },
                    decided_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                        comment: 'When the reviewer decided.',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                    },
                },
                { transaction }
            );

            // One compound CHECK rather than two: it constrains the purpose and
            // the decision vocabulary within that purpose in the same
            // expression, so neither can be legal on its own.
            await sequelize.query(
                `ALTER TABLE observation_reviews
                   ADD CONSTRAINT observation_reviews_purpose_decision_check
                   CHECK (
                       (purpose = 'scientific' AND decision IN ('reviewed', 'flagged', 'withdrawn'))
                    OR (purpose = 'training'   AND decision IN ('promoted', 'excluded', 'withdrawn'))
                   )`,
                { transaction }
            );

            // The history for one observation, and the derivation that rebuilds
            // the projection. `(observation_id)` alone is covered by this as a
            // prefix, so it is not added separately. DESC is written out because
            // the derivation reads the latest decision first.
            await sequelize.query(
                `CREATE INDEX observation_reviews_observation_purpose_decided_idx
                   ON observation_reviews (observation_id, purpose, decided_at DESC)`,
                { transaction }
            );

            // "What has this reviewer done", which #68's reviewer view asks.
            await sequelize.query(
                `CREATE INDEX observation_reviews_reviewer_decided_idx
                   ON observation_reviews (reviewer_id, decided_at DESC)`,
                { transaction }
            );

            // Created inside the transaction, not CONCURRENTLY: the table is
            // new and therefore empty, so the build is instant. Said here so the
            // next person does not "fix" it to match migration
            // 20260909120400, which has to be non-transactional for the
            // opposite reason.

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the table. Its constraint and indexes go with it.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the table is gone.
     */
    async down(queryInterface) {
        await queryInterface.dropTable('observation_reviews');
    },
};
