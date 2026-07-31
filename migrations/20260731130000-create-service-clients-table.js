/**
 * Creates `service_clients`, representing one external application/service
 * that can authenticate to MARP with a bearer token instead of a human
 * session. Deliberately separate from `service_tokens` (created by the
 * next migration) -- one app can hold many tokens over its lifetime, so
 * rotating or revoking a token never loses the app's identity or history.
 *
 * @fileoverview Migration creating the `service_clients` (apps) table.
 * @author Isaac Travers
 * @module migrations/create-service-clients-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `service_clients` and its indexes/constraints inside a single
   * transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column/constraint definitions.
   * @returns {Promise<void>} Resolves once the table, indexes, and constraints have been created.
   * @throws {Error} Re-throws after rolling back if table, index, or constraint creation fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'service_clients',
        {
          service_client_id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            comment: 'Unique identifier for this application/service client.',
          },
          name: {
            type: Sequelize.STRING(120),
            allowNull: false,
            comment: 'Human-readable name identifying this application (e.g. "Reporting Worker").',
          },
          description: {
            type: Sequelize.TEXT,
            allowNull: true,
            comment: 'Optional freeform notes about what this application does or who owns it.',
          },
          status: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'active',
            comment: 'Lifecycle state of this application ("active" or "disabled").',
          },
          created_by_user_id: {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: {
              model: 'users',
              key: 'user_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
            comment: 'Audit-only reference to the admin who registered this application; null if unknown or later removed.',
          },
          last_used_at: {
            type: Sequelize.DATE,
            allowNull: true,
            comment: 'Timestamp of the most recent successful bearer-token authentication for any token under this application.',
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

      await queryInterface.addIndex('service_clients', ['name'], {
        name: 'service_clients_name_unique',
        unique: true,
        transaction,
      });

      await queryInterface.addConstraint('service_clients', {
        fields: ['status'],
        type: 'check',
        name: 'service_clients_status_allowed_values',
        where: {
          status: ['active', 'disabled'],
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
   * Reverses this migration by dropping `service_clients`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('service_clients', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
