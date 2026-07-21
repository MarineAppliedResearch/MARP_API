/**
 * ===================================================================
 * File: metrics_curves.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `metrics_curves` table, which stores per-confidence
 * threshold performance metrics (precision, recall, F1 score) used
 * for visualizing detailed model evaluation curves.
 *
 * Each record corresponds to a single confidence threshold point
 * within a metrics summary (train, val, or test split).
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: metrics_curves
   * ----------------------------------------------------------------
   * Stores precision/recall/F1 data per confidence threshold for
   * each metrics summary record.
   */
  class metrics_curves extends Model {
    static associate(models) {
      // Each metrics curve point belongs to one summary
      this.belongsTo(models.metrics_summary, {
        as: 'metrics_summary',
        foreignKey: 'metrics_summary_id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }
  }

  metrics_curves.init(
    {
      id: {
        // Primary key for the curve record
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this metrics curve data point.',
      },

      metrics_summary_id: {
        // Foreign key reference to the summary entry
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the metrics summary record (metrics_summary.id) this curve point belongs to.',
      },

      species_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'species', key: 'id' },
        comment:
          'Foreign key referencing the species this summary applies to. NULL means it represents an aggregate across all species.'
      },

      confidence_threshold: {
        // Confidence threshold value for this metric point (0.0–1.0)
        type: DataTypes.FLOAT,
        allowNull: false,
        comment:
          'Confidence threshold (between 0.0 and 1.0) at which these metrics were measured.',
      },

      precision: {
        // Precision at this confidence threshold
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Model precision value computed at this confidence threshold.',
      },

      recall: {
        // Recall at this confidence threshold
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Model recall value computed at this confidence threshold.',
      },

      f1_score: {
        // F1 score at this confidence threshold
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Model F1 score computed at this confidence threshold.',
      },

      support: {
        // Number of detections contributing to these metrics
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Number of predictions or detections evaluated at this confidence threshold.',
      },

      created_at: {
        // Record creation timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this metrics curve record was created.',
      },

      updated_at: {
        // Record update timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this metrics curve record was last updated.',
      },
    },
    {
      sequelize,
      modelName: 'metrics_curves',
      tableName: 'metrics_curves',
      schema: 'public',
      timestamps: false,
      comment:
        'Stores precision/recall/F1 metrics per confidence threshold for each dataset split summary.',
      indexes: [
        {
          name: 'metrics_curves_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'metrics_curves_summary_id_idx',
          fields: ['metrics_summary_id'],
        },
        {
          name: 'metrics_curves_confidence_idx',
          fields: ['confidence_threshold'],
        },
      ],
    }
  );

  return metrics_curves;
};