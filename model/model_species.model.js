/**
 * Sequelize model definition for the model_species join table.
 *
 * Defines the `model_species` join table, which links machine learning
 * models (`ml_models`) to the species (`species`) they are trained to
 * detect or classify.
 *
 * Each record describes a specific model-species relationship, including
 * how many training examples were used and any weighting or notes relevant
 * to that species within the model context.
 *
 * This table is essential for tracking model coverage and per-class
 * dataset composition.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for model_species.
 * @author Isaac Assegai Travers
 * @module model/model_species
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     ModelSpecies:
 *       type: object
 *       description: >
 *         Join record linking an ML model to a species it was trained to
 *         detect or classify, including per-species dataset size, training
 *         weight, and evaluation metrics.
 *       required:
 *         - id
 *         - model_id
 *         - species_id
 *       properties:
 *         id:
 *           type: integer
 *           example: 301
 *           description: Unique numeric identifier for this model-species linkage record.
 *         model_id:
 *           type: integer
 *           example: 7
 *           description: Identifier of the associated ML model.
 *         species_id:
 *           type: integer
 *           example: 42
 *           description: Identifier of the associated species.
 *         dataset_size:
 *           type: integer
 *           nullable: true
 *           description: Number of image or annotation samples of this species used for training this model.
 *         balance_weight:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Relative weight used for balancing this species during training. Higher means more importance.
 *         precision_mean:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Mean precision achieved by the model for this species during evaluation.
 *         recall_mean:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Mean recall achieved by the model for this species during evaluation.
 *         f1_mean:
 *           type: number
 *           format: float
 *           nullable: true
 *           description: Mean F1-score for this species within this model, across validation epochs.
 *         notes:
 *           type: string
 *           nullable: true
 *           description: Freeform notes describing this model-species relationship.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this record was created.
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this record was last updated.
 */

/**
 * Create and initialize the model_species Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the ml_models and species
 * models through {@link model_species.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {typeof Model} Initialized model_species model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one model-species join record.
   *
   * Connects ML models and species, providing details about how many
   * examples of each species were used to train a given model and what
   * balance weights and evaluation metrics were applied.
   *
   * @class model_species
   * @extends Model
   */
  class model_species extends Model {

    /**
     * Register relationships between model_species and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Belongs to one ML model
      this.belongsTo(models.ml_models, {
        as: 'ml_model',
        foreignKey: 'model_id',
      });

      // Belongs to one species
      this.belongsTo(models.species, {
        as: 'species',
        foreignKey: 'species_id',
      });
    }
  }

  model_species.init(
    {
      id: {
        // Primary key for the join record
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment:
          'Unique numeric identifier for this model-species linkage record.',
      },

      model_id: {
        // Foreign key: which ML model this entry belongs to
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the associated ML model (ml_models.id).',
      },

      species_id: {
        // Foreign key: which species this entry corresponds to
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Foreign key referencing the species this model was trained on (species.id).',
      },

      dataset_size: {
        // Number of training samples for this species in the dataset
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Number of image or annotation samples of this species used for training this model.',
      },

      balance_weight: {
        // Class weight applied to this species during model training
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Relative weight used for balancing this species during training (higher = more importance).',
      },

      precision_mean: {
        // Average precision for this species across validation runs
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean precision achieved by the model for this species during evaluation (optional).',
      },

      recall_mean: {
        // Average recall for this species across validation runs
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean recall achieved by the model for this species during evaluation (optional).',
      },

      f1_mean: {
        // Average F1 score for this species
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Mean F1-score for this species within this model, across validation epochs (optional).',
      },

      notes: {
        // Any freeform notes on this model-species pairing
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes describing this model-species relationship (e.g., training quality, issues, or remarks).',
      },

      created_at: {
        // Record creation timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this model-species record was created.',
      },

      updated_at: {
        // Record update timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this model-species record was last updated.',
      },
    },
    {
      sequelize,                      // shared Sequelize connection instance
      modelName: 'model_species',     // internal Sequelize name
      tableName: 'model_species',     // actual PostgreSQL table
      schema: 'public',              // database schema containing the table
      timestamps: false,              // we manage manually
      comment:
        'Join table linking ML models and species, including dataset size, weighting, and per-species metrics.',
      indexes: [
        {
          name: 'model_species_pkey',                 // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'model_species_model_id_idx',          // speeds up lookups by ML model
          fields: ['model_id'],
        },
        {
          name: 'model_species_species_id_idx',        // speeds up lookups by species
          fields: ['species_id'],
        },
        {
          name: 'model_species_unique_model_species',  // enforces one record per model-species pair
          unique: true,
          fields: ['model_id', 'species_id'],
        },
      ],
    }
  );

  return model_species;
};
