/**
 * Removes the `Capital` column from `metaInfos`, added by mistake in the
 * initial `create_metaInfo_table` migration and never used by the
 * application.
 *
 * @fileoverview Migration that drops the unused `metaInfos.Capital` column.
 * @author Isaac Travers
 * @module migrations/remove-capital-table-from-metainfo
 */

'use strict';

// Define the table model we are making changes on.
let tableModel = { schema: 'public', tableName: 'metaInfos' };

/** @type {Object} */
module.exports = {
  /**
   * Applies this migration by dropping `metaInfos.Capital`.
   *
   * Note: `queryInterface.removeColumn` here is not `await`ed, so the
   * transaction can commit before the column drop has actually completed
   * on the connection — a pre-existing bug carried over unchanged rather
   * than fixed as part of a documentation pass.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the column drop fails.
   */
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */

    // Use a transaction to make sure everything saves or everything reverts
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Remove column Capital from table metaInfo
      queryInterface.removeColumn('metaInfos', 'Capital');

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  /**
   * Reverts this migration by re-adding `metaInfos.Capital`.
   *
   * Note: `queryInterface.addColumn` here is not `await`ed either, for
   * the same reason described on `up` above.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the transaction has been committed.
   * @throws {Error} Re-throws after rolling back if the column re-add fails.
   */
  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */

    // Use a transaction to make sure everything saves or everything reverts
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Add column Capital from table metaInfo
      queryInterface.addColumn(
        'metaInfos',
        'Capital',
        {
          type: Sequelize.STRING
        }
      )

      // 3. Commit the transaction
      await transaction.commit();

    } catch (err) {
      await transaction.rollback();
      throw err;
    }

  }
};
