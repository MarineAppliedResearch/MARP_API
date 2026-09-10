/**
 * Sequelize model definition for the observation review log.
 *
 * Defines `observation_reviews`, the append-only record of what each reviewer
 * decided about an observation. A review belongs to its reviewer, so it is a row
 * here rather than a column on `observations`, and one table with a `purpose`
 * discriminator carries both the scientific and the training decision.
 *
 * **Append-only means append-only.** A reviewer changing their mind writes a new
 * row; nothing updates one in place. That is what keeps the per-reviewer history
 * queryable. Which of those rows is current is not a question this model
 * answers -- `observation_review_current` is, and the rule that decides it lives
 * in one place, the rebuild definition shipped in
 * `migrations/20260909120200-create-observation-review-current.js`.
 *
 * No route, controller or repository reads this yet. It is defined here so a
 * later phase writes through the same registry as everything else rather than
 * inventing its own connection.
 *
 * Refs #103.
 *
 * @fileoverview Sequelize model for the observation_reviews decision log.
 * @author Isaac Travers
 * @module model/observation_reviews
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the observation_reviews Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized observation_reviews model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * Sequelize model representing one reviewer decision event.
     *
     * @class ObservationReviews
     * @extends Model
     */
    class ObservationReviews extends Model {
        /**
         * Register relationships between review rows and related models.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {
            this.belongsTo(models.observations, {
                sourceKey: 'observation_id',
                foreignKey: 'observation_id',
                as: 'observation',
            });

            // The reviewer who owns the record. Not nullable, and the database
            // will not let them be deleted while it exists.
            this.belongsTo(models.users, {
                sourceKey: 'user_id',
                foreignKey: 'reviewer_id',
                as: 'reviewer',
            });

            // Which image supported the decision, where a tile rather than the
            // video view was used.
            this.belongsTo(models.keyframes, {
                sourceKey: 'keyframe_id',
                foreignKey: 'representative_keyframe_id',
                as: 'representativeKeyframe',
            });
        }
    }

    ObservationReviews.init(
        {
            review_id: {
                // Assigned by the database, unlike observations.observation_id
                // which the repository computes as max + 1. See #62.
                type: DataTypes.BIGINT,
                allowNull: false,
                primaryKey: true,
                autoIncrement: true,
                comment: 'Identifier for this decision event.',
            },
            observation_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'observations', key: 'observation_id' },
                comment: 'The observation this decision is about.',
            },
            purpose: {
                type: DataTypes.STRING(32),
                allowNull: false,
                comment: 'Which review this belongs to: "scientific" or "training".',
            },
            decision: {
                // The legal values depend on `purpose`, enforced by a compound
                // CHECK in the database rather than here, so a writer that does
                // not go through this model still cannot break the vocabulary.
                type: DataTypes.STRING(32),
                allowNull: false,
                comment: 'What was decided. "reviewed", "flagged", "withdrawn" or "corrected" for the scientific purpose; "promoted", "excluded" or "withdrawn" for training. There is no "undecided" -- that is the absence of a row.',
            },
            previous_species_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'species', key: 'id' },
                comment: 'The species the observation carried before this correction. Null when it had none, and null on every decision that is not a correction.',
            },
            corrected_species_id: {
                // Paired with `decision` by
                // observation_reviews_corrected_species_check, in both
                // directions: a correction must carry one and nothing else may.
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'species', key: 'id' },
                comment: 'The species this correction changed the observation to. Set for a correction and null for every other decision.',
            },
            reason: {
                type: DataTypes.STRING(64),
                allowNull: true,
                comment: 'Why, from the reviewer-facing vocabulary. Not settled, so enforced by the API rather than a constraint.',
            },
            reviewer_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'user_id' },
                comment: 'The reviewer who made this decision.',
            },
            observation_version: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'The observations.version this decision applied to.',
            },
            reviewed_keyframe_count: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'How many keyframes the observation had when the decision was made. Half of the annotation fingerprint, because observations.version does not move when a keyframe changes.',
            },
            reviewed_keyframe_max_updated_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'The greatest keyframes."updatedAt" for the observation at decision time. A fingerprint, not a version.',
            },
            representative_keyframe_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'keyframes', key: 'keyframe_id' },
                comment: 'The keyframe whose image supported this decision. Null when it was made through the video view.',
            },
            decided_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'When the reviewer decided.',
            },
        },
        {
            sequelize,
            modelName: 'observation_reviews',
            tableName: 'observation_reviews',
            schema: 'public',
            timestamps: true,
            // snake_case, following ml_models and species_pictures rather than
            // observations' quoted camelCase.
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            comment: 'Append-only log of reviewer decisions about observations, for the scientific and training review purposes.',
            indexes: [
                {
                    name: 'observation_reviews_observation_purpose_decided_idx',
                    fields: ['observation_id', 'purpose', 'decided_at'],
                },
                {
                    name: 'observation_reviews_reviewer_decided_idx',
                    fields: ['reviewer_id', 'decided_at'],
                },
            ],
        }
    );

    return ObservationReviews;
};
