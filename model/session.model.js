/**
 * Sequelize model definition for dive/survey sessions.
 *
 * Defines the `sessions` table, which groups observations recorded during a
 * single dive or survey line. Each session ties together the project it was
 * conducted under, the user who ran it, and the dive/line metadata needed to
 * locate the associated video and annotation data.
 *
 * Sessions are the parent record for observations: every observation belongs
 * to exactly one session, and a session may have many observations.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for sessions.
 * @author Isaac Travers
 * @module model/session
 */

const { Model } = require('sequelize');

/**
 * @openapi
 * components:
 *   schemas:
 *     Session:
 *       type: object
 *       description: >
 *         Dive or survey session grouping the observations recorded during a
 *         single dive/line, along with its owning project and user.
 *       required:
 *         - session_id
 *         - dive
 *         - line
 *         - lineId
 *         - type
 *       properties:
 *         session_id:
 *           type: integer
 *           example: 501
 *           readOnly: true
 *           description: Unique numeric identifier for this session record.
 *         project_id:
 *           type: integer
 *           nullable: true
 *           example: 24
 *           description: Identifier of the project this session was conducted under.
 *         user_id:
 *           type: integer
 *           nullable: true
 *           example: 8
 *           description: Identifier of the user who recorded or owns this session.
 *         dive:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           example: Dive 12
 *           description: Dive identifier or name associated with this session.
 *         line:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           example: Line A
 *           description: Transect line identifier associated with this session.
 *         lineId:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           example: L-2024-012A
 *           description: Identifier of the specific survey line tied to this session.
 *         type:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           example: ROV
 *           description: Type or category of this session (e.g., survey platform or method).
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *           example: "2026-07-22T15:33:10.000Z"
 *           description: Timestamp when this session record was created.
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *           example: "2026-07-23T09:12:01.000Z"
 *           description: Timestamp when this session record was last updated.
 */

/**
 * Create and initialize the sessions Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the users, projects, and
 * observations models through {@link Sessions.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized sessions model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one dive/survey session record.
   *
   * Groups the observations recorded during a single dive or line, and
   * links back to the project and user responsible for it.
   *
   * @class Sessions
   * @extends Model
   */
  class Sessions extends Model {
    /**
     * Register relationships between sessions and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      this.belongsTo(models.users, {
        sourceKey: 'user_id',
        foreignKey: 'user_id',
        as: 'user',
      });

      this.belongsTo(models.projects, {
        sourceKey: 'project_id',
        foreignKey: 'project_id',
        as: 'project',
      });

      this.hasMany(models.observations, {
        sourceKey: 'session_id',
        foreignKey: 'session_id',
        as: 'observation',
      });
    }
  }

  Sessions.init(
    {
      session_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'projects',
          key: 'project_id',
        },
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'user_id',
        },
      },
      dive: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      line: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      lineId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      sequelize,               // shared Sequelize connection instance
      modelName: 'sessions',   // used inside Sequelize
      tableName: 'sessions',   // actual PostgreSQL table
      schema: 'public',        // database schema containing the table
      timestamps: true,        // maintain Sequelize-created createdAt/updatedAt fields
      indexes: [
        {
          name: 'sessions_pkey', // primary key index
          unique: true,
          fields: ['session_id'],
        },
      ],
    }
  );

  return Sessions;
};