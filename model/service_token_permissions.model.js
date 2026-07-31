/**
 * Sequelize model definition for the service_token_permissions join table.
 *
 * Structurally identical to `model/user_permissions.model.js` -- each row
 * grants one permission (from the same shared `permissions` catalog) to
 * one service token. A token's effective permission set is simply every
 * row here for its `service_token_id`.
 *
 * @fileoverview Sequelize model for individual service-token permission grants.
 * @author Isaac Travers
 * @module model/service_token_permissions
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the ServiceTokenPermissions Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized ServiceTokenPermissions model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one service-token permission grant.
   *
   * @class service_token_permissions
   * @extends Model
   */
  class ServiceTokenPermissions extends Model {
    /**
     * Register model associations.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // The token this permission was granted to.
      this.belongsTo(models.service_tokens, {
        foreignKey: 'service_token_id',
        targetKey: 'service_token_id',
        as: 'serviceToken',
      });

      // The permission being granted.
      this.belongsTo(models.permissions, {
        foreignKey: 'permission_id',
        targetKey: 'permission_id',
        as: 'permission',
      });

      // Audit-only: the admin who granted it, if known.
      this.belongsTo(models.users, {
        foreignKey: 'granted_by_user_id',
        targetKey: 'user_id',
        as: 'grantedBy',
      });
    }
  }

  ServiceTokenPermissions.init(
    {
      service_token_permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        comment: 'Unique identifier for this permission grant.',
        jsonSchema: {
            description: 'Unique identifier for this permission grant.',
            examples: [1],
        },
      },
      service_token_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the token this permission is granted to (service_tokens.service_token_id).',
        jsonSchema: {
            description: 'Foreign key referencing the token this permission is granted to (service_tokens.service_token_id).',
            examples: [1],
        },
      },
      permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the granted permission (permissions.permission_id).',
        jsonSchema: {
            description: 'Foreign key referencing the granted permission (permissions.permission_id).',
            examples: [1],
        },
      },
      granted_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Audit-only reference to the admin who granted this permission; null if granted by another token/service, unknown, or later removed.',
        jsonSchema: {
            nullable: true,
            description: 'Audit-only reference to the admin who granted this permission; null if granted by another token/service, unknown, or later removed.',
            examples: [19],
        },
      },
    },
    {
      sequelize,
      modelName: 'service_token_permissions',
      tableName: 'service_token_permissions',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          // Fast lookup of one token's granted permissions.
          name: 'service_token_permissions_token_id_idx',
          fields: ['service_token_id'],
        },
        {
          // A token cannot be granted the same permission twice.
          name: 'service_token_permissions_token_permission_unique',
          unique: true,
          fields: ['service_token_id', 'permission_id'],
        },
      ],
    }
  );

  return ServiceTokenPermissions;
};
