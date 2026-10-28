/**
 * Sequelize model definition for a training run's confusion matrix.
 *
 * One row per run per evaluated split, holding the counts the trainer produced as
 * numbers rather than only as the PNG it rendered. The picture is kept too -- it travels
 * as an artifact like every other plot -- but a picture cannot be re-bucketed, compared
 * between runs, or asked what a class is being confused with, and it is a
 * white-background render that sits wrong on a dark page.
 *
 * **It is stored in the producer's own orientation, which is named rather than
 * normalised.** Ultralytics increments `matrix[predicted][true]`, the transpose of how a
 * person reads a confusion matrix. `db/final-metrics.js` transposes once on the way out.
 * Rotating on the way in would bake today's convention into the record and make every
 * stored matrix silently wrong the day a producer changed it.
 *
 * **Nothing here is ever derived.** A matrix assembled from per-class precision and
 * recall is arithmetic dressed as a measurement, and the off-diagonal -- the only part
 * anybody actually looks at -- is exactly what a derivation cannot know. A run that
 * reported no matrix has no row, and the screen draws its empty state.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for a stored confusion matrix.
 * @module model/training_run_confusion_matrices
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     TrainingRunConfusionMatrix:
 *       type: object
 *       description: >
 *         The confusion matrix a training run's final validation produced, as counts.
 *         Served with rows as TRUE classes and columns as PREDICTED ones, which is how a
 *         reader reads one - note that this is the transpose of how Ultralytics indexes
 *         it internally. The background entry, where present, is a real outcome and is
 *         labelled rather than trimmed: it holds the misses and the false positives, and
 *         the row sums do not mean anything without it.
 *       required:
 *         - id
 *         - training_run_id
 *         - dataset_split
 *         - orientation
 *         - class_names
 *         - matrix
 *       properties:
 *         id:
 *           type: integer
 *           example: 17
 *           description: Unique identifier for this stored confusion matrix.
 *         training_run_id:
 *           type: integer
 *           example: 202
 *           description: The training run this matrix measures.
 *         dataset_split:
 *           type: string
 *           example: val
 *           description: >
 *             Which split was evaluated, as the worker stated it. Never inferred - the
 *             final evaluation happening to use the validation split is a fact about
 *             today's trainer, not something MARP may assert on its behalf.
 *         orientation:
 *           type: string
 *           enum: [rows_predicted_cols_true, rows_true_cols_predicted]
 *           description: How the STORED matrix is indexed, as its producer named it.
 *         class_names:
 *           type: array
 *           items:
 *             type: string
 *           example: ["Lingcod", "Rockfish"]
 *           description: >
 *             The class vocabulary in index order, as the axis is shown. A class index is
 *             meaningless without it. Where the model reported something other than a
 *             species name, this is MARP's reading of it and class_handles holds what it
 *             said.
 *         class_handles:
 *           type: array
 *           nullable: true
 *           items:
 *             type: string
 *           example: ["25_lingcod", "145_blue-deacon-rockfish"]
 *           description: >
 *             The axis labels exactly as the model reported them, kept only when they
 *             differ from class_names. A classification model names its classes after the
 *             dataset folders it was trained from, because a common name is not a
 *             filesystem-safe string - so the handle is the one route back to that
 *             directory in the archive, and is what the .pt itself contains. Null for
 *             every detection run, whose class names already are species names.
 *             Positional: same length and order as class_names, because both index the
 *             matrix axes.
 *         background_index:
 *           type: integer
 *           nullable: true
 *           example: 2
 *           description: >
 *             Index of the background row and column. Present for detection and
 *             segmentation, null for classification, which has no background class.
 *         matrix:
 *           type: array
 *           items:
 *             type: array
 *             items:
 *               type: number
 *           example: [[10, 3, 5], [1, 20, 7], [2, 4, 0]]
 *           description: The counts, square, exactly as the trainer produced them.
 */
const { Model } = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  class training_run_confusion_matrices extends Model {
    /**
     * Register relationships between a stored matrix and its training run.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // A matrix is not a fact about anything but its run.
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
      });
    }
  }

  training_run_confusion_matrices.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        comment:
          'Unique identifier for this stored confusion matrix.',
      },

      training_run_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'training_runs', key: 'id' },
        comment:
          'Foreign key referencing the training run this matrix measures (training_runs.id).',
      },

      dataset_split: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Which split was evaluated, as the worker stated it rather than as MARP inferred it.',
      },

      orientation: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'How the stored matrix is indexed, as its producer named it. Stored rather than normalised so that a producer changing convention says so, instead of every earlier row quietly becoming wrong.',
      },

      class_names: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment:
          'The class vocabulary in index order. A matrix without it cannot be read at all.',
      },

      background_index: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Index of the background row and column, or null for a task that has no background class. Kept rather than trimmed: it holds the false negatives and false positives.',
      },

      matrix: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment:
          'The counts, square, exactly as the trainer produced them. Never derived.',
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
      sequelize,
      modelName: 'training_run_confusion_matrices',
      tableName: 'training_run_confusion_matrices',
      schema: 'public',
      timestamps: false,
      comment:
        'The confusion matrix a training run produced, as counts rather than only as a rendered image.',
      indexes: [
        {
          name: 'training_run_confusion_matrices_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          // One matrix per run per split, so a re-reported result updates rather
          // than accumulating a second copy.
          name: 'training_run_confusion_matrices_run_split',
          unique: true,
          fields: ['training_run_id', 'dataset_split'],
        },
      ],
    }
  );

  return training_run_confusion_matrices;
};
