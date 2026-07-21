/**
 * ===================================================================
 * File: model_species.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `model_species` join table, which links machine learning
 * models (`ml_models`) to the species (`species`) they are trained to
 * detect or classify.
 *
 * Each record describes a specific model–species relationship,
 * including how many training examples were used and any weighting or
 * notes relevant to that species within the model context.
 *
 * This table is essential for tracking model coverage and per-class
 * dataset composition.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: model_species
   * ----------------------------------------------------------------
   * Join table connecting ML models and species, providing details
   * about how many examples of each species were used to train a
   * given model and what balance weights were applied.
   */
  class model_species extends Model {
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
      sequelize,
      modelName: 'model_species',     // internal Sequelize name
      tableName: 'model_species',     // actual PostgreSQL table
      schema: 'public',
      timestamps: false,              // we manage manually
      comment:
        'Join table linking ML models and species, including dataset size, weighting, and per-species metrics.',
      indexes: [
        {
          name: 'model_species_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'model_species_model_id_idx',
          fields: ['model_id'],
        },
        {
          name: 'model_species_species_id_idx',
          fields: ['species_id'],
        },
        {
          name: 'model_species_unique_model_species',
          unique: true,
          fields: ['model_id', 'species_id'],
        },
      ],
    }
  );

  return model_species;
};
