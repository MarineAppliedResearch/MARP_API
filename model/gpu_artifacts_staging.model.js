/**
 * Sequelize model definition for the gpu_artifacts_staging table.
 *
 * Where a hand-off lands before it is recorded in the existing `artifacts`
 * table. Keyed by `sha256`, because an artifact is addressed by what it is
 * rather than by who sent it -- which is what lets the check step answer
 * `already_have` and lets a worker retry an upload as many times as it likes
 * without producing duplicates.
 *
 * `bytes` is the file's size. The bytes themselves live on disk under
 * `storage/gpu-artifacts/`, the same arrangement as species pictures: nothing
 * here depends on where the API is deployed, and Postgres is not asked to hold
 * hundreds of megabytes of detections.
 *
 * @fileoverview Sequelize model for staged, content-addressed artifact hand-offs.
 * @author Isaac Travers
 * @module model/gpu_artifacts_staging
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the gpu_artifacts_staging Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized gpu_artifacts_staging model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * One set of staged bytes, addressed by its hash.
     *
     * @class gpu_artifacts_staging
     * @extends Model
     */
    class gpu_artifacts_staging extends Model {
        /**
         * Register the relationship back to the attempt that handed it over.
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

    gpu_artifacts_staging.init(
        {
            sha256: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                primaryKey: true,
                comment: 'Hash of the bytes, lower-case hex. Also the filename under storage/gpu-artifacts/.',
            },

            bytes: {
                type: DataTypes.BIGINT,
                allowNull: false,
                comment: 'Size of the file in bytes.',
            },

            content_type: {
                type: DataTypes.STRING(128),
                allowNull: true,
                comment: 'MIME type as the worker declared it.',
            },

            received_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: 'When the bytes finished arriving. A row exists only once they have.',
            },

            attempt_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'The attempt that handed these bytes over (gpu_job_attempts.id). Provenance only.',
            },
        },
        {
            sequelize,
            modelName: 'gpu_artifacts_staging',
            tableName: 'gpu_artifacts_staging',
            schema: 'public',
            timestamps: false,
            comment: 'Content-addressed staging for artifact hand-offs. A row means MARP holds those bytes.',
        }
    );

    return gpu_artifacts_staging;
};
