/**
 * Seeds a single `metaInfos` row identifying this database instance as
 * "Development Database".
 *
 * @fileoverview Seed data for the `metaInfos` table.
 * @author Isaac Travers
 * @module seeders/seed-meta-info
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this seed by inserting the development `metaInfos` row.
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

      await queryInterface.bulkInsert('metaInfos', [
        {name: 'Development Database', createdAt:  creationTime, updatedAt:  creationTime }
      ], {});



      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this seed by deleting every row from `metaInfos`.
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
      // Remove all seeded rows from metaInfos
      await queryInterface.bulkDelete('metaInfos', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
