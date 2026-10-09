/**
 * Creates `auth_sessions`, the session-store table backing `express-session`
 * via `connect-session-sequelize`. Deliberately named and structured apart
 * from the existing MARP domain table named `sessions` (dive/survey
 * sessions) -- the two are unrelated.
 *
 * @fileoverview Migration creating the `auth_sessions` session-store table.
 * @author Isaac Travers
 * @module migrations/create-auth-sessions-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `auth_sessions` and its `expires` index inside a single
   * transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table and index have been created.
   * @throws {Error} Re-throws after rolling back if table or index creation fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'auth_sessions',
        {
          sid: {
            type: Sequelize.STRING(128),
            primaryKey: true,
            allowNull: false,
          },
          expires: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          data: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex('auth_sessions', ['expires'], {
        name: 'auth_sessions_expires_idx',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Reverses this migration by dropping `auth_sessions`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('auth_sessions', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
