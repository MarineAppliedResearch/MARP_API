/**
 * Creates `user_permissions`, the join table granting individual
 * permissions (from `permissions`) to individual users. A user's effective
 * permission set is simply the rows here for their `user_id`.
 *
 * @fileoverview Migration creating the `user_permissions` grant table.
 * @author Isaac Travers
 * @module migrations/create-user-permissions-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `user_permissions` and its indexes/constraints inside a single
   * transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table, indexes, and constraints have been created.
   * @throws {Error} Re-throws after rolling back if table, index, or constraint creation fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'user_permissions',
        {
          user_permission_id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            comment: 'Unique identifier for this permission grant.',
          },
          user_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
              model: 'users',
              key: 'user_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
            comment: 'Foreign key referencing the user this permission is granted to (users.user_id).',
          },
          permission_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
              model: 'permissions',
              key: 'permission_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
            comment: 'Foreign key referencing the granted permission (permissions.permission_id).',
          },
          granted_by_user_id: {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: {
              model: 'users',
              key: 'user_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
            comment: 'Audit-only reference to the admin who granted this permission; null if the granter is unknown or later removed.',
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

      await queryInterface.addIndex('user_permissions', ['user_id'], {
        name: 'user_permissions_user_id_idx',
        transaction,
      });

      await queryInterface.addIndex('user_permissions', ['user_id', 'permission_id'], {
        name: 'user_permissions_user_permission_unique',
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
   * Reverses this migration by dropping `user_permissions`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('user_permissions', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
