/**
 * Creates `permissions`, a catalog of named authorization capabilities
 * (e.g. `admin`). Deliberately generic rather than a single boolean flag on
 * `users`, so any future permission is a new catalog row plus grants in
 * `user_permissions` (added by the next migration), not a schema change.
 *
 * @fileoverview Migration creating the `permissions` catalog table.
 * @author Isaac Travers
 * @module migrations/create-permissions-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `permissions` inside a single transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table has been created.
   * @throws {Error} Re-throws after rolling back if table creation fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'permissions',
        {
          permission_id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            comment: 'Unique identifier for this permission definition.',
          },
          key: {
            type: Sequelize.STRING(50),
            allowNull: false,
            comment: 'Stable machine-readable permission identifier (e.g. "admin"), referenced by requirePermission() checks.',
          },
          description: {
            type: Sequelize.TEXT,
            allowNull: true,
            comment: 'Human-readable explanation of what this permission grants, shown in admin UI.',
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

      await queryInterface.addIndex('permissions', ['key'], {
        name: 'permissions_key_unique',
        unique: true,
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Reverses this migration by dropping `permissions`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('permissions', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
