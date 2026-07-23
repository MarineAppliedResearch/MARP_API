/**
 * Sequelize model definition for the hyperparameters table.
 *
 * Defines the `hyperparameters` table, which stores the full
 * hyperparameter configuration used for a specific training run.
 *
 * Each record contains a JSON object describing model training
 * parameters such as learning rate, batch size, optimizer type,
 * momentum, weight decay, and augmentation options.
 *
 * This ensures reproducibility of training conditions and allows
 * comparison between runs using different settings, as part of the
 * MARP Machine Learning Database Schema.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for hyperparameters.
 * @author Isaac Assegai Travers
 * @module model/hyperparameters
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     Hyperparameters:
 *       type: object
 *       description: >
 *         Full hyperparameter configuration used for a specific training
 *         run, stored as a JSON blob to preserve reproducibility of
 *         training conditions across differing pipelines and model types.
 *       required:
 *         - id
 *         - training_run_id
 *         - params
 *       properties:
 *         id:
 *           type: integer
 *           example: 88
 *           description: Unique identifier for this hyperparameter configuration.
 *         training_run_id:
 *           type: integer
 *           example: 12
 *           description: Foreign key referencing the training run this hyperparameter set belongs to (training_runs.id).
 *         params:
 *           type: object
 *           additionalProperties: true
 *           description: >
 *             JSON blob containing all hyperparameters used for this
 *             training run (e.g., lr0, momentum, epochs, batch, weight
 *             decay, augmentation options). Keys vary by training
 *             pipeline and are not individually enumerated here.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this hyperparameter record was created.
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when this hyperparameter record was last updated.
 */

/**
 * Create and initialize the hyperparameters Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the training_runs model
 * through {@link hyperparameters.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized hyperparameters model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one hyperparameter configuration
   * associated with a specific training run.
   *
   * Each record represents one hyperparameter configuration associated
   * with a specific training run.
   *
   * @class hyperparameters
   * @extends Model
   */
  class hyperparameters extends Model {
    /**
     * Register relationships between hyperparameters and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
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
      sequelize,                            // shared Sequelize connection instance
      modelName: 'hyperparameters',         // used inside Sequelize
      tableName: 'hyperparameters',         // actual PostgreSQL table
      schema: 'public',                     // database schema containing the table
      timestamps: false,                    // we manage created_at/updated_at manually
      comment:
        'Stores full hyperparameter configurations for each training run to ensure reproducibility and comparability.',
      indexes: [
        {
          name: 'hyperparameters_pkey',                  // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'hyperparameters_training_run_id_idx',   // speeds up lookups by training run
          fields: ['training_run_id'],
        },
      ],
    }
  );

  return hyperparameters;
};