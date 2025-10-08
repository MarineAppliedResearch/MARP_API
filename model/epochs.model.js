/**
 * ===================================================================
 * File: epoch.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `epochs` table, which stores per-epoch performance
 * statistics and timing information for each training run.
 *
 * Each record represents one complete epoch during training,
 * including start/end times, loss metrics, and precision/recall/mAP.
 *
 * This table supports training visualization, performance analysis,
 * and historical comparison of model training behavior.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: epochs
   * ----------------------------------------------------------------
   * Tracks the performance and timing of each training epoch.
   * Each epoch belongs to a specific training run.
   */
  class epochs extends Model {
    static associate(models) {
      // Each epoch belongs to one training run
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
      });
    }
  }

  epochs.init(
    {
      id: {
        // Primary key for the epoch record
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this epoch record.',
      },

      training_run_id: {
        // Foreign key to the parent training run
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key linking this epoch to its parent training run (training_runs.id).',
      },

      epoch_number: {
        // Sequential number of the epoch (e.g., 1, 2, 3 ...)
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'The ordinal number of this epoch in the training sequence.',
      },

      // -------------------------------
      // TIMING INFORMATION
      // -------------------------------

      start_time: {
        // When the epoch started (captured by the trainer)
        type: DataTypes.DATE,
        allowNull: true,
        comment:
          'Timestamp marking when this epoch began processing.',
      },

      end_time: {
        // When the epoch finished
        type: DataTypes.DATE,
        allowNull: true,
        comment:
          'Timestamp marking when this epoch completed.',
      },

      duration_seconds: {
        // Optional precomputed field for performance analysis
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Total elapsed time of this epoch, in seconds (end_time - start_time).',
      },

      // -------------------------------
      // PERFORMANCE METRICS
      // -------------------------------

      precision: {
        // Model precision for this epoch — fraction of true positives among predicted positives
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Precision metric value recorded at the end of this epoch.',
      },

      recall: {
        // Model recall for this epoch — fraction of true positives among all actual positives
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Recall metric value recorded at the end of this epoch.',
      },

      map50: {
        // Mean Average Precision at IoU threshold 0.5
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean Average Precision (mAP) at 0.5 IoU threshold for this epoch.',
      },

      map5095: {
        // Mean Average Precision averaged across IoU thresholds 0.5:0.95
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean Average Precision (mAP) averaged across IoU thresholds 0.5–0.95 for this epoch.',
      },

      // -------------------------------
      // LOSS METRICS
      // -------------------------------

      box_loss: {
        // Bounding box regression loss
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Loss associated with bounding box coordinate regression during this epoch.',
      },

      cls_loss: {
        // Classification loss
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Loss associated with class label predictions during this epoch.',
      },

      dfl_loss: {
        // Distribution Focal Loss (YOLOv8 and related architectures)
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Distribution Focal Loss (DFL) for this epoch, if applicable to the model type.',
      },

      timestamp: {
        // Optional: record when this epoch was logged
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this epoch record was inserted into the database.',
      },

      created_at: {
        // Record creation timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this epoch record was created.',
      },

      updated_at: {
        // Record update timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this epoch record was last updated.',
      },
    },
    {
      sequelize,
      modelName: 'epochs',
      tableName: 'epochs',
      schema: 'public',
      timestamps: false, // we manage created_at/updated_at manually
      comment:
        'Stores per-epoch performance and timing metrics for each training run in the MARP ML system.',
      indexes: [
        {
          name: 'epochs_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'epochs_training_run_id_idx',
          fields: ['training_run_id'],
        },
        {
          name: 'epochs_epoch_number_idx',
          fields: ['epoch_number'],
        },
        {
          name: 'epochs_start_time_idx',
          fields: ['start_time'],
        },
      ],
    }
  );

  return epochs;
};