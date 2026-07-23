/**
 * Sequelize model definition for the tasks table.
 *
 * Defines the `tasks` table, which tracks discrete work items along with
 * basic audit information about who created and last updated each one.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for tasks.
 * @author Isaac Travers
 * @module model/task
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     Task:
 *       type: object
 *       description: >
 *         A discrete work item tracked in MARP, including descriptive text
 *         and basic audit fields showing who created and last updated it.
 *       required:
 *         - name
 *         - createdby
 *       properties:
 *         name:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           example: Review kelp transect annotations
 *           description: Human-readable title of the task.
 *         description:
 *           type: string
 *           nullable: true
 *           example: Validate species labels for line A before report export.
 *           description: Optional freeform details describing scope or next actions.
 *         createdate:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2026-07-23T14:05:00.000Z"
 *           description: Timestamp when this task was first recorded.
 *         updateddate:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2026-07-23T15:12:41.000Z"
 *           description: Timestamp when this task was last updated.
 *         createdby:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           example: i.travers
 *           description: Identifier or username of the person who created the task.
 *         updatedby:
 *           type: string
 *           nullable: true
 *           example: j.diver
 *           description: Identifier or username of the person who last modified the task.
 */

/**
 * Create and initialize the tasks Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized tasks model.
 */
module.exports = (sequelize, DataTypes) => {

    /**
     * Sequelize model representing one task record.
     *
     * @class Tasks
     * @extends Model
     */
    class Tasks extends Model {}

    Tasks.init({
        // Model attributes are defined here
        name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        description: {
          type: DataTypes.STRING
          // allowNull defaults to true
        },
        createdate: {
          type: DataTypes.DATE
          // allowNull defaults to true
        },
        updateddate: {
            type: DataTypes.DATE
            // allowNull defaults to true
        },
        createdby: {
            type: DataTypes.STRING,
            allowNull: false
        },
        updatedby: {
            type: DataTypes.STRING
            // allowNull defaults to true
        },
      }, {
        // Other model options go here
        sequelize,           // We need to pass the connection instance
        modelName: 'tasks'   // We need to choose the model name
      });

      return Tasks;
}