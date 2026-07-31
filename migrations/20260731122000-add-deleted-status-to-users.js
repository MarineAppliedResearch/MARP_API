/**
 * Adds `'deleted'` to the allowed values of `users.status`, backing
 * soft-delete for the new admin user-management endpoints. A "deleted" user
 * row is never actually removed -- `authenticateLocalUser`/
 * `getSessionUserById` already reject any status other than `'active'`, so
 * this one value addition is sufficient to lock a deleted user out of login
 * and any live session, with no other code changes required.
 *
 * @fileoverview Migration adding the `'deleted'` users.status value.
 * @author Isaac Travers
 * @module migrations/add-deleted-status-to-users
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Drops and recreates the `users_status_allowed_values` check constraint
   * to include `'deleted'` alongside the existing `active`/`disabled`/`pending`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the constraint has been recreated.
   * @throws {Error} Re-throws after rolling back if the constraint change fails.
   */
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeConstraint('users', 'users_status_allowed_values', { transaction });

      await queryInterface.addConstraint('users', {
        fields: ['status'],
        type: 'check',
        name: 'users_status_allowed_values',
        where: {
          status: ['active', 'disabled', 'pending', 'deleted'],
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
   * Reverses this migration, restoring the original three-value check
   * constraint. Any row already set to `'deleted'` would violate the
   * restored constraint, so this only succeeds if no such rows exist.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the constraint has been restored.
   * @throws {Error} Re-throws after rolling back if the constraint change fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeConstraint('users', 'users_status_allowed_values', { transaction });

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
};
