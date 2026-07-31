/**
 * Seeds the `admin` permission definition and grants it to the existing
 * user named "Isaac Travers", bootstrapping the very first admin account.
 * Looked up by `users.name` (unique) rather than a hardcoded `user_id`, so
 * this runs identically in any environment. No password is set here --
 * committing a real credential hash into a migration file isn't good
 * practice; login credentials for this account are set out-of-band.
 *
 * @fileoverview Migration seeding the initial `admin` permission grant.
 * @author Isaac Travers
 * @module migrations/seed-admin-permission
 */

'use strict';

/**
 * Display name of the user to grant the bootstrap admin permission to.
 *
 * @constant
 * @type {string}
 */
const BOOTSTRAP_ADMIN_NAME = 'Isaac Travers';

/** @type {Object} */
module.exports = {
  /**
   * Inserts the `admin` permissions row, then grants it to
   * {@link BOOTSTRAP_ADMIN_NAME} via a name/key lookup.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the permission and grant have been inserted.
   * @throws {Error} Re-throws after rolling back if the insert fails, or if no user named
   * {@link BOOTSTRAP_ADMIN_NAME} exists (the grant would otherwise silently insert zero rows).
   */
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.bulkInsert(
        'permissions',
        [
          {
            key: 'admin',
            description: 'Full administrative access: create, update, and soft-delete users; view and change user permissions; set user passwords.',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        { transaction }
      );

      // A raw INSERT with no RETURNING resolves as [results, rowCount],
      // where rowCount is a plain number (not an object) for this dialect.
      const [, insertedRowCount] = await queryInterface.sequelize.query(
        `INSERT INTO user_permissions (user_id, permission_id, granted_by_user_id, "createdAt", "updatedAt")
         SELECT u.user_id, p.permission_id, NULL, NOW(), NOW()
         FROM users u, permissions p
         WHERE u.name = :userName AND p.key = :permissionKey`,
        {
          replacements: { userName: BOOTSTRAP_ADMIN_NAME, permissionKey: 'admin' },
          transaction,
        }
      );

      if (insertedRowCount !== 1) {
        throw new Error(
          `Expected to grant admin to exactly one user named "${BOOTSTRAP_ADMIN_NAME}", but matched ${insertedRowCount}. Aborting seed.`
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Reverses this migration by deleting the `admin` permission (cascading
   * to its `user_permissions` grants via the FK's `onDelete: CASCADE`).
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the permission has been deleted.
   * @throws {Error} Re-throws after rolling back if the delete fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.bulkDelete('permissions', { key: 'admin' }, { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
