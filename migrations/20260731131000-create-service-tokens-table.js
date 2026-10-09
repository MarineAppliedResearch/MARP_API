/**
 * Creates `service_tokens`, the actual bearer credentials issued to one
 * `service_clients` application. Only a SHA-256 hash of the token is ever
 * stored -- the raw secret is generated, hashed, and returned to the
 * caller exactly once (issue/regenerate), then discarded server-side.
 * `token_prefix` stores a short, non-secret slice of the raw token purely
 * so an admin can visually recognize which token is which without ever
 * seeing the full secret again.
 *
 * @fileoverview Migration creating the `service_tokens` table.
 * @author Isaac Travers
 * @module migrations/create-service-tokens-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `service_tokens` and its indexes inside a single transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types used in column definitions.
   * @returns {Promise<void>} Resolves once the table and indexes have been created.
   * @throws {Error} Re-throws after rolling back if table or index creation fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'service_tokens',
        {
          service_token_id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            comment: 'Unique identifier for this bearer token.',
          },
          service_client_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
              model: 'service_clients',
              key: 'service_client_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
            comment: 'Foreign key referencing the application this token authenticates as (service_clients.service_client_id).',
          },
          token_prefix: {
            type: Sequelize.STRING(16),
            allowNull: false,
            comment: 'Non-secret leading slice of the raw token, shown in admin UI to identify this token without exposing the full secret.',
          },
          token_hash: {
            type: Sequelize.TEXT,
            allowNull: false,
            comment: 'SHA-256 hex digest of the raw token. The raw token itself is never stored.',
          },
          expires_at: {
            type: Sequelize.DATE,
            allowNull: true,
            comment: 'Optional expiration timestamp; null means the token does not expire on its own and must be explicitly revoked.',
          },
          revoked_at: {
            type: Sequelize.DATE,
            allowNull: true,
            comment: 'Timestamp this token was revoked, if it has been. A revoked token is rejected even if not yet expired.',
          },
          last_used_at: {
            type: Sequelize.DATE,
            allowNull: true,
            comment: 'Timestamp of the most recent successful authentication with this specific token.',
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
            comment: 'Audit-only reference to the admin who issued this token; null if unknown or later removed.',
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

      await queryInterface.addIndex('service_tokens', ['service_client_id'], {
        name: 'service_tokens_service_client_id_idx',
        transaction,
      });

      await queryInterface.addIndex('service_tokens', ['token_hash'], {
        name: 'service_tokens_token_hash_unique',
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
   * Reverses this migration by dropping `service_tokens`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('service_tokens', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
