/**
 * Adds the columns `users` needs to back local authentication: `username`
 * (the local sign-in name, distinct from the existing display `name`),
 * `status` (active/disabled/pending), and `last_login_at` (audit timestamp).
 *
 * `users` stays the canonical person/profile table -- no credential
 * material lives here; password hashes live in `auth_identities`, added by
 * the next migration.
 *
 * @fileoverview Migration adding local-auth columns to `users`.
 * @author Isaac Travers
 * @module migrations/add-auth-columns-to-users
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Adds `username`/`status`/`last_login_at` to `users`, plus a partial
   * unique index on `username` (ignoring `NULL`) and a check constraint
   * restricting `status` to its allowed values.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types and operators used in column/constraint definitions.
   * @returns {Promise<void>} Resolves once every column, index, and constraint has been added.
   * @throws {Error} Re-throws after rolling back if any column, index, or constraint addition fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'users',
        'username',
        {
          type: Sequelize.STRING(64),
          allowNull: true,
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'users',
        'status',
        {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'active',
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'users',
        'last_login_at',
        {
          type: Sequelize.DATE,
          allowNull: true,
        },
        { transaction }
      );

      await queryInterface.addIndex('users', ['username'], {
        name: 'users_username_unique_not_null',
        unique: true,
        where: {
          username: {
            [Sequelize.Op.ne]: null,
          },
        },
        transaction,
      });

      await queryInterface.addConstraint('users', {
        fields: ['status'],
        type: 'check',
        name: 'users_status_allowed_values',
        where: {
          status: ['active', 'disabled', 'pending'],
        },
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Reverses this migration: drops the check constraint and unique index,
   * then removes all three added columns.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once every constraint, index, and column has been removed.
   * @throws {Error} Re-throws after rolling back if any removal fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeConstraint('users', 'users_status_allowed_values', { transaction });
      await queryInterface.removeIndex('users', 'users_username_unique_not_null', { transaction });

      await queryInterface.removeColumn('users', 'last_login_at', { transaction });
      await queryInterface.removeColumn('users', 'status', { transaction });
      await queryInterface.removeColumn('users', 'username', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
