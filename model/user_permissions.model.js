/**
 * Sequelize model definition for the user_permissions join table.
 *
 * Each row grants one permission (from the `permissions` catalog) to one
 * user. A user's effective permission set is simply every row here for
 * their `user_id`.
 *
 * @fileoverview Sequelize model for individual permission grant records.
 * @author Isaac Travers
 * @module model/user_permissions
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the UserPermissions Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized UserPermissions model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one permission grant.
   *
   * @class user_permissions
   * @extends Model
   */
  class UserPermissions extends Model {
    /**
     * Register model associations.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // The user this permission was granted to.
      this.belongsTo(models.users, {
        foreignKey: 'user_id',
        targetKey: 'user_id',
        as: 'user',
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

  UserPermissions.init(
    {
      user_permission_id: {
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
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Foreign key referencing the user this permission is granted to (users.user_id).',
        jsonSchema: {
            description: 'Foreign key referencing the user this permission is granted to (users.user_id).',
            examples: [19],
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
        comment: 'Audit-only reference to the admin who granted this permission; null if the granter is unknown or later removed.',
        jsonSchema: {
            nullable: true,
            description: 'Audit-only reference to the admin who granted this permission; null if the granter is unknown or later removed.',
            examples: [19],
        },
      },
    },
    {
      sequelize,
      modelName: 'user_permissions',
      tableName: 'user_permissions',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          // Fast lookup of one user's granted permissions.
          name: 'user_permissions_user_id_idx',
          fields: ['user_id'],
        },
        {
          // A user cannot be granted the same permission twice.
          name: 'user_permissions_user_permission_unique',
          unique: true,
          fields: ['user_id', 'permission_id'],
        },
      ],
    }
  );

  return UserPermissions;
};
