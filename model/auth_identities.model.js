/**
 * Sequelize model definition for authentication identities.
 *
 * Stores login credentials and provider links for MARP users. A single
 * user may have one local identity (username/password) and, in later
 * phases, additional external identities (for example Google).
 *
 * @fileoverview Sequelize model for auth identity records.
 * @author Isaac Travers
 * @module model/auth_identities
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the AuthIdentities Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized AuthIdentities model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one authentication identity.
   *
   * @class auth_identities
   * @extends Model
   */
  class AuthIdentities extends Model {
    /**
     * Register model associations.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Each auth identity belongs to exactly one MARP user.
      this.belongsTo(models.users, {
        foreignKey: 'user_id',
        targetKey: 'user_id',
        as: 'user',
      });
    }
  }

  AuthIdentities.init(
    {
      auth_identity_id: {
        // Surrogate key for credential rows.
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        comment: 'Unique identifier for this authentication identity record.',
        jsonSchema: {
            description: 'Unique identifier for this authentication identity record.',
            examples: [12],
        },
      },
      user_id: {
        // FK to owning MARP user profile.
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the MARP user this credential belongs to (users.user_id).',
        jsonSchema: {
            description: 'Foreign key referencing the MARP user this credential belongs to (users.user_id).',
            examples: [42],
        },
      },
      provider: {
        // Identity provider namespace (local, google, etc.).
        type: DataTypes.STRING(30),
        allowNull: false,
        comment: 'Identity provider namespace for this credential ("local" for username/password, or an external provider such as "google").',
        jsonSchema: {
            schema: { type: 'string', enum: ['local', 'google'] },
            description: 'Identity provider namespace for this credential ("local" for username/password, or an external provider such as "google").',
            examples: ['local'],
        },
      },
      provider_subject: {
        // External provider subject id; null for local credentials.
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'External provider subject identifier (e.g. a Google account id); always null for local username/password credentials.',
        jsonSchema: {
            nullable: true,
            description: 'External provider subject identifier (e.g. a Google account id); always null for local username/password credentials.',
            examples: ['109876543210987654321'],
        },
      },
      password_hash: {
        // Argon2 hash for local credentials only.
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Argon2 password hash for local credentials; required when provider is "local", always null for external identities.',
        jsonSchema: {
            nullable: true,
            description: 'Argon2 password hash for local credentials; required when provider is "local", always null for external identities.',
        },
      },
      password_changed_at: {
        // Audit timestamp for password rotations/resets.
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of the most recent password hash rotation or reset for this credential.',
        jsonSchema: {
            nullable: true,
            description: 'Timestamp of the most recent password hash rotation or reset for this credential.',
            examples: ['2026-07-31T12:34:56.000Z'],
        },
      },
    },
    {
      sequelize,
      modelName: 'auth_identities',
      tableName: 'auth_identities',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          // Fast lookup for user -> identity joins.
          name: 'auth_identities_user_id_idx',
          fields: ['user_id'],
        },
        {
          // Prevent duplicate external identities from being linked twice.
          name: 'auth_identities_provider_subject_unique_not_null',
          unique: true,
          fields: ['provider', 'provider_subject'],
        },
      ],
    }
  );

  return AuthIdentities;
};
