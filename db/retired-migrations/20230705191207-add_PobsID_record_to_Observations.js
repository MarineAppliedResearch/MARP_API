/**
 * Adds the nullable `observations.PobsID` column: a per-project ordinal
 * position used by report views (see `PobsID` in the `README.md` SQL
 * notes) to order observations within a project independent of the
 * primary key.
 *
 * @fileoverview Migration that adds `observations.PobsID`.
 * @author Isaac Travers
 * @module migrations/add-pobsid-record-to-observations
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Applies this migration by adding `observations.PobsID`.
   *
   * Note: `queryInterface.addColumn` here is not `await`ed, so the
   * transaction can commit before the column add has actually completed
   * on the connection — a pre-existing bug carried over unchanged rather
   * than fixed as part of a documentation pass.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the column add fails.
   */
  async up (queryInterface, Sequelize) {
     // Use a transaction to make sure everything saves or everything reverts
     const transaction = await queryInterface.sequelize.transaction();

    try {
      // Add the PobsID column
      queryInterface.addColumn(
        'observations',
        'PobsID',
        {
          type: Sequelize.INTEGER,
          allowNull: true
        }
      )

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this migration by dropping `observations.PobsID`.
   *
   * Note: `queryInterface.removeColumn` here is not `await`ed either, for
   * the same reason described on `up` above.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the column drop fails.
   */
  async down (queryInterface, Sequelize) {
     // Use a transaction to make sure everything saves or everything reverts
     const transaction = await queryInterface.sequelize.transaction();


    try {
      // 1. Remove the PobsID column from observations
      queryInterface.removeColumn('observations', 'PobsID');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
