/**
 * ===================================================================
 * File: training_run.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `training_runs` table, which represents each distinct
 * training or retraining event of a machine learning model.
 * Each record links to:
 *   - the model being trained (`ml_models`)
 *   - the dataset used (`datasets`)
 *   - performance results (via `epochs`, `metrics_summary`, etc.)
 *
 * Tracks training configuration, duration, and runtime environment.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: training_runs
   * ----------------------------------------------------------------
   * Stores metadata for each training or retraining event, including
   * dataset association, compute parameters, and execution details.
   */
  class training_runs extends Model {
    /**
     * Define associations between models.
     * Executed automatically in init-models.js
     */
    static associate(models) {
      // Each training run belongs to a single ML model
      this.belongsTo(models.ml_models, {
        as: 'ml_model',
        foreignKey: 'model_id',
      });

      // Each training run uses one dataset
      this.belongsTo(models.datasets, {
        as: 'dataset',
        foreignKey: 'dataset_id',
      });

      // One training run can have many epochs
      this.hasMany(models.epochs, {
        as: 'epochs',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',
      });

      // One training run can have many metrics summaries
      this.hasMany(models.metrics_summary, {
        as: 'metrics_summaries',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',
      });

      // One training run can have one hyperparameter record
      this.hasOne(models.hyperparameters, {
        as: 'hyperparameters',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',
      });

      // One training run can have many artifacts
      this.hasMany(models.artifacts, {
        as: 'artifacts',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE',
      });
    }
  }

  training_runs.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this training run.',
      },

      model_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the parent ML model (ml_models.id).',
      },

      dataset_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Foreign key referencing the dataset used for training (datasets.id).',
      },

      start_time: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when training began.',
      },

      end_time: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when training completed.',
      },

      total_epochs: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Total number of epochs configured for this run.',
      },

      batch_size: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Training batch size used during this run.',
      },

      learning_rate: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: 'Base learning rate used during training.',
      },

      optimizer: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Optimization algorithm (e.g., "Adam", "SGD").',
      },

      loss_function: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Loss function used (e.g., "CrossEntropy", "FocalLoss").',
      },

      augmentation: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'JSON object containing data augmentation parameters and settings.',
      },

      compute_device: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Hardware used for training (e.g., "RTX 6000 Ada", "A100 GPU").',
      },

      train_script_commit: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Git commit hash or version identifier of the training script used.',
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Freeform notes describing experiment purpose or results context.',
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Timestamp when this record was created.',
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Timestamp when this record was last modified.',
      },
    },
    {
      sequelize,
      modelName: 'training_runs',    // used in Sequelize
      tableName: 'training_runs',    // actual PostgreSQL table
      schema: 'public',
      timestamps: false,
      comment:
        'Records each machine learning training or retraining event within MARP.',
      indexes: [
        {
          name: 'training_runs_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'training_runs_model_id_idx',
          fields: ['model_id'],
        },
        {
          name: 'training_runs_dataset_id_idx',
          fields: ['dataset_id'],
        },
        {
          name: 'training_runs_start_time_idx',
          fields: ['start_time'],
        },
      ],
    }
  );

  return training_runs;
};