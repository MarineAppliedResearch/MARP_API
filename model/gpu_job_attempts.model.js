/**
 * Sequelize model definition for the gpu_job_attempts table.
 *
 * A job and one machine's attempt at it are separate records. A job may be
 * attempted more than once; an attempt belongs to exactly one worker and carries
 * the lease that makes its reports believable.
 *
 * `lease_epoch` is the job's attempt ordinal at the moment the lease was
 * granted. Every state-changing call a worker makes carries
 * `(attempt_id, worker_id, lease_epoch)`, and a mismatch is answered with
 * abandon -- which is what stops a worker that was presumed dead, and whose job
 * was reassigned, from coming back and corrupting it.
 *
 * `progress_*` is small and overwritten in place at every heartbeat. Anything
 * durable is appended to `gpu_job_events` instead.
 *
 * @fileoverview Sequelize model for one machine's attempt at a GPU job.
 * @author Isaac Travers
 * @module model/gpu_job_attempts
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the gpu_job_attempts Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized gpu_job_attempts model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * One machine's attempt at one job.
     *
     * @class gpu_job_attempts
     * @extends Model
     */
    class gpu_job_attempts extends Model {
        /**
         * Register relationships between an attempt, its job, its worker and its
         * events.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {
            this.belongsTo(models.gpu_jobs, {
                as: 'job',
                foreignKey: 'job_id',
            });

            this.belongsTo(models.gpu_workers, {
                as: 'worker',
                foreignKey: 'worker_id',
            });

            this.hasMany(models.gpu_job_events, {
                as: 'events',
                foreignKey: 'attempt_id',
            });
        }
    }

    gpu_job_attempts.init(
        {
            id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                comment: 'Unique identifier for this attempt.',
            },

            job_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'The job this is an attempt at (gpu_jobs.id).',
            },

            worker_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'The one machine holding this attempt (gpu_workers.id).',
            },

            slot_index: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: 'Which of the worker\'s slots is running this.',
            },

            lease_epoch: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'The job\'s attempt ordinal when this lease was granted. A mismatch on any call is answered with abandon.',
            },

            state: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: 'assigned',
                comment: 'One of assigned, preparing, running, uploading, succeeded, failed, cancelled, preempted, abandoned. Only the coordinator writes a terminal one.',
            },

            leased_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'Coordinator clock reading when the lease was granted.',
            },

            lease_expires_at: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: 'When this lease stops being valid unless a heartbeat extends it. Judged on the coordinator\'s clock only.',
            },

            last_heartbeat_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'Coordinator clock reading at the last heartbeat.',
            },

            progress_done: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Units finished. Overwritten in place at every heartbeat.',
            },

            progress_total: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Units expected in total.',
            },

            progress_unit: {
                type: DataTypes.STRING(32),
                allowNull: true,
                comment: 'What a unit is, e.g. "frames".',
            },

            capabilities_snapshot: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: 'What the machine said it had when it took this lease, so a result stays explainable after the worker row moves on.',
            },

            failure_reason: {
                type: DataTypes.TEXT,
                allowNull: true,
                comment: 'Why this attempt ended badly, in the worker\'s words or the coordinator\'s.',
            },

            finished_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'When the attempt reached a terminal state, on the coordinator\'s clock.',
            },
        },
        {
            sequelize,
            modelName: 'gpu_job_attempts',
            tableName: 'gpu_job_attempts',
            schema: 'public',
            timestamps: false,
            comment: 'One machine\'s attempt at one GPU job, with the lease that makes its reports believable.',
        }
    );

    return gpu_job_attempts;
};
