/**
 * Sequelize model definition for the current review state projection.
 *
 * Defines `observation_review_current`, one row per observation per purpose
 * holding the decision that is currently in force. It is a **derived** table:
 * the record is `observation_reviews`, and this is what the log says, maintained
 * in the same transaction as the decision it reflects.
 *
 * Because it is derived it is part of the data contract rather than a cache. A
 * writer that appends to the log without maintaining this is data loss, not
 * staleness. The definition of "current" -- the latest decision per observation
 * and purpose, ignoring anything a correction has superseded -- and the SQL that
 * rebuilds this table from the log live in
 * `migrations/20260909120200-create-observation-review-current.js`, in one place
 * deliberately. `tests/observation-review-current.test.js` finds that file by
 * its `-- rebuild:` block rather than naming a path, and asserts this table
 * equals the derivation in it.
 *
 * `decision` is never "withdrawn": a withdrawal deletes the row, because
 * undecided is the absence of a row and the mosaic's default filter is exactly
 * that anti-join. A CHECK in the database enforces it.
 *
 * The composite primary key is what keeps "at most one current decision per
 * observation per purpose" true at write time: the upsert is unconditional, so
 * the last commit wins, and the key is what makes that one row rather than two.
 *
 * Refs #103, #111.
 *
 * @fileoverview Sequelize model for the observation_review_current projection.
 * @author Isaac Travers
 * @module model/observation_review_current
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the observation_review_current Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized observation_review_current model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * Sequelize model representing the active decision for one observation and
     * one purpose.
     *
     * @class ObservationReviewCurrent
     * @extends Model
     */
    class ObservationReviewCurrent extends Model {
        /**
         * Register relationships between the projection and related models.
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

            // The log row this projects. The log is the record; this is derived.
            this.belongsTo(models.observation_reviews, {
                sourceKey: 'review_id',
                foreignKey: 'review_id',
                as: 'review',
            });
        }
    }

    ObservationReviewCurrent.init(
        {
            observation_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                primaryKey: true,
                references: { model: 'observations', key: 'observation_id' },
                comment: 'The observation whose current state this is.',
            },
            purpose: {
                type: DataTypes.STRING(32),
                allowNull: false,
                primaryKey: true,
                comment: 'Which review: "scientific" or "training".',
            },
            review_id: {
                type: DataTypes.BIGINT,
                allowNull: false,
                references: { model: 'observation_reviews', key: 'review_id' },
                comment: 'The observation_reviews row this projects.',
            },
            decision: {
                type: DataTypes.STRING(32),
                allowNull: false,
                comment: 'The active decision. Never "withdrawn" -- a withdrawal deletes this row.',
            },
            reason: {
                type: DataTypes.STRING(64),
                allowNull: true,
                comment: 'The reason recorded with the active decision.',
            },
            reviewer_id: {
                // Mirrored from the log, which holds the foreign key to users.
                // Not an owner: under last-write-wins it moves whenever somebody
                // else decides later.
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'Who made the current decision.',
            },
            decided_at: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: 'When the active decision was made.',
            },
            observation_version: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'The observations.version the active decision applied to.',
            },
        },
        {
            sequelize,
            modelName: 'observation_review_current',
            tableName: 'observation_review_current',
            schema: 'public',
            // No created_at/updated_at: this table is derived, and decided_at
            // already carries the only timing that means anything. Its own
            // timestamps would duplicate it and the rebuild would have to invent
            // values for them.
            timestamps: false,
            comment: 'Derived projection of the decision currently in force for an observation and a purpose. Rebuilt from observation_reviews; see the migration that creates it for the definition of "current".',
            indexes: [
                {
                    name: 'observation_review_current_purpose_decision_idx',
                    fields: ['purpose', 'decision', 'observation_id'],
                },
            ],
        }
    );

    return ObservationReviewCurrent;
};
