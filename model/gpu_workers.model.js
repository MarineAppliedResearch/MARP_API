/**
 * Sequelize model definition for the gpu_workers table.
 *
 * One row per GPU machine enrolled in the compute pool, holding what it says it
 * is (name, version, hardware) and when the coordinator last heard from it.
 *
 * **There is no host, url or port attribute, and there must never be one.** A
 * worker dials out to MARP; MARP never dials a worker. Keeping an address
 * unrepresentable is what makes that a property of the system rather than a
 * convention somebody could break with one migration.
 *
 * @fileoverview Sequelize model for enrolled GPU workers.
 * @author Isaac Travers
 * @module model/gpu_workers
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the gpu_workers Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized gpu_workers model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * One enrolled GPU machine.
     *
     * @class gpu_workers
     * @extends Model
     */
    class gpu_workers extends Model {
        /**
         * Register relationships between workers and their attempts.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {
            this.hasMany(models.gpu_job_attempts, {
                as: 'attempts',
                foreignKey: 'worker_id',
            });
        }
    }

    gpu_workers.init(
        {
            id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                comment: 'Unique identifier for this worker.',
            },

            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
                unique: true,
                comment: 'What this machine calls itself. Unique, so a worker that restarts and enrols again is the same row.',
            },

            enrolled_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'When this machine first enrolled.',
            },

            last_seen_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'Coordinator clock reading at the last poll or heartbeat.',
            },

            state: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: 'online',
                comment: 'One of online, offline, paused.',
            },

            slot_count: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1,
                comment: 'How many attempts this machine will run at once.',
            },

            worker_version: {
                type: DataTypes.STRING(64),
                allowNull: true,
                comment: 'Version of the worker software, as reported at enrolment.',
            },

            capabilities: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: 'GPUs and VRAM, driver, disk, engines, ranges supported. Reported by the worker and not verified.',
            },
        },
        {
            sequelize,
            modelName: 'gpu_workers',
            tableName: 'gpu_workers',
            schema: 'public',
            timestamps: false,
            comment: 'GPU machines enrolled in the MARP compute pool. Deliberately holds no address: workers dial out, and push is unrepresentable.',
        }
    );

    return gpu_workers;
};
