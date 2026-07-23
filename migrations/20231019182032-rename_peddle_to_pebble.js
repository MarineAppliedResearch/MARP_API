/**
 * Renames `observations.substrate_peddle` to `observations.substrate_pebble`,
 * correcting the spelling typo introduced by `add_60SecondSubstrateData`.
 *
 * @fileoverview Migration that fixes the `substrate_peddle` -> `substrate_pebble` typo.
 * @author Isaac Travers
 * @module migrations/rename-peddle-to-pebble
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this migration by renaming `substrate_peddle` to
   * `substrate_pebble` on `observations`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the column rename fails.
   */
  async up (queryInterface, Sequelize) {
    // Create a transaction
    const transaction = await queryInterface.sequelize.transaction();

    try {

      // 1. Rename the column
      await queryInterface.renameColumn('observations', 'substrate_peddle', 'substrate_pebble');

      // 2. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this migration by renaming `substrate_pebble` back to
   * `substrate_peddle` on `observations`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the column rename fails.
   */
  async down (queryInterface, Sequelize) {
    // Create a transaction
    const transaction = await queryInterface.sequelize.transaction();

    try {

      // 1. Rename the column
      await queryInterface.renameColumn('observations', 'substrate_pebble', 'substrate_peddle');

      // 2. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
