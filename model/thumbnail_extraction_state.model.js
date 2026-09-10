/**
 * Sequelize model definition for the thumbnail extractor's run state.
 *
 * One row, ever, kept single by a check constraint on `id = 1`. The state is in
 * the database rather than in memory because a service paused *because Jellyfin
 * was struggling* must still be paused after an API restart -- an in-memory pause
 * silently expires at exactly the worst moment (R25).
 *
 * Two values only. `paused` stops starting new extractions and lets in-flight
 * ones finish, because killing an ffmpeg mid-decode wastes the Jellyfin stream it
 * already paid for. There is no `stopped`: stop is pause plus discarding the
 * queue, and a discarded row is simply absent again, which the next page view
 * re-enqueues.
 *
 * Refs #118.
 *
 * @fileoverview Sequelize model for thumbnail_extraction_state.
 * @author Isaac Travers
 * @module model/thumbnail_extraction_state
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the thumbnail_extraction_state Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized thumbnail_extraction_state model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * Sequelize model representing the single run-state row.
     *
     * @class ThumbnailExtractionState
     * @extends Model
     */
    class ThumbnailExtractionState extends Model {}

    ThumbnailExtractionState.init(
        {
            id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                primaryKey: true,
                defaultValue: 1,
                comment: 'Always 1.',
            },
            run_state: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: 'running',
                comment: 'running or paused.',
            },
            changed_by_user_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'user_id' },
                comment: 'Who last changed the run state.',
            },
            changed_at: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: 'When the run state last changed.',
            },
            note: {
                type: DataTypes.TEXT,
                allowNull: true,
                comment: 'Why, in the operator\'s words.',
            },
        },
        {
            sequelize,
            modelName: 'thumbnail_extraction_state',
            tableName: 'thumbnail_extraction_state',
            schema: 'public',
            // No created_at/updated_at: the row is never created or destroyed by
            // the application, and `changed_at` already carries the only timing
            // that means anything.
            timestamps: false,
            comment: 'The thumbnail extractor run state. One row, persisted so a pause survives a restart.',
        }
    );

    return ThumbnailExtractionState;
};
