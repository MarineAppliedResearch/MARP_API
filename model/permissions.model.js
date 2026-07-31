/**
 * Sequelize model definition for the permissions catalog.
 *
 * Each row is one named authorization capability (e.g. `admin`). Users are
 * granted individual permissions through the `user_permissions` join table,
 * not by a role/flag on the `users` row itself.
 *
 * @fileoverview Sequelize model for permission catalog records.
 * @author Isaac Travers
 * @module model/permissions
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the Permissions Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized Permissions model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one permission catalog entry.
   *
   * @class permissions
   * @extends Model
   */
  class Permissions extends Model {
    /**
     * Register model associations.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Every grant of this permission to a user.
      if (models.user_permissions) {
        this.hasMany(models.user_permissions, {
          foreignKey: 'permission_id',
          as: 'grants',
        });
      }

      // Every grant of this permission to a service token.
      if (models.service_token_permissions) {
        this.hasMany(models.service_token_permissions, {
          foreignKey: 'permission_id',
          as: 'tokenGrants',
        });
      }
    }
  }

  Permissions.init(
    {
      permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        comment: 'Unique identifier for this permission definition.',
        jsonSchema: {
            description: 'Unique identifier for this permission definition.',
            examples: [1],
        },
      },
      key: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Stable machine-readable permission identifier (e.g. "admin"), referenced by requirePermission() checks.',
        jsonSchema: {
            schema: { type: 'string', minLength: 1, maxLength: 50 },
            description: 'Stable machine-readable permission identifier (e.g. "admin"), referenced by requirePermission() checks.',
            examples: ['admin'],
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Human-readable explanation of what this permission grants, shown in admin UI.',
        jsonSchema: {
            nullable: true,
            description: 'Human-readable explanation of what this permission grants, shown in admin UI.',
            examples: ['Full administrative access: create, update, and soft-delete users; view and change user permissions; set user passwords.'],
        },
      },
    },
    {
      sequelize,
      modelName: 'permissions',
      tableName: 'permissions',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          // Permission keys must be unique so requirePermission(key) lookups are unambiguous.
          name: 'permissions_key_unique',
          unique: true,
          fields: ['key'],
        },
      ],
    }
  );

  return Permissions;
};
