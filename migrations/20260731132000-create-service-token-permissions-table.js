/**
 * Creates `service_token_permissions`, the join table granting individual
 * permissions (from the same shared `permissions` catalog used for users)
 * to individual service tokens. Structurally identical to `user_permissions`
 * -- a token's effective permission set is simply the rows here for its
 * `service_token_id`.
 *
 * @fileoverview Migration creating the `service_token_permissions` grant table.
 * @author Isaac Travers
 * @module migrations/create-service-token-permissions-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `service_token_permissions` and its indexes/constraints inside
   * a single transaction.
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
        'service_token_permissions',
        {
          service_token_permission_id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            comment: 'Unique identifier for this permission grant.',
          },
          service_token_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
              model: 'service_tokens',
              key: 'service_token_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
            comment: 'Foreign key referencing the token this permission is granted to (service_tokens.service_token_id).',
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
            comment: 'Audit-only reference to the admin who granted this permission; null if granted by another token/service, unknown, or later removed.',
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

      await queryInterface.addIndex('service_token_permissions', ['service_token_id'], {
        name: 'service_token_permissions_token_id_idx',
        transaction,
      });

      await queryInterface.addIndex('service_token_permissions', ['service_token_id', 'permission_id'], {
        name: 'service_token_permissions_token_permission_unique',
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
   * Reverses this migration by dropping `service_token_permissions`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('service_token_permissions', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
