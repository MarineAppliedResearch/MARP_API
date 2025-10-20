/**
 * ===================================================================
 * File: artifacts.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-07
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `artifacts` table, which tracks all output files
 * generated during a training run. This includes model weights,
 * logs, plots, result summaries, exported formats, and more.
 *
 * Each artifact record stores metadata such as file path, size,
 * hash (checksum), and creation timestamp to ensure reproducibility
 * and data integrity across runs.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: artifacts
   * ----------------------------------------------------------------
   * Stores metadata for files and other outputs generated during
   * a machine learning training run.
   */
  class artifacts extends Model {
    static associate(models) {
      // Each artifact belongs to one training run
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',  // Remove artifacts if run is deleted
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
        // Foreign key reference to the training run that produced it
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the training run this artifact belongs to (training_runs.id).',
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
      sequelize,
      modelName: 'artifacts',
      tableName: 'artifacts',
      schema: 'public',
      timestamps: false,
      comment:
        'Tracks files and outputs produced during a training run, including weights, logs, and result visualizations.',
      indexes: [
        {
          name: 'artifacts_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'artifacts_training_run_id_idx',
          fields: ['training_run_id'],
        },
        {
          name: 'artifacts_artifact_type_idx',
          fields: ['artifact_type'],
        },
        {
          name: 'artifacts_path_idx',
          fields: ['path'],
        },
      ],
    }
  );

  return artifacts;
};
