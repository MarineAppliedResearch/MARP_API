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

    Tasks.init(
        {
            // Model attributes are defined here
            name: {
                type: DataTypes.STRING,
                allowNull: false,
                jsonSchema: {
                    description: 'Human-readable title of the task.',
                    examples: ['Review kelp transect annotations'],
                },
            },
            description: {
                type: DataTypes.STRING,
                jsonSchema: {
                    description: 'Optional freeform details describing scope or next actions.',
                    examples: ['Validate species labels for line A before report export.'],
                },
                // allowNull defaults to true
            },
            createdate: {
                type: DataTypes.DATE,
                jsonSchema: {
                    description: 'Timestamp when this task was first recorded.',
                    examples: ['2026-07-23T14:05:00.000Z'],
                },
                // allowNull defaults to true
            },
            updateddate: {
                type: DataTypes.DATE,
                jsonSchema: {
                    description: 'Timestamp when this task was last updated.',
                    examples: ['2026-07-23T15:12:41.000Z'],
                },
                // allowNull defaults to true
            },
            createdby: {
                type: DataTypes.STRING,
                allowNull: false,
                jsonSchema: {
                    description: 'Identifier or username of the person who created the task.',
                    examples: ['i.travers'],
                },
            },
            updatedby: {
                type: DataTypes.STRING,
                jsonSchema: {
                    description: 'Identifier or username of the person who last modified the task.',
                    examples: ['j.diver'],
                },
                // allowNull defaults to true
            },
        },
        {
            // Other model options go here
            sequelize, // We need to pass the connection instance
            modelName: 'tasks', // We need to choose the model name
        }
    );

      return Tasks;
}