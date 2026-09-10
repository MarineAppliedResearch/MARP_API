/**
 * Sequelize model definition for the gpu_jobs table.
 *
 * One row per unit of GPU work. **This row is the truth about the job**; a
 * worker's report about it is evidence. Nothing a worker sends sets `state` to
 * `succeeded` directly -- the coordinator decides that when it accepts a
 * terminal result, and `published_attempt_id` records which attempt it accepted
 * so a second one cannot overwrite the first.
 *
 * A split video is N of these sharing a `batch_id`, not one job with children.
 * Each piece leases, retries, fails and reports on its own.
 *
 * @fileoverview Sequelize model for GPU jobs.
 * @author Isaac Travers
 * @module model/gpu_jobs
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the gpu_jobs Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized gpu_jobs model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * One unit of GPU work.
     *
     * @class gpu_jobs
     * @extends Model
     */
    class gpu_jobs extends Model {
        /**
         * Register relationships between a job, its attempts and its artifacts.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {
            this.hasMany(models.gpu_job_attempts, {
                as: 'attempts',
                foreignKey: 'job_id',
            });

            // The one attempt whose result was recorded, out of however many
            // were made.
            this.belongsTo(models.gpu_job_attempts, {
                as: 'published_attempt',
                foreignKey: 'published_attempt_id',
                constraints: false,
            });

            this.hasMany(models.artifacts, {
                as: 'artifacts',
                foreignKey: 'job_id',
            });
        }
    }

    gpu_jobs.init(
        {
            id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                comment: 'Unique identifier for this job.',
            },

            batch_id: {
                type: DataTypes.UUID,
                allowNull: true,
                comment: 'Groups the pieces of one split video. Null for a job submitted on its own.',
            },

            kind: {
                type: DataTypes.STRING(16),
                allowNull: false,
                comment: 'One of inference, tracking, training, diagnostic.',
            },

            spec: {
                type: DataTypes.JSONB,
                allowNull: false,
                comment: 'Engine, model, video, frame range, params and reduction. A range is always present, even for a whole video.',
            },

            state: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: 'queued',
                comment: 'One of queued, leased, succeeded, failed, cancelled, expired.',
            },

            priority: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: 'Higher is claimed first.',
            },

            attempts_made: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: 'How many times this job has been leased; also the current attempt\'s lease epoch.',
            },

            max_attempts: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 3,
                comment: 'After this many attempts a failure or expiry is final rather than requeued.',
            },

            published_attempt_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'The attempt whose result was recorded. Set once and never overwritten.',
            },

            created_by: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'User who submitted the job (users.user_id). Null when an application token submitted it.',
            },

            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'When this job was queued.',
            },

            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'When this job row last changed.',
            },
        },
        {
            sequelize,
            modelName: 'gpu_jobs',
            tableName: 'gpu_jobs',
            schema: 'public',
            timestamps: false,
            comment: 'GPU work items. The coordinator\'s row is the truth about a job; a worker\'s report is evidence.',
        }
    );

    return gpu_jobs;
};
