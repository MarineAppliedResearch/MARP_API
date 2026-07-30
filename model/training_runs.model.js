/**
 * Sequelize model definition for the training_runs table.
 *
 * Defines the `training_runs` table, which represents each distinct
 * training or retraining event of a machine learning model. Each record
 * links to:
 *   - the model being trained (`ml_models`)
 *   - the dataset used (`datasets`)
 *   - performance results (via `epochs`, `metrics_summary`, etc.)
 *
 * Tracks training configuration, duration, and runtime environment as
 * part of the MARP Machine Learning Database Schema.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for training_runs.
 * @author Isaac Assegai Travers
 * @module model/training_runs
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the training_runs Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the ml_models, datasets,
 * epochs, metrics_summary, hyperparameters, and artifacts models through
 * {@link training_runs.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized training_runs model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one training or retraining event of an
   * ML model.
   *
   * Stores metadata for each training or retraining event, including
   * dataset association, compute parameters, and execution details.
   *
   * @class training_runs
   * @extends Model
   */
  class training_runs extends Model {
    /**
     * Register relationships between training_runs and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
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
        jsonSchema: {
            readOnly: true,
            description: 'Unique identifier for this training run.',
            examples: [12],
        },
      },

      model_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the parent ML model (ml_models.id).',
        jsonSchema: {
            description: 'Foreign key referencing the parent ML model (ml_models.id).',
            examples: [7],
        },
      },

      dataset_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Foreign key referencing the dataset used for training (datasets.id).',
        jsonSchema: {
            description: 'Foreign key referencing the dataset used for training (datasets.id).',
            examples: [3],
        },
      },

      start_time: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when training began.',
        jsonSchema: {
            description: 'Timestamp when training began.',
        },
      },

      end_time: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when training completed.',
        jsonSchema: {
            description: 'Timestamp when training completed.',
        },
      },

      total_epochs: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Total number of epochs configured for this run.',
        jsonSchema: {
            schema: { type: 'integer', minimum: 1 },
            description: 'Total number of epochs configured for this run.',
            examples: [120],
        },
      },

      batch_size: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Training batch size used during this run.',
        jsonSchema: {
            schema: { type: 'integer', minimum: 1 },
            description: 'Training batch size used during this run.',
            examples: [16],
        },
      },

      learning_rate: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: 'Base learning rate used during training.',
        jsonSchema: {
            schema: { type: 'number', format: 'float', minimum: 0 },
            description: 'Base learning rate used during training.',
            examples: [0.001],
        },
      },

      optimizer: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Optimization algorithm (e.g., "Adam", "SGD").',
        jsonSchema: {
            description: 'Optimization algorithm (e.g., "Adam", "SGD").',
            examples: ['Adam'],
        },
      },

      loss_function: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Loss function used (e.g., "CrossEntropy", "FocalLoss").',
        jsonSchema: {
            description: 'Loss function used (e.g., "CrossEntropy", "FocalLoss").',
            examples: ['FocalLoss'],
        },
      },

      augmentation: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'JSON object containing data augmentation parameters and settings.',
        jsonSchema: {
            schema: { type: 'object', additionalProperties: true },
            description: 'JSON blob containing data augmentation parameters and settings applied during this run. Keys vary by training pipeline.',
        },
      },

      compute_device: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Hardware used for training (e.g., "RTX 6000 Ada", "A100 GPU").',
        jsonSchema: {
            description: 'Hardware used for training (e.g., "RTX 6000 Ada", "A100 GPU").',
            examples: ['RTX 6000 Ada'],
        },
      },

      train_script_commit: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Git commit hash or version identifier of the training script used.',
        jsonSchema: {
            description: 'Git commit hash or version identifier of the training script used.',
            examples: ['3d9a0a91e7fa3b9f4c1f8f46cb2fda32729d8f1a'],
        },
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Freeform notes describing experiment purpose or results context.',
        jsonSchema: {
            description: 'Freeform notes describing experiment purpose or results context.',
            examples: ['Best mAP50 observed around epoch 98; monitor overfitting after 110.'],
        },
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Timestamp when this record was created.',
        jsonSchema: {
            readOnly: true,
            description: 'Timestamp when this record was created.',
        },
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Timestamp when this record was last modified.',
        jsonSchema: {
            readOnly: true,
            description: 'Timestamp when this record was last modified.',
        },
      },
    },
    {
      sequelize,                     // shared Sequelize connection instance
      modelName: 'training_runs',    // used in Sequelize
      tableName: 'training_runs',    // actual PostgreSQL table
      schema: 'public',              // database schema containing the table
      timestamps: false,             // handled manually via created_at/updated_at
      comment:
        'Records each machine learning training or retraining event within MARP.',
      indexes: [
        {
          name: 'training_runs_pkey',            // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'training_runs_model_id_idx',    // speeds up lookups by ML model
          fields: ['model_id'],
        },
        {
          name: 'training_runs_dataset_id_idx',  // speeds up lookups by dataset
          fields: ['dataset_id'],
        },
        {
          name: 'training_runs_start_time_idx',  // speeds up chronological queries
          fields: ['start_time'],
        },
      ],
    }
  );

  return training_runs;
};