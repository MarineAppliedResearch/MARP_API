/**
 * Sequelize model definition for the metaInfo table.
 *
 * Defines the `metaInfo` table, a small key-style table used to hold
 * miscellaneous named metadata records.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for metaInfo.
 * @author Isaac Travers
 * @module model/metaInfo
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     MetaInfo:
 *       type: object
 *       description: >
 *         A single named metadata record used to store miscellaneous
 *         reference information for MARP.
 *       required:
 *         - id
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique numeric identifier for this metadata record.
 *         name:
 *           type: string
 *           nullable: true
 *           description: Name of this metadata entry.
 */

/**
 * Create and initialize the metaInfo Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized metaInfo model.
 */
module.exports = (sequelize, DataTypes) => {

    /**
     * Sequelize model representing one metaInfo record.
     *
     * @class MetaInfo
     * @extends Model
     */
    class MetaInfo extends Model {}

    MetaInfo.init({
        // Model attributes are defined here
        id: {
          // The Observation id of this observation. This is meant to be the primary key..
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING
        }
      }, {
        // Other model options go here
        sequelize,             // We need to pass the connection instance
        modelName: 'metaInfo'  // We need to choose the model name
      });

      return MetaInfo;
}