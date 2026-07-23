/**
 * Seeds a single fixed-id development session (`session_id` 0, dive "0",
 * line "0", type "Fish") owned by development user 0 under development
 * project 0. Depends on the `projects` and `users` seeds in this directory
 * having already run.
 *
 * @fileoverview Seed data for the `sessions` table.
 * @author Isaac Travers
 * @module seeders/seed-sessions-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this seed by inserting the development session row.
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

      await queryInterface.bulkInsert('sessions', [
        {session_id: 0, project_id: 0, user_id: 0, dive: "0", line: "0", lineId: "0_0", type: "Fish", createdAt:  creationTime, updatedAt:  creationTime }
      ], {});



      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this seed by deleting every row from `sessions`.
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
      // Remove all seeded rows from sessions
      await queryInterface.bulkDelete('sessions', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
