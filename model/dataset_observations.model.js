/**
 * Sequelize model definition for the dataset_observations join table.
 *
 * Defines the `dataset_observations` join table, which connects datasets
 * to the specific observations they include.
 *
 * Each record links one observation to one dataset, optionally recording
 * how that observation was chosen (e.g., manual, auto, or legacy import)
 * and whether it was used for training, validation, or testing.
 *
 * This table is central to reproducing datasets, verifying model training
 * inputs, and ensuring traceability between observations, datasets, and
 * resulting machine learning models.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for dataset_observations.
 * @author Isaac Assegai Travers
 * @module model/dataset_observations
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the dataset_observations Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the datasets and
 * observations models through {@link dataset_observations.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized dataset_observations model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one dataset-observation join record.
   *
   * Many-to-many relationship table linking datasets and observations.
   * Includes selection metadata for auditing and reproducibility.
   *
   * @class dataset_observations
   * @extends Model
   */
  class dataset_observations extends Model {
    /**
     * Register relationships between dataset_observations and related
     * models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
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
        jsonSchema: {
            description: 'Unique identifier for this dataset-observation record.',
            examples: [512],
        },
      },

      dataset_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the dataset that includes this observation (datasets.id).',
        jsonSchema: {
            description: 'Foreign key referencing the dataset that includes this observation (datasets.id).',
            examples: [3],
        },
      },

      observation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the observation included in this dataset (observations.observation_id).',
        jsonSchema: {
            description: 'Foreign key referencing the observation included in this dataset (observations.observation_id).',
            examples: [918],
        },
      },

      inclusion_type: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Indicates how this observation is used in the dataset: "train", "val", or "test".',
        jsonSchema: {
            description: 'Indicates how this observation is used in the dataset ("train", "val", or "test").',
            examples: ['train'],
        },
      },

      selection_method: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Describes how this observation was chosen for inclusion (e.g., "manual", "auto", "random_sample", "legacy_import").',
        jsonSchema: {
            description: 'Describes how this observation was chosen for inclusion (e.g., "manual", "auto", "random_sample", "legacy_import").',
            examples: ['manual'],
        },
      },

      weight: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Optional weighting factor applied to this observation within the dataset for class balancing or sampling probability.',
        jsonSchema: {
            description: 'Optional weighting factor applied to this observation within the dataset for class balancing or sampling probability.',
        },
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes about this dataset-observation inclusion (e.g., reasons for inclusion/exclusion, data quality remarks).',
        jsonSchema: {
            description: 'Freeform notes about this dataset-observation inclusion (e.g., reasons for inclusion/exclusion, data quality remarks).',
        },
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this dataset-observation record was created.',
        jsonSchema: {
            description: 'Timestamp when this dataset-observation record was created.',
        },
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this dataset-observation record was last updated.',
        jsonSchema: {
            description: 'Timestamp when this dataset-observation record was last updated.',
        },
      },
    },
    {
      sequelize,                                  // shared Sequelize connection instance
      modelName: 'dataset_observations',           // used inside Sequelize
      tableName: 'dataset_observations',           // actual table name in PostgreSQL
      schema: 'public',                            // database schema containing the table
      timestamps: false,                           // we manage created_at/updated_at manually
      comment:
        'Join table linking datasets and observations, including inclusion type and selection metadata for traceability.',
      indexes: [
        {
          name: 'dataset_observations_pkey',                 // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'dataset_observations_dataset_id_idx',       // speeds up lookups by dataset
          fields: ['dataset_id'],
        },
        {
          name: 'dataset_observations_observation_id_idx',   // speeds up lookups by observation
          fields: ['observation_id'],
        },
        {
          name: 'dataset_observations_unique_dataset_observation', // enforces one record per dataset-observation pair
          unique: true,
          fields: ['dataset_id', 'observation_id'],
        },
      ],
    }
  );

  return dataset_observations;
};
