/**
 * Sequelize model definition for users.
 *
 * Defines the `users` table, which identifies the individuals who record
 * sessions and observations throughout MARP. Each user is referenced by
 * foreign keys on the `sessions` and `observations` tables so that related
 * records can be attributed and rolled up by user.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for users.
 * @author Isaac Travers
 * @module model/user
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the Users Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the sessions and
 * observations models through {@link Users.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized Users model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one user record.
   *
   * Identifies an individual who owns sessions and observations recorded
   * throughout MARP.
   *
   * @class Users
   * @extends Model
   */
  class Users extends Model {

    /**
     * Register relationships between Users and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      this.hasMany(models.sessions, {
        sourceKey: 'user_id',
        foreignKey: 'user_id',
        as: 'session',
      });

      this.hasMany(models.observations, {
        sourceKey: 'user_id',
        foreignKey: 'user_id',
        as: 'observation',
      });
    }
  }

  Users.init(
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        jsonSchema: {
            readOnly: true,
            description: 'Unique numeric identifier for this user record.',
            examples: [12],
        },
      },
      name: {
        type: DataTypes.STRING(255),       // match existing column exactly
        allowNull: false,
        unique: 'users_name_key',          // keep same constraint name
        jsonSchema: {
            schema: { type: 'string', minLength: 1, maxLength: 255 },
            description: 'Unique display name used by API and reporting views.',
            examples: ['Jane Diver'],
        },
      },
    },
    {
      sequelize,                            // shared Sequelize connection instance
      modelName: 'users',                   // used inside Sequelize
      tableName: 'users',                   // explicit table name
      schema: 'public',                     // database schema containing the table
      timestamps: true,                     // match old model
      indexes: [
        {
          name: 'users_name_key',           // enforces unique user names
          unique: true,
          fields: ['name'],
        },
        {
          name: 'users_pkey',               // primary key index
          unique: true,
          fields: ['user_id'],
        },
      ],
    }
  );

  return Users;
};