/**
 * Sequelize model definition for the metrics_curves detail table.
 *
 * Defines the `metrics_curves` table, which stores per-confidence-threshold
 * performance metrics (precision, recall, F1 score, support) used for
 * visualizing detailed model evaluation curves. Each record corresponds to
 * a single confidence-threshold point within a parent `metrics_summary`
 * record (train, val, or test split).
 *
 * This table lets the MARP GUI and reporting tools plot precision/recall/F1
 * trade-off curves across the full confidence range for a given evaluation.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for metrics_curves.
 * @author Isaac Assegai Travers
 * @module model/metrics_curves
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     MetricsCurve:
 *       type: object
 *       description: >
 *         A single confidence-threshold data point (precision, recall, F1,
 *         support) belonging to a metrics_summary record, used to plot
 *         detailed evaluation curves.
 *       required:
 *         - id
 *         - metrics_summary_id
 *         - confidence_threshold
 *       properties:
 *         id:
 *           type: integer
 *           example: 9001
 *           description: Unique identifier for this metrics curve data point.
 *         metrics_summary_id:
 *           type: integer
 *           example: 501
 *           description: Foreign key referencing the metrics summary record (metrics_summary.id) this curve point belongs to.
 *         species_id:
 *           type: integer
 *           nullable: true
 *           description: Foreign key referencing the species this summary applies to. NULL means it represents an aggregate across all species.
 *         species:
 *           allOf:
 *             - $ref: '#/components/schemas/Species'
 *           nullable: true
 *           description: Optional associated species record when this curve point is scoped to one species.
 *         confidence_threshold:
 *           type: number
 *           format: float
 *           example: 0.25
 *           description: Confidence threshold (between 0.0 and 1.0) at which these metrics were measured.
 *         precision:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Model precision value computed at this confidence threshold.
 *         recall:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Model recall value computed at this confidence threshold.
 *         f1_score:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Model F1 score computed at this confidence threshold.
 *         support:
 *           type: integer
 *           nullable: true
 *           description: Number of predictions or detections evaluated at this confidence threshold.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this metrics curve record was created.
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this metrics curve record was last updated.
 */

/**
 * Create and initialize the metrics_curves Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the metrics_summary model
 * through {@link metrics_curves.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized metrics_curves model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one confidence-threshold metrics data point.
   *
   * Stores precision/recall/F1 data per confidence threshold for each
   * metrics_summary record, used to render evaluation curves.
   *
   * @class metrics_curves
   * @extends Model
   */
  class metrics_curves extends Model {

    /**
     * Register relationships between metrics_curves and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Each metrics curve point belongs to one summary
      this.belongsTo(models.metrics_summary, {
        as: 'metrics_summary',
        foreignKey: 'metrics_summary_id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      // A curve point may optionally describe one specific species.
      this.belongsTo(models.species, {
        as: 'species',
        foreignKey: 'species_id',
        onDelete: 'SET NULL',
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
      sequelize,                       // shared Sequelize connection instance
      modelName: 'metrics_curves',      // used inside Sequelize
      tableName: 'metrics_curves',      // actual PostgreSQL table
      schema: 'public',                 // database schema containing the table
      timestamps: false,                // handled manually via created_at/updated_at
      comment:
        'Stores precision/recall/F1 metrics per confidence threshold for each dataset split summary.',
      indexes: [
        {
          name: 'metrics_curves_pkey',              // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'metrics_curves_summary_id_idx',     // speeds up lookups by parent summary
          fields: ['metrics_summary_id'],
        },
        {
          name: 'metrics_curves_confidence_idx',     // speeds up lookups/sorting by threshold
          fields: ['confidence_threshold'],
        },
      ],
    }
  );

  return metrics_curves;
};
