/**
 * Seeds three fixed-id development users (`user_id` 0-2: Isaac Travers,
 * Sam Parker, Johnathan Centoni) used as `createdby`/`updatedby`/session
 * owners by the other development seeders in this directory.
 *
 * @fileoverview Seed data for the `users` table.
 * @author Isaac Travers
 * @module seeders/seed-users-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this seed by inserting the three development users.
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

      await queryInterface.bulkInsert('users', [
        {name: 'Isaac Travers', user_id: 0 ,createdAt:  creationTime, updatedAt:  creationTime },
        {name: 'Sam Parker', user_id: 1 , createdAt:  creationTime, updatedAt:  creationTime  },
        {name: 'Johnathan Centoni', user_id: 2, createdAt:  creationTime, updatedAt:  creationTime  }
      ], {});



      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this seed by deleting every row from `users`.
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
      // Remove all seeded rows from users
      await queryInterface.bulkDelete('users', null, {});

      //Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
