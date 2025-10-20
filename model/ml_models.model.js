/**
 * ===================================================================
 * File: ml_model.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `ml_models` table, which stores metadata for every
 * distinct machine learning model identity used within MARP.
 *
 * Each entry in this table represents a *conceptual model* such as
 * "yolov8-marine-fish-2025", not a specific training run.
 * Training runs, metrics, and related data are linked through
 * the `training_runs` table.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: ml_models
   * ----------------------------------------------------------------
   * Stores information about every unique machine learning model
   * identity, including its architecture type, version, storage
   * location, lifecycle status, and related notes.
   */
  class ml_models extends Model {
    /**
     * Define associations between models.
     * Executed automatically in init-models.js
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
      sequelize,
      modelName: 'ml_models',           // used inside Sequelize
      tableName: 'ml_models',           // actual table name in PostgreSQL
      schema: 'public',
      timestamps: false,                // we manage created_at/updated_at manually
      comment:
        'Top-level table for all machine learning model identities within MARP.',
      indexes: [
        {
          name: 'ml_models_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'ml_models_name_idx',
          fields: ['name'],
        },
      ],
    }
  );

  return ml_models;
};