/**
 * Sequelize model definition for the gpu_job_events table.
 *
 * The append-only stream of what happened during one attempt: metrics worth
 * keeping, log lines, and notes the coordinator itself records. The primary key
 * is `(attempt_id, seq)`, which is the whole idempotency story -- a worker that
 * resends a batch it never saw the answer to inserts nothing the second time.
 *
 * Log lines were nearly their own table. A `kind` costs nothing and keeps one
 * ordered stream per attempt, which is what a reader actually wants.
 *
 * Per-frame detections never arrive here. They are handed over as a hashed
 * artifact instead, because a stream of events is the wrong shape for hundreds
 * of megabytes.
 *
 * @fileoverview Sequelize model for per-attempt metric, log and note events.
 * @author Isaac Travers
 * @module model/gpu_job_events
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the gpu_job_events Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized gpu_job_events model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * One event in one attempt's stream.
     *
     * @class gpu_job_events
     * @extends Model
     */
    class gpu_job_events extends Model {
        /**
         * Register the relationship back to the attempt.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {
            this.belongsTo(models.gpu_job_attempts, {
                as: 'attempt',
                foreignKey: 'attempt_id',
            });
        }
    }

    gpu_job_events.init(
        {
            attempt_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                primaryKey: true,
                comment: 'The attempt this event belongs to (gpu_job_attempts.id).',
            },

            seq: {
                type: DataTypes.INTEGER,
                allowNull: false,
                primaryKey: true,
                comment: 'The worker\'s own counter for this attempt. Half of the primary key, which is what makes a replayed batch harmless.',
            },

            at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'When the worker says this happened. Evidence, not a clock anything is judged on.',
            },

            kind: {
                type: DataTypes.STRING(16),
                allowNull: false,
                comment: 'One of metric, log, note.',
            },

            payload: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: 'The metric, the log line, or the note.',
            },
        },
        {
            sequelize,
            modelName: 'gpu_job_events',
            tableName: 'gpu_job_events',
            schema: 'public',
            timestamps: false,
            comment: 'Append-only per-attempt stream of metrics, log lines and coordinator notes, keyed (attempt_id, seq) so replay is safe.',
        }
    );

    return gpu_job_events;
};
