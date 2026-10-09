/**
 * Sequelize model definition for service tokens.
 *
 * A bearer credential issued to one `service_clients` application. Only a
 * SHA-256 hash of the raw token is ever persisted -- the raw secret exists
 * only in the API response body at issue/regenerate time, never stored.
 *
 * @fileoverview Sequelize model for service token records.
 * @author Isaac Travers
 * @module model/service_tokens
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the ServiceTokens Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized ServiceTokens model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one bearer token.
   *
   * @class service_tokens
   * @extends Model
   */
  class ServiceTokens extends Model {
    /**
     * Register model associations.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // The application this token authenticates as.
      this.belongsTo(models.service_clients, {
        foreignKey: 'service_client_id',
        targetKey: 'service_client_id',
        as: 'serviceClient',
      });

      // Audit-only: the admin who issued this token, if known.
      this.belongsTo(models.users, {
        foreignKey: 'created_by_user_id',
        targetKey: 'user_id',
        as: 'createdBy',
      });

      // Every permission grant on this token.
      if (models.service_token_permissions) {
        this.hasMany(models.service_token_permissions, {
          foreignKey: 'service_token_id',
          as: 'tokenPermissions',
        });
      }
    }
  }

  ServiceTokens.init(
    {
      service_token_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        comment: 'Unique identifier for this bearer token.',
        jsonSchema: {
            description: 'Unique identifier for this bearer token.',
            examples: [1],
        },
      },
      service_client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the application this token authenticates as (service_clients.service_client_id).',
        jsonSchema: {
            description: 'Foreign key referencing the application this token authenticates as (service_clients.service_client_id).',
            examples: [1],
        },
      },
      token_prefix: {
        type: DataTypes.STRING(16),
        allowNull: false,
        comment: 'Non-secret leading slice of the raw token, shown in admin UI to identify this token without exposing the full secret.',
        jsonSchema: {
            description: 'Non-secret leading slice of the raw token, shown in admin UI to identify this token without exposing the full secret.',
            examples: ['svc_a1b2c3d4'],
        },
      },
      token_hash: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'SHA-256 hex digest of the raw token. The raw token itself is never stored.',
        jsonSchema: {
            description: 'SHA-256 hex digest of the raw token. Never exposed through the API.',
        },
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Optional expiration timestamp; null means the token does not expire on its own and must be explicitly revoked.',
        jsonSchema: {
            nullable: true,
            description: 'Optional expiration timestamp; null means the token does not expire on its own and must be explicitly revoked.',
            examples: ['2027-07-31T00:00:00.000Z'],
        },
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp this token was revoked, if it has been. A revoked token is rejected even if not yet expired.',
        jsonSchema: {
            nullable: true,
            description: 'Timestamp this token was revoked, if it has been. A revoked token is rejected even if not yet expired.',
            examples: ['2026-08-01T00:00:00.000Z'],
        },
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of the most recent successful authentication with this specific token.',
        jsonSchema: {
            nullable: true,
            description: 'Timestamp of the most recent successful authentication with this specific token.',
            examples: ['2026-07-31T12:34:56.000Z'],
        },
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Audit-only reference to the admin who issued this token; null if unknown or later removed.',
        jsonSchema: {
            nullable: true,
            description: 'Audit-only reference to the admin who issued this token; null if unknown or later removed.',
            examples: [19],
        },
      },
    },
    {
      sequelize,
      modelName: 'service_tokens',
      tableName: 'service_tokens',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          // Fast lookup for one application's tokens.
          name: 'service_tokens_service_client_id_idx',
          fields: ['service_client_id'],
        },
        {
          // Bearer-auth lookup is by hash; must be unique to identify one token.
          name: 'service_tokens_token_hash_unique',
          unique: true,
          fields: ['token_hash'],
        },
      ],
    }
  );

  return ServiceTokens;
};
