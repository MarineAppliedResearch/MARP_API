/**
 * Creates the `public` PostgreSQL schema used by every MARP table.
 *
 * This is the first migration in the project's history and predates all
 * table-creation migrations, which assume `public` already exists.
 *
 * @fileoverview Migration that creates the base `public` schema.
 * @author Isaac Travers
 * @module migrations/create-schemas
 */

'use strict';

module.exports = {
  /**
   * Applies this migration by creating the `public` schema.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types and query helpers.
   * @returns {Promise<void>} Resolves once the schema has been created.
   */
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createSchema('public')
  },

  /**
   * Reverts this migration by dropping the `public` schema.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types and query helpers.
   * @returns {Promise<void>} Resolves once the schema has been dropped.
   */
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropSchema('public');
  }
};
