/**
 * Sequelize model definition for the metrics_summary evaluation table.
 *
 * Defines the `metrics_summary` table, which stores aggregated performance
 * metrics for each dataset split ("train", "val", "test") produced by a
 * given training run. Each record represents the summary statistics of a
 * specific split, including precision, recall, F1 score, and mean average
 * precision (mAP), along with paths to generated visualization artifacts
 * (confusion matrices, PR/F1/label curves, etc.) and optional per-class
 * detail.
 *
 * This table enables comparison of training and validation performance
 * across models and runs, and links to fine-grained per-threshold data in
 * `metrics_curves`.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for metrics_summary.
 * @author Isaac Assegai Travers
 * @module model/metrics_summary
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     MetricsSummary:
 *       type: object
 *       description: >
 *         Aggregated evaluation metrics for a single dataset split
 *         (train/val/test) within a training run, including paths to
 *         generated visualization artifacts and optional per-class detail.
 *       required:
 *         - id
 *         - training_run_id
 *         - dataset_split
 *       properties:
 *         id:
 *           type: integer
 *           example: 501
 *           description: Unique identifier for this metrics summary record.
 *         training_run_id:
 *           type: integer
 *           example: 12
 *           description: Foreign key referencing the training run this metrics summary belongs to (training_runs.id).
 *         species_id:
 *           type: integer
 *           nullable: true
 *           description: Foreign key referencing the species this summary applies to. NULL means it represents an aggregate across all species.
 *         dataset_split:
 *           type: string
 *           enum: [train, val, test]
 *           description: Specifies which dataset split these metrics apply to - "train", "val", or "test".
 *         precision:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Aggregate precision achieved for this dataset split.
 *         recall:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Aggregate recall achieved for this dataset split.
 *         map50:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Mean Average Precision (mAP) at 0.5 IoU threshold for this split.
 *         map5095:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Mean Average Precision (mAP) averaged over IoU thresholds 0.5-0.95.
 *         fitness:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Weighted performance score used by YOLO to rank model checkpoints.
 *         f1_score:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Aggregate F1 score for this dataset split, typically computed from precision and recall.
 *         confusion_matrix_path:
 *           type: string
 *           nullable: true
 *           description: Filesystem path or URI to the confusion matrix image generated for this dataset split.
 *         result_plot_path:
 *           type: string
 *           nullable: true
 *           description: Filesystem path or URI to the overall results plot (e.g., PR or F1 curves) for this dataset split.
 *         confusion_matrix_norm_path:
 *           type: string
 *           nullable: true
 *           description: Path to the normalized confusion matrix plot image generated during evaluation.
 *         box_f1_curve_path:
 *           type: string
 *           nullable: true
 *           description: Path to the F1 vs confidence curve plot image.
 *         box_p_curve_path:
 *           type: string
 *           nullable: true
 *           description: Path to the precision vs confidence curve plot image.
 *         box_pr_curve_path:
 *           type: string
 *           nullable: true
 *           description: Path to the precision-recall (PR) curve plot image.
 *         box_r_curve_path:
 *           type: string
 *           nullable: true
 *           description: Path to the recall vs confidence curve plot image.
 *         labels_plot_path:
 *           type: string
 *           nullable: true
 *           description: Path to the label distribution plot image showing class balance in the dataset.
 *         details:
 *           type: object
 *           nullable: true
 *           additionalProperties: true
 *           description: Optional JSON blob storing additional data arrays (e.g., per-class metrics or PR/F1-confidence points).
 *         timestamp:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Timestamp when this metrics summary was created or finalized.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Record creation timestamp.
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Record last update timestamp.
 */

/**
 * Create and initialize the metrics_summary Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the training_runs and
 * metrics_curves models through {@link metrics_summary.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized metrics_summary model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one aggregated evaluation-metrics record.
   *
   * Aggregated evaluation results for each dataset split within a training
   * run. Linked to `metrics_curves` for detailed per-threshold curves.
   *
   * @class metrics_summary
   * @extends Model
   */
  class metrics_summary extends Model {

    /**
     * Register relationships between metrics_summary and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Each summary belongs to one training run
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });

      // One summary can have many fine-grained metric curves
      this.hasMany(models.metrics_curves, {
        as: 'curves',
        foreignKey: 'metrics_summary_id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }
  }

  metrics_summary.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this metrics summary record.',
      },

      training_run_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the training run this metrics summary belongs to (training_runs.id).',
      },

      species_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'species', key: 'id' },
        comment:
          'Foreign key referencing the species this summary applies to. NULL means it represents an aggregate across all species.'
      },

      dataset_split: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Specifies which dataset split these metrics apply to: "train", "val", or "test".',
      },

      precision: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Aggregate precision achieved for this dataset split.',
      },

      recall: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Aggregate recall achieved for this dataset split.',
      },

      map50: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean Average Precision (mAP) at 0.5 IoU threshold for this split.',
      },

      map5095: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean Average Precision (mAP) averaged over IoU thresholds 0.5–0.95.',
      },

      fitness: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: 'Weighted performance score used by YOLO to rank model checkpoints.'
      },

      f1_score: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Aggregate F1 score for this dataset split, typically computed from precision and recall.',
      },

      confusion_matrix_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Filesystem path or URI to the confusion matrix image generated for this dataset split.',
      },

      result_plot_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Filesystem path or URI to the overall results plot (e.g., PR or F1 curves) for this dataset split.',
      },

      confusion_matrix_norm_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to the normalized confusion matrix plot image generated during evaluation.'
      },

      box_f1_curve_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to the F1 vs confidence curve plot image.'
      },

      box_p_curve_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to the precision vs confidence curve plot image.'
      },

      box_pr_curve_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to the precision–recall (PR) curve plot image.'
      },

      box_r_curve_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to the recall vs confidence curve plot image.'
      },

      labels_plot_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path to the label distribution plot image showing class balance in the dataset.'
      },

      details: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment:
          'Optional JSON object storing additional data arrays (e.g., per-class metrics or PR/F1-confidence points).',
      },

      timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this metrics summary was created or finalized.',
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Record creation timestamp.',
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Record last update timestamp.',
      },
    },
    {
      sequelize,                      // shared Sequelize connection instance
      modelName: 'metrics_summary',   // used inside Sequelize
      tableName: 'metrics_summary',   // actual PostgreSQL table
      schema: 'public',               // database schema containing the table
      timestamps: false,              // handled manually via created_at/updated_at
      comment:
        'Aggregated per-split (train/val/test) evaluation metrics for each training run, linked to detailed metric curves.',
      indexes: [
        {
          name: 'metrics_summary_pkey',              // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'metrics_summary_training_run_id_idx', // speeds up lookups by training run
          fields: ['training_run_id'],
        },
        {
          name: 'metrics_summary_split_idx',          // speeds up filtering by dataset split
          fields: ['dataset_split'],
        },
      ],
    }
  );

  return metrics_summary;
};
