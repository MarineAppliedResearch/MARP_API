/**
 * Creates `auth_identities`, the credentials table backing local
 * username/password login and (in a later phase) linked external
 * identities such as Google. Kept separate from `users` so `users` stays
 * the canonical person/profile table rather than becoming a credential
 * table.
 *
 * A partial unique index on `user_id` where `provider='local'` enforces
 * exactly one local credential set per user -- a plain unique index on
 * `(provider, provider_subject)` would not catch this, since Postgres
 * treats every `NULL` `provider_subject` as distinct.
 *
 * @fileoverview Migration creating the `auth_identities` table.
 * @author Isaac Travers
 * @module migrations/create-auth-identities-table
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Creates `auth_identities` with its indexes and check constraints
   * inside a single transaction.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, exposing data types and operators used in column/constraint definitions.
   * @returns {Promise<void>} Resolves once the table, indexes, and constraints have been created.
   * @throws {Error} Re-throws after rolling back if table, index, or constraint creation fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'auth_identities',
        {
          auth_identity_id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            comment: 'Unique identifier for this authentication identity record.',
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
            comment: 'Foreign key referencing the MARP user this credential belongs to (users.user_id).',
          },
          provider: {
            type: Sequelize.STRING(30),
            allowNull: false,
            comment: 'Identity provider namespace for this credential ("local" for username/password, or an external provider such as "google").',
          },
          provider_subject: {
            type: Sequelize.STRING(255),
            allowNull: true,
            comment: 'External provider subject identifier (e.g. a Google account id); always null for local username/password credentials.',
          },
          password_hash: {
            type: Sequelize.TEXT,
            allowNull: true,
            comment: 'Argon2 password hash for local credentials; required when provider is "local", always null for external identities.',
          },
          password_changed_at: {
            type: Sequelize.DATE,
            allowNull: true,
            comment: 'Timestamp of the most recent password hash rotation or reset for this credential.',
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

      await queryInterface.addIndex('auth_identities', ['user_id'], {
        name: 'auth_identities_user_id_idx',
        transaction,
      });

      await queryInterface.addIndex('auth_identities', ['provider', 'provider_subject'], {
        name: 'auth_identities_provider_subject_unique_not_null',
        unique: true,
        where: {
          provider_subject: {
            [Sequelize.Op.ne]: null,
          },
        },
        transaction,
      });

      await queryInterface.addIndex('auth_identities', ['user_id'], {
        name: 'auth_identities_one_local_per_user',
        unique: true,
        where: {
          provider: 'local',
        },
        transaction,
      });

      await queryInterface.addConstraint('auth_identities', {
        fields: ['provider'],
        type: 'check',
        name: 'auth_identities_provider_allowed_values',
        where: {
          provider: ['local', 'google'],
        },
        transaction,
      });

      await queryInterface.addConstraint('auth_identities', {
        fields: ['provider', 'password_hash'],
        type: 'check',
        name: 'auth_identities_local_password_required',
        where: {
          [Sequelize.Op.or]: [
            {
              provider: {
                [Sequelize.Op.ne]: 'local',
              },
            },
            {
              password_hash: {
                [Sequelize.Op.ne]: null,
              },
            },
          ],
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
   * Reverses this migration by dropping `auth_identities`.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once the table has been dropped.
   * @throws {Error} Re-throws after rolling back if the drop fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('auth_identities', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
