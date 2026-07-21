/**
 * ===================================================================
 * File: hyperparameters.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-07-10
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `hyperparameters` table, which stores the full
 * hyperparameter configuration used for a specific training run.
 *
 * Each record contains a JSON object describing model training
 * parameters such as learning rate, batch size, optimizer type,
 * momentum, weight decay, and augmentation options.
 *
 * This ensures reproducibility of training conditions and allows
 * comparison between runs using different settings.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: hyperparameters
   * ----------------------------------------------------------------
   * Each record represents one hyperparameter configuration
   * associated with a specific training run.
   */
  class hyperparameters extends Model {
    static associate(models) {
      // Each hyperparameter set belongs to one training run
      this.belongsTo(models.training_runs, {
        as: 'training_run',
        foreignKey: 'training_run_id',
        onDelete: 'CASCADE', // If the training run is removed, delete config
        onUpdate: 'CASCADE',
      });
    }
  }

  hyperparameters.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this hyperparameter configuration.',
      },

      training_run_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the training run this hyperparameter set belongs to (training_runs.id).',
      },

      params: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment:
          'JSON object containing all hyperparameters used for this training run (e.g., lr0, momentum, epochs, etc.).',
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this hyperparameter record was created.',
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this hyperparameter record was last updated.',
      },
    },
    {
      sequelize,
      modelName: 'hyperparameters',
      tableName: 'hyperparameters',
      schema: 'public',
      timestamps: false,
      comment:
        'Stores full hyperparameter configurations for each training run to ensure reproducibility and comparability.',
      indexes: [
        {
          name: 'hyperparameters_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'hyperparameters_training_run_id_idx',
          fields: ['training_run_id'],
        },
      ],
    }
  );

  return hyperparameters;
};