'use strict';

/**
 * What a machine's GPUs were doing while they were working.
 *
 * Distinct from `gpu_job_attempts.capabilities_snapshot`, which is the same kind of reading
 * taken at the wrong moment: that one arrives on the poll, so it describes the machine in
 * the instant before it starts a job. Averaged over this database's own history it reads
 * half a percent utilization on days that ran two thousand jobs.
 *
 * These come from the heartbeat instead, one row per machine per minute, and they are what
 * the dashboard's utilization chart is drawn from.
 *
 * @fileoverview Per-minute GPU readings from a working machine.
 * @author Isaac Travers
 * @module model/gpu_worker_samples
 */

const { Model, DataTypes } = require('sequelize');

/**
 * @param {Object} sequelize - Sequelize instance.
 * @returns {Object} The initialised model.
 */
module.exports = (sequelize) => {
    /** One minute's reading from one machine. */
    class gpu_worker_samples extends Model {
        /**
         * @param {Object} models - Every initialised model.
         * @returns {void}
         */
        static associate(models) {
            gpu_worker_samples.belongsTo(models.gpu_workers, { foreignKey: 'worker_id' });
            gpu_worker_samples.belongsTo(models.gpu_job_attempts, { foreignKey: 'attempt_id' });
        }
    }

    gpu_worker_samples.init(
        {
            id: {
                type: DataTypes.BIGINT,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                comment: 'Unique identifier for this sample.',
            },

            worker_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: 'The machine this reading came from.',
            },

            // Nulled rather than cascaded when an attempt goes: the reading is a
            // fact about the machine, and deleting an old job must not punch a
            // hole in the utilization history.
            attempt_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'The attempt running when this was taken, where there was one.',
            },

            at: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: 'When the reading was taken, truncated to the minute. One row per machine per minute.',
            },

            devices: {
                type: DataTypes.JSONB,
                allowNull: false,
                comment: 'The worker\'s own per-GPU array, in NVML\'s field names.',
            },
        },
        {
            sequelize,
            modelName: 'gpu_worker_samples',
            tableName: 'gpu_worker_samples',
            schema: 'public',
            timestamps: false,
            comment: 'Per-minute GPU readings taken while a machine was working. The poll\'s snapshot is taken before work starts; this is the one that means something.',
        }
    );

    return gpu_worker_samples;
};
