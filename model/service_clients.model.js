/**
 * Sequelize model definition for service clients (applications).
 *
 * Represents one external application/service that authenticates to MARP
 * with a bearer token rather than a human session. One service client can
 * hold many tokens over its lifetime (see `model/service_tokens.model.js`),
 * so rotating or revoking a token never loses the application's identity
 * or history.
 *
 * @fileoverview Sequelize model for service client (application) records.
 * @author Isaac Travers
 * @module model/service_clients
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the ServiceClients Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized ServiceClients model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one application/service client.
   *
   * @class service_clients
   * @extends Model
   */
  class ServiceClients extends Model {
    /**
     * Register model associations.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Every bearer token issued for this application.
      if (models.service_tokens) {
        this.hasMany(models.service_tokens, {
          foreignKey: 'service_client_id',
          as: 'tokens',
        });
      }

      // Audit-only: the admin who registered this application, if known.
      this.belongsTo(models.users, {
        foreignKey: 'created_by_user_id',
        targetKey: 'user_id',
        as: 'createdBy',
      });
    }
  }

  ServiceClients.init(
    {
      service_client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        comment: 'Unique identifier for this application/service client.',
        jsonSchema: {
            description: 'Unique identifier for this application/service client.',
            examples: [1],
        },
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        comment: 'Human-readable name identifying this application (e.g. "Reporting Worker").',
        jsonSchema: {
            schema: { type: 'string', minLength: 1, maxLength: 120 },
            description: 'Human-readable name identifying this application (e.g. "Reporting Worker").',
            examples: ['Reporting Worker'],
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Optional freeform notes about what this application does or who owns it.',
        jsonSchema: {
            nullable: true,
            description: 'Optional freeform notes about what this application does or who owns it.',
            examples: ['Nightly job that pulls dashboard metrics.'],
        },
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active',
        comment: 'Lifecycle state of this application ("active" or "disabled").',
        jsonSchema: {
            schema: { type: 'string', enum: ['active', 'disabled'] },
            description: 'Lifecycle state of this application. A disabled application\'s tokens are all rejected regardless of their own state.',
            examples: ['active'],
        },
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Audit-only reference to the admin who registered this application; null if unknown or later removed.',
        jsonSchema: {
            nullable: true,
            description: 'Audit-only reference to the admin who registered this application; null if unknown or later removed.',
            examples: [19],
        },
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of the most recent successful bearer-token authentication for any token under this application.',
        jsonSchema: {
            nullable: true,
            description: 'Timestamp of the most recent successful bearer-token authentication for any token under this application.',
            examples: ['2026-07-31T12:34:56.000Z'],
        },
      },
    },
    {
      sequelize,
      modelName: 'service_clients',
      tableName: 'service_clients',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          // Application names must be unique for unambiguous admin-UI selection.
          name: 'service_clients_name_unique',
          unique: true,
          fields: ['name'],
        },
      ],
    }
  );

  return ServiceClients;
};
