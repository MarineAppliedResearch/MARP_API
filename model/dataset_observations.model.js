/**
 * ===================================================================
 * File: dataset_observations.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `dataset_observations` join table, which connects
 * datasets to the specific observations they include.
 *
 * Each record links one observation to one dataset, optionally
 * recording how that observation was chosen (e.g., manual, auto, or
 * legacy import) and whether it was used for training, validation,
 * or testing.
 *
 * This table is central to reproducing datasets, verifying model
 * training inputs, and ensuring traceability between observations,
 * datasets, and resulting machine learning models.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: dataset_observations
   * ----------------------------------------------------------------
   * Many-to-many relationship table linking datasets and observations.
   * Includes selection metadata for auditing and reproducibility.
   */
  class dataset_observations extends Model {
    static associate(models) {
      // A dataset-observation record belongs to one dataset
      this.belongsTo(models.datasets, {
        as: 'dataset',
        foreignKey: 'dataset_id',
        onDelete: 'CASCADE', // Only remove join records if dataset is deleted
        onUpdate: 'CASCADE',
      });

      // A dataset-observation record belongs to one observation
      this.belongsTo(models.observations, {
        as: 'observation',
        foreignKey: 'observation_id',
        onDelete: 'CASCADE', // Only remove join records if observation is deleted
        onUpdate: 'CASCADE',
      });
    }
  }

  dataset_observations.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this dataset-observation record.',
      },

      dataset_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the dataset that includes this observation (datasets.id).',
      },

      observation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the observation included in this dataset (observations.observation_id).',
      },

      inclusion_type: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Indicates how this observation is used in the dataset: "train", "val", or "test".',
      },

      selection_method: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Describes how this observation was chosen for inclusion (e.g., "manual", "auto", "random_sample", "legacy_import").',
      },

      weight: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Optional weighting factor applied to this observation within the dataset for class balancing or sampling probability.',
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes about this dataset-observation inclusion (e.g., reasons for inclusion/exclusion, data quality remarks).',
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this dataset-observation record was created.',
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this dataset-observation record was last updated.',
      },
    },
    {
      sequelize,
      modelName: 'dataset_observations',
      tableName: 'dataset_observations',
      schema: 'public',
      timestamps: false,
      comment:
        'Join table linking datasets and observations, including inclusion type and selection metadata for traceability.',
      indexes: [
        {
          name: 'dataset_observations_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'dataset_observations_dataset_id_idx',
          fields: ['dataset_id'],
        },
        {
          name: 'dataset_observations_observation_id_idx',
          fields: ['observation_id'],
        },
        {
          name: 'dataset_observations_unique_dataset_observation',
          unique: true,
          fields: ['dataset_id', 'observation_id'],
        },
      ],
    }
  );

  return dataset_observations;
};