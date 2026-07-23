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
 * @openapi
 * components:
 *   schemas:
 *     MlModel:
 *       type: object
 *       description: >
 *         Metadata record for a distinct machine learning model identity
 *         used within MARP (e.g., "yolov8-marine-fish-2025"). Represents the
 *         conceptual model itself, not any individual training run; runs,
 *         metrics, and artifacts are linked through the training_runs table.
 *       required:
 *         - id
 *         - name
 *         - model_type
 *       properties:
 *         id:
 *           type: integer
 *           example: 7
 *           description: Unique numeric identifier for this ML model record.
 *         name:
 *           type: string
 *           example: yolov8-marine-fish-2025
 *           description: Human-readable name of the model (e.g., "yolov8-marine-fish-2025").
 *         parent_model_id:
 *           type: integer
 *           nullable: true
 *           description: If this model was derived or fine-tuned from another, references that parent model's ID.
 *         model_type:
 *           type: string
 *           example: yolov8
 *           description: Model architecture family (e.g., "yolov8", "resnet", "deepsort").
 *         architecture_version:
 *           type: string
 *           nullable: true
 *           example: v8n
 *           description: Specific version or variant of the architecture (e.g., "v8n", "custom-2025a").
 *         storage_path:
 *           type: string
 *           nullable: true
 *           description: Filesystem or URI path to the stored model weights and artifacts.
 *         status:
 *           type: string
 *           example: draft
 *           description: Lifecycle state of the model ("draft", "training", "trained", or "archived").
 *         notes:
 *           type: string
 *           nullable: true
 *           description: Freeform notes providing experiment details, context, or remarks.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this model entry was created.
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this model record was last updated.
 */

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
      },

      name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Human-readable name of the model (e.g., "yolov8-marine-fish-2025").',
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
      },

      model_type: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          'Model architecture family (e.g., "yolov8", "resnet", "deepsort").',
      },

      architecture_version: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Specific version or variant of the architecture (e.g., "v8n", "custom-2025a").',
      },

      storage_path: {
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Filesystem or URI path to the stored model weights and artifacts.',
      },

      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'draft',
        comment:
          'Lifecycle state of the model: "draft", "training", "trained", or "archived".',
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes providing experiment details, context, or remarks.',
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this model entry was created.',
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this model record was last updated.',
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