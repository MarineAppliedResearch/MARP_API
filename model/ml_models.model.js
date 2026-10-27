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

      artifact_sha256: {
        /* **Recorded when the weights are staged, not computed when a job is
           submitted.** A training spec has to carry this -- the worker hashes what it
           fetched and refuses a mismatch -- and it used to exist only inside a sentence
           in `notes`, or nowhere at all. Null is "not known", which is why a job
           cannot be submitted against a model that has none. */
        type: DataTypes.STRING(64),
        allowNull: true,
        comment:
          'Lowercase sha256 of the weights at storage_path. Null means not known.',
        jsonSchema: {
            description: 'Lowercase sha256 of the weights at storage_path, for the job spec '
                + 'that fetches them. Null when the artifact is not on this machine.',
            examples: ['5e5aaa5a6ee6023734f154766b000c85805924178b865e3569d61592fcca0b89'],
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

      is_base: {
        /* A pretrained starting point rather than a model MARP trained. Stated, never
           inferred from having no species: a trained model whose species nobody seeded
           yet also has none, and that one is merely unhelpful while this one must never
           reach inference. */
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          'True when this is a pretrained starting point for training rather than a model MARP trained. It has no species, so it must never be selectable for inference, where its class names would be resolved against the species catalogue and written into observations.',
        jsonSchema: {
            description: 'True when this is a pretrained starting point for training rather than a model MARP trained. Never selectable for inference.',
        },
      },

      training_run_id: {
        /* **The run that produced this model, not the one it started from.** Those are
           different facts and reading one as the other made three cells on two screens
           wrong: `training_runs.model_id` is the base checkpoint a run fine-tunes from,
           so every finished run appeared to have produced what it trained from. Written
           by `registerTrainedModel` at the moment it knows, rather than derived later
           from the weights digest -- `artifacts.hash` carries no uniqueness constraint
           and a retry reproducing identical bytes would put two rows behind one hash. */
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'The training run that produced this model, when one did. NULL for a model registered outside the pool, which is not an error. Not training_runs.model_id, which is the base model a run started FROM.',
        jsonSchema: {
            description: 'The training run that produced this model. Null when no run did.',
        },
      },

      preferred: {
        // One per model_type, enforced by a partial unique index.
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          'True on the one model of its model_type that jobs should reach for by default.',
        jsonSchema: {
            description: 'True on the one model of its model_type that jobs should reach for by default.',
            examples: [false],
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