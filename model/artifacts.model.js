/**
 * Sequelize model definition for the artifacts output-tracking table.
 *
 * Defines the `artifacts` table, which tracks all output files generated
 * during a training run. This includes model weights, logs, plots, result
 * summaries, exported formats, and more.
 *
 * Each artifact record stores metadata such as file path, size, hash
 * (checksum), and optional contextual JSON metadata to help ensure
 * reproducibility and data integrity across runs.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for artifacts.
 * @author Isaac Assegai Travers
 * @module model/artifacts
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     Artifact:
 *       type: object
 *       description: >
 *         A tracked output file (weights, log, plot, export, etc.) produced
 *         during a training run, including its path, size, checksum, and
 *         optional contextual metadata.
 *       required:
 *         - id
 *         - artifact_type
 *         - path
 *       properties:
 *         id:
 *           type: integer
 *           example: 2201
 *           description: Unique identifier for this artifact record.
 *         training_run_id:
 *           type: integer
 *           nullable: true
 *           example: 12
 *           description: Foreign key referencing the training run this artifact belongs to (training_runs.id). Null for an artifact produced by a GPU job rather than a training run.
 *         job_id:
 *           type: integer
 *           nullable: true
 *           example: 41
 *           description: Foreign key referencing the GPU job that produced this artifact (gpu_jobs.id). Null for an artifact produced by a training run. Exactly one of training_run_id and job_id is always set.
 *         artifact_type:
 *           type: string
 *           example: weights
 *           description: Type of artifact (e.g., "weights", "log", "results_plot", "confusion_matrix", "export").
 *         path:
 *           type: string
 *           description: Filesystem path or URI to the artifact file or directory.
 *         size_mb:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: File size in megabytes, if available (useful for monitoring disk usage).
 *         hash:
 *           type: string
 *           nullable: true
 *           description: Checksum or hash of the artifact file (e.g., SHA256) to verify integrity and detect duplicates.
 *         metadata:
 *           type: object
 *           nullable: true
 *           additionalProperties: true
 *           description: Optional JSON blob with contextual information (e.g., epoch number, export format, or framework version).
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this artifact record was created (typically when the file was generated).
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this artifact record was last updated.
 */

/**
 * Create and initialize the artifacts Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the training_runs model
 * through {@link artifacts.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized artifacts model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one tracked training-run output file.
   *
   * Stores metadata for files and other outputs generated during a machine
   * learning training run.
   *
   * @class artifacts
   * @extends Model
   */
  class artifacts extends Model {

    /**
     * Register relationships between artifacts and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Each artifact belongs to one training run
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',  // Remove artifacts if run is deleted
        onUpdate: 'CASCADE',
      });

      // ...or to one GPU job, for anything an inference or tracking run
      // produced. Exactly one of the two owners is set; a database check
      // constraint enforces that neither ends up null.
      this.belongsTo(models.gpu_jobs, {
        as: 'job',
        foreignKey: 'job_id',
        // Refused, not cleared: a result cannot outlive the record of what
        // produced it, and nulling the only owner this row has would breach
        // the check constraint in any case.
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }
  }

  artifacts.init(
    {
      id: {
        // Primary key
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this artifact record.',
      },

      training_run_id: {
        // Foreign key reference to the training run that produced it.
        // Nullable since an inference result has no training run behind it --
        // it belongs to a GPU job instead, through job_id below.
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Foreign key referencing the training run this artifact belongs to (training_runs.id). Null for an artifact produced by a GPU job.',
      },

      job_id: {
        // Foreign key reference to the GPU job that produced it
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Foreign key referencing the GPU job that produced this artifact (gpu_jobs.id). Null for an artifact produced by a training run.',
      },

      artifact_type: {
        // Describes what this artifact represents
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Type of artifact (e.g., "weights", "log", "results_plot", "confusion_matrix", "export").',
      },

      path: {
        // File path or URI to the artifact
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Filesystem path or URI to the artifact file or directory.',
      },

      size_mb: {
        // Approximate file size in megabytes
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'File size in megabytes, if available (useful for monitoring disk usage).',
      },

      hash: {
        // File checksum or hash for integrity verification
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Checksum or hash of the artifact file (e.g., SHA256) to verify integrity and detect duplicates.',
      },

      metadata: {
        // Optional JSON metadata (extra info like epoch, version, etc.)
        type: DataTypes.JSONB,
        allowNull: true,
        comment:
          'Optional JSON metadata with contextual information (e.g., epoch number, export format, or framework version).',
      },

      created_at: {
        // When the artifact was created
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this artifact record was created (typically when the file was generated).',
      },

      updated_at: {
        // When the record was last updated
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this artifact record was last updated.',
      },
    },
    {
      sequelize,                          // shared Sequelize connection instance
      modelName: 'artifacts',              // used inside Sequelize
      tableName: 'artifacts',              // actual PostgreSQL table
      schema: 'public',                    // database schema containing the table
      timestamps: false,                   // handled manually via created_at/updated_at
      comment:
        'Tracks files and outputs produced during a training run, including weights, logs, and result visualizations.',
      indexes: [
        {
          name: 'artifacts_pkey',                    // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'artifacts_training_run_id_idx',      // speeds up lookups by training run
          fields: ['training_run_id'],
        },
        {
          name: 'artifacts_job_id_idx',               // speeds up "what did this job produce"
          fields: ['job_id'],
        },
        {
          name: 'artifacts_artifact_type_idx',        // speeds up filtering by artifact type
          fields: ['artifact_type'],
        },
        {
          name: 'artifacts_path_idx',                 // speeds up lookups/dedup by file path
          fields: ['path'],
        },
      ],
    }
  );

  return artifacts;
};
