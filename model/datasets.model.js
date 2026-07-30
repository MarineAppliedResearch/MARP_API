/**
 * Sequelize model definition for the datasets table.
 *
 * Defines the `datasets` table, which represents a curated set of
 * observations and keyframes used for machine learning training,
 * validation, or testing.
 *
 * Each dataset aggregates a subset of observations, typically drawn from
 * ROV survey sessions, and may be reused across multiple training runs.
 * Datasets are linked to observations via the `dataset_observations` join
 * table.
 *
 * Note:
 * Species are not directly linked yet — they are derived implicitly
 * through observations (by comname). Once the observation table is
 * normalized with a `species_id`, that linkage will propagate
 * automatically.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for datasets.
 * @author Isaac Assegai Travers
 * @module model/datasets
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the datasets Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the observations and
 * training_runs models through {@link datasets.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized datasets model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one curated dataset of observations.
   *
   * Stores metadata about a dataset used for model training, such as
   * its name, size, source, and purpose. Each dataset can be used by
   * multiple training runs and can contain many observations.
   *
   * @class datasets
   * @extends Model
   */
  class datasets extends Model {
    /**
     * Register relationships between datasets and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Many-to-many: datasets ↔ observations
      this.belongsToMany(models.observations, {
        through: models.dataset_observations,
        as: 'observations',
        foreignKey: 'dataset_id',
        otherKey: 'observation_id',
      });

      // One-to-many: datasets → training_runs
      this.hasMany(models.training_runs, {
        as: 'training_runs',
        foreignKey: 'dataset_id',
        onDelete: 'SET NULL',
      });
    }
  }

  datasets.init(
    {
      id: {
        // Primary key for this dataset
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique identifier for this dataset record.',
        jsonSchema: {
            description: 'Unique identifier for this dataset record.',
            examples: [3],
        },
      },

      name: {
        // Human-readable dataset name (e.g., "Fish_2024_Training_Set_v1")
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Descriptive name of this dataset.',
        jsonSchema: {
            description: 'Descriptive name of this dataset.',
            examples: ['Fish_2024_Training_Set_v1'],
        },
      },

      description: {
        // Freeform text explaining what the dataset is or how it was built
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Detailed description or notes about the dataset’s purpose and composition.',
        jsonSchema: {
            description: "Detailed description or notes about the dataset's purpose and composition.",
        },
      },

      location: {
        // Directory or URI path to where dataset files are stored
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Filesystem or network location of the dataset resources.',
        jsonSchema: {
            description: 'Filesystem or network location of the dataset resources.',
        },
      },

      num_samples: {
        // Number of image or video samples in this dataset
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Total number of samples (images, frames, or observations) included in this dataset.',
        jsonSchema: {
            description: 'Total number of samples (images, frames, or observations) included in this dataset.',
        },
      },

      num_classes: {
        // Number of unique species/classes represented
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Approximate number of unique classes (species) represented in this dataset (derived from observation comnames).',
        jsonSchema: {
            description: 'Approximate number of unique classes (species) represented in this dataset (derived from observation comnames).',
        },
      },

      source: {
        // Indicates where the dataset originated
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Source or method of dataset creation (e.g., "auto-compiled", "manual curation", "legacy import").',
        jsonSchema: {
            description: 'Source or method of dataset creation (e.g., "auto-compiled", "manual curation", "legacy import").',
            examples: ['auto-compiled'],
        },
      },

      notes: {
        // Additional comments or contextual notes
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'General notes about dataset preparation, inclusion criteria, or issues.',
        jsonSchema: {
            description: 'General notes about dataset preparation, inclusion criteria, or issues.',
        },
      },

      created_at: {
        // When this dataset record was created
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Timestamp when this dataset record was created.',
        jsonSchema: {
            description: 'Timestamp when this dataset record was created.',
        },
      },

      updated_at: {
        // When this dataset record was last modified
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Timestamp when this dataset record was last updated.',
        jsonSchema: {
            description: 'Timestamp when this dataset record was last updated.',
        },
      },
    },
    {
      sequelize,                    // shared Sequelize connection instance
      modelName: 'datasets',        // internal Sequelize model name
      tableName: 'datasets',        // PostgreSQL table name
      schema: 'public',             // database schema containing the table
      timestamps: false,            // we manage created_at/updated_at manually
      comment:
        'Represents curated datasets of observations used for training, validation, or testing within MARP.',
      indexes: [
        {
          name: 'datasets_pkey',        // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'datasets_name_idx',    // speeds up lookups by dataset name
          fields: ['name'],
        },
        {
          name: 'datasets_source_idx',  // speeds up lookups/filtering by source
          fields: ['source'],
        },
      ],
    }
  );

  return datasets;
};
