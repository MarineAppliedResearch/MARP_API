/**
 * Sequelize model definition for projects.
 *
 * Defines the `projects` table, which groups sessions and observations
 * recorded throughout MARP under a single named project. Each project is
 * referenced by foreign keys on the `sessions` and `observations` tables so
 * that related records can be rolled up and reported on by project.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for projects.
 * @author Isaac Travers
 * @module model/project
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     Project:
 *       type: object
 *       description: >
 *         Named project grouping used to organize sessions and observations
 *         recorded throughout MARP.
 *       required:
 *         - project_id
 *         - name
 *       properties:
 *         project_id:
 *           type: integer
 *           example: 24
 *           description: Unique numeric identifier for this project.
 *         name:
 *           type: string
 *           example: Channel Islands 2024
 *           description: Unique display name for the project.
 */

/**
 * Create and initialize the Projects Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the sessions and
 * observations models through {@link Projects.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized Projects model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one project record.
   *
   * Groups sessions and observations under a single named project for
   * reporting and organizational purposes.
   *
   * @class Projects
   * @extends Model
   */
  class Projects extends Model {

    /**
     * Register relationships between Projects and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      this.hasMany(models.sessions, {
        sourceKey: 'project_id',
        foreignKey: 'project_id',
        as: 'session',
      });

      this.hasMany(models.observations, {
        sourceKey: 'project_id',
        foreignKey: 'project_id',
        as: 'observation',
      });
    }
  }

  Projects.init(
    {
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),            // match DB exactly
        allowNull: false,
        unique: 'projects_name_key',            // use same constraint name
      },
    },
    {
      sequelize,                                // shared Sequelize connection instance
      modelName: 'projects',                    // used inside Sequelize
      tableName: 'projects',                    // explicit table name
      schema: 'public',                         // database schema containing the table
      timestamps: true,                         // match old model
      indexes: [
        {
          name: 'projects_name_key',            // enforces unique project names
          unique: true,
          fields: ['name'],
        },
        {
          name: 'projects_pkey',                // primary key index
          unique: true,
          fields: ['project_id'],
        },
      ],
    }
  );

  return Projects;
};
