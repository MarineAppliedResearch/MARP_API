/**
 * Seeds the `admin` permission definition and grants it to the user named
 * "Isaac Travers", bootstrapping the very first admin account. Looked up by
 * `users.name` (unique) rather than a hardcoded `user_id`, so this runs
 * identically in any environment, and the user is created if it does not
 * already exist. No password is set here -- committing a real credential hash
 * into a migration file isn't good practice; login credentials for this
 * account are set out-of-band.
 *
 * Creating the user matters because this originally required it to exist
 * already and aborted the whole migration run if it did not. That is fine on a
 * database seeded from a development dump and wrong anywhere else -- a fresh
 * install, or production, which has never run this.
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
   * Inserts the `admin` permissions row, creates
   * {@link BOOTSTRAP_ADMIN_NAME} if that user does not exist yet, then grants
   * the permission via a name/key lookup.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the permission, user and grant are in place.
   * @throws {Error} Re-throws after rolling back if any statement fails, or if the grant
   * does not match exactly one user (which would mean the create-if-missing step above
   * did not do its job).
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

      // Create the bootstrap admin if it isn't there. `users.name` is unique,
      // so WHERE NOT EXISTS is what keeps this a no-op on a database that
      // already has the account -- every existing environment does.
      //
      // Only `name` is supplied: `username` is nullable (credentials are set
      // out-of-band) and `status` defaults to 'active'.
      await queryInterface.sequelize.query(
        `INSERT INTO users (name, "createdAt", "updatedAt")
         SELECT :userName, NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = :userName)`,
        {
          replacements: { userName: BOOTSTRAP_ADMIN_NAME },
          transaction,
        }
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

      // Kept as a guard rather than dropped: after the insert above this can
      // only fail if something is genuinely wrong, and a silent zero-row grant
      // would leave an API with no administrator and no error.
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
   * Deliberately does not delete the bootstrap user, even if `up` created it.
   * There is no way to tell afterwards whether it was created here or already
   * existed, and sessions and observations reference `users`, so removing it
   * would either fail on a foreign key or take real data with it. A leftover
   * name-only user row is harmless.
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
