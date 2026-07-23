/**
 * Seeds a single fixed-id development project (`project_id` 0, "Development
 * Testing") used as the parent project for the development sessions and
 * observations seeded elsewhere in this directory.
 *
 * @fileoverview Seed data for the `projects` table.
 * @author Isaac Travers
 * @module seeders/seed-projects-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this seed by inserting the development project row.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run the bulk insert.
   * @param {Object} Sequelize - Sequelize library, exposing data types and query helpers.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the insert fails.
   */
  async up (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      var creationTime =   new Date()

      await queryInterface.bulkInsert('projects', [
        {project_id: 0, name: "Development Testing", createdAt:  creationTime, updatedAt:  creationTime }
      ], {});



      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this seed by deleting every row from `projects`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run the bulk delete.
   * @param {Object} Sequelize - Sequelize library, exposing data types and query helpers.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the delete fails.
   */
  async down (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Remove all seeded rows from projects
      await queryInterface.bulkDelete('projects', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
