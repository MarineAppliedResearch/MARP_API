/**
 * Sequelize model definition for the ml_models table.
 *
 * Defines the `ml_models` table, which stores metadata for every distinct
 * machine learning model identity used within MARP.
 *
 * Each entry in this table represents a *conceptual model* such as
 * "yolov8-marine-fish-2025", not a specific training run. Training runs,
 * metrics, and related data are linked through the `training_runs` table.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for ml_models.
 * @author Isaac Assegai Travers
 * @module model/ml_models
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the ml_models Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the training_runs and
 * species models through {@link ml_models.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized ml_models model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one machine learning model identity.
   *
   * Stores information about every unique machine learning model
   * identity, including its architecture type, version, storage
   * location, lifecycle status, and related notes.
   *
   * @class ml_models
   * @extends Model
   */
  class ml_models extends Model {
    /**
     * Register relationships between ml_models and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // One model can have many training runs
      this.hasMany(models.training_runs, {
        as: 'training_runs',
        foreignKey: 'model_id',
        onDelete: 'CASCADE',
      });

      // Many-to-many: models ↔ species (through model_species)
      this.belongsToMany(models.species, {
        through: models.model_species,
        as: 'species',
        foreignKey: 'model_id',
        otherKey: 'species_id',
      });

      // Self-reference for model lineage
      this.belongsTo(models.ml_models, {
        as: 'parent_model',
        foreignKey: 'parent_model_id',
      });

      this.hasMany(models.ml_models, {
        as: 'derived_models',
        foreignKey: 'parent_model_id',
      });
    }
  }

  ml_models.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment:
          'Unique numeric identifier for this ML model record.',
        jsonSchema: {
            readOnly: true,
            description: 'Unique numeric identifier for this ML model record.',
            examples: [7],
        },
      },

      name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Human-readable name of the model (e.g., "yolov8-marine-fish-2025").',
        jsonSchema: {
            schema: { type: 'string', minLength: 1, maxLength: 255 },
            description: 'Human-readable name of the model (e.g., "yolov8-marine-fish-2025").',
            examples: ['yolov8-marine-fish-2025'],
        },
      },

      parent_model_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'ml_models',
          key: 'id',
        },
        comment:
          'If this model was derived or fine-tuned from another, reference that parent model ID here.',
        jsonSchema: {
            description: "If this model was derived or fine-tuned from another, references that parent model's ID.",
            examples: [3],
        },
      },

      model_type: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Model architecture family (e.g., "yolov8", "resnet", "deepsort").',
        jsonSchema: {
            schema: { type: 'string', minLength: 1, maxLength: 255 },
            description: 'Model architecture family (e.g., "yolov8", "resnet", "deepsort").',
            examples: ['yolov8'],
        },
      },

      architecture_version: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Specific version or variant of the architecture (e.g., "v8n", "custom-2025a").',
        jsonSchema: {
            description: 'Specific version or variant of the architecture (e.g., "v8n", "custom-2025a").',
            examples: ['v8n'],
        },
      },

      storage_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Filesystem or URI path to the stored model weights and artifacts.',
        jsonSchema: {
            description: 'Filesystem or URI path to the stored model weights and artifacts.',
            examples: ['/models/yolov8-marine-fish-2025/'],
        },
      },

      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'draft',
        comment:
          'Lifecycle state of the model: "draft", "training", "trained", or "archived".',
        jsonSchema: {
            schema: { type: 'string', enum: ['draft', 'training', 'trained', 'archived'] },
            description: 'Lifecycle state of the model ("draft", "training", "trained", or "archived").',
            examples: ['draft'],
        },
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes providing experiment details, context, or remarks.',
        jsonSchema: {
            description: 'Freeform notes providing experiment details, context, or remarks.',
            examples: ['Fine-tuned from 2025 baseline using added invertebrate labels.'],
        },
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this model entry was created.',
        jsonSchema: {
            readOnly: true,
            description: 'Timestamp when this model entry was created.',
        },
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this model record was last updated.',
        jsonSchema: {
            readOnly: true,
            description: 'Timestamp when this model record was last updated.',
        },
      },
    },
    {
      sequelize,                         // shared Sequelize connection instance
      modelName: 'ml_models',            // used inside Sequelize
      tableName: 'ml_models',            // actual table name in PostgreSQL
      schema: 'public',                  // database schema containing the table
      timestamps: false,                 // we manage created_at/updated_at manually
      comment:
        'Top-level table for all machine learning model identities within MARP.',
      indexes: [
        {
          name: 'ml_models_pkey',        // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'ml_models_name_idx',    // speeds up lookups by model name
          fields: ['name'],
        },
      ],
    }
  );

  return ml_models;
};