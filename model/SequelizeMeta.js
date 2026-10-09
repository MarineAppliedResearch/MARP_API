/**
 * Sequelize model definition for sequelize-cli's internal migration
 * bookkeeping table.
 *
 * `SequelizeMeta` is created and managed by sequelize-cli itself to track
 * which migration files have already been run; it is not a MARP domain
 * table and is never returned by any API endpoint, so it intentionally has
 * no corresponding `@openapi` component schema.
 *
 * This file is not part of the live model registry: model/index.js only
 * dynamically loads files matching `*.model.js`, and this file's name does
 * not match that pattern. Its only reference is model/init-models.js,
 * which is itself unused legacy code — so this model factory is not
 * currently invoked at runtime either. It is kept for documentation of the
 * table's shape.
 *
 * @fileoverview Sequelize model for sequelize-cli's migration-tracking table (currently unused at runtime).
 * @author Isaac Travers
 * @module model/SequelizeMeta
 */

const Sequelize = require('sequelize');

/**
 * Create and initialize the SequelizeMeta Sequelize model.
 *
 * @param {Object} sequelize - Sequelize connection to define the model against.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Object} Initialized SequelizeMeta model.
 */
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SequelizeMeta', {
    // Filename of a migration that has already been run; sequelize-cli's
    // primary key for tracking migration state.
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true
    }
  }, {
    sequelize,                       // shared Sequelize connection instance
    tableName: 'SequelizeMeta',      // actual PostgreSQL table
    schema: 'public',                // database schema containing the table
    timestamps: false,               // sequelize-cli manages this table itself
    indexes: [
      {
        name: "SequelizeMeta_pkey",  // primary key index
        unique: true,
        fields: [
          { name: "name" },
        ]
      },
    ]
  });
};
