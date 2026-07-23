/**
 * Sequelize model definition for observation keyframes.
 *
 * Defines the `keyframes` table, which stores frame-specific bounding-box
 * annotations tied to an observation. Each record marks a single annotated
 * frame (start, middle, or end) for a species/subset within an observation's
 * video, including the annotation rectangle and optional model confidence.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for keyframes.
 * @author Isaac Travers
 * @module model/keyframe
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     Keyframe:
 *       type: object
 *       description: >
 *         Frame-level annotation associated with a single observation.
 *         One observation can contain multiple tracked subsets (for example,
 *         two boxed organisms tracked in parallel) distinguished by the
 *         `subset` field.
 *       required:
 *         - keyframe_id
 *         - observation_id
 *         - subset
 *         - comname
 *         - type
 *         - framenum
 *         - x
 *         - y
 *         - width
 *         - height
 *       properties:
 *         keyframe_id:
 *           type: integer
 *           example: 48291
 *           readOnly: true
 *           description: Unique identifier for this keyframe record.
 *         observation_id:
 *           type: integer
 *           example: 12045
 *           description: Foreign key to the parent observation record.
 *         subset:
 *           type: string
 *           example: "0"
 *           description: >
 *             Tracker/group label used to separate multiple boxed items within
 *             the same observation (for example, subset "0" and subset "1"
 *             for two independently tracked items).
 *         comname:
 *           type: string
 *           example: Bat star
 *           description: Common-name label assigned to this keyframe annotation.
 *         type:
 *           type: string
 *           enum: [start, middle, end]
 *           example: start
 *           description: Position marker in the tracked sequence for this subset.
 *         framenum:
 *           type: integer
 *           example: 18520
 *           description: >
 *             Frame-position value captured by the current keyframe workflow.
 *             See `frame` for an alternate frame-position label used by some
 *             contexts.
 *         frame:
 *           type: integer
 *           nullable: true
 *           example: 20
 *           description: >
 *             Optional alternate frame-position label used by some contexts.
 *             Semantics can vary by capture/export source and may represent a
 *             local frame index rather than the absolute video frame.
 *         x:
 *           type: number
 *           format: double
 *           minimum: 0
 *           maximum: 1
 *           example: 0.423
 *           description: Normalized left coordinate of the annotation box (0..1).
 *         y:
 *           type: number
 *           format: double
 *           minimum: 0
 *           maximum: 1
 *           example: 0.318
 *           description: Normalized top coordinate of the annotation box (0..1).
 *         width:
 *           type: number
 *           format: double
 *           minimum: 0
 *           maximum: 1
 *           example: 0.112
 *           description: Normalized annotation-box width (0..1).
 *         height:
 *           type: number
 *           format: double
 *           minimum: 0
 *           maximum: 1
 *           example: 0.169
 *           description: Normalized annotation-box height (0..1).
 *         confidence:
 *           type: number
 *           format: double
 *           minimum: 0
 *           maximum: 1
 *           nullable: true
 *           example: 0.91
 *           description: Optional model confidence score for this annotation.
 */


const { Model } = require('sequelize');

/**
 * Create and initialize the keyframes Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the observations model
 * through {@link Keyframes.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized keyframes model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * Sequelize model representing one frame-specific annotation belonging
     * to an observation.
     *
     * @class Keyframes
     * @extends Model
     */
    class Keyframes extends Model {
      /**
       * Register relationships between keyframes and related models.
       *
       * Associations are configured after all Sequelize models have been
       * loaded into the shared model registry.
       *
       * @param {Object} models - Initialized Sequelize model registry.
       * @returns {void}
       */
      static associate(models) {
        this.belongsTo(models.observations, {
          sourceKey: 'observation_id',
          foreignKey: 'observation_id',
          as: 'observation',
          onDelete: 'CASCADE',
        });

        this.belongsTo(models.observations, {
          sourceKey: 'observation_id',
          foreignKey: 'observation_id',
          as: 'parentObservation',
          onDelete: 'CASCADE',
        });
      }
    }

    Keyframes.init({
      // Unique identifier for each keyframe
      keyframe_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true
      },
      // Foreign key to link the keyframe to an observation
      observation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'observations',
          key: 'observation_id'
        }
      },
      // Subset identifier to group keyframes by annotation within an observation
      subset: {
        type: DataTypes.STRING,
        allowNull: false
      },
      comname: {
        type: DataTypes.STRING,
        allowNull: false
      },
      // Type of the keyframe (start, middle, end)
      type: {
        //type: DataTypes.ENUM('start', 'middle', 'end'),
        type: DataTypes.STRING,
        allowNull: false
      },
      framenum: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      // X-coordinate of the annotation rectangle
      x: {
        type: DataTypes.DOUBLE,
        allowNull: false
      },
      // Y-coordinate of the annotation rectangle
      y: {
        type: DataTypes.DOUBLE,
        allowNull: false
      },
      // Height of the annotation rectangle
      height: {
        type: DataTypes.DOUBLE,
        allowNull: false
      },
      // Width of the annotation rectangle
      width: {
        type: DataTypes.DOUBLE,
        allowNull: false
      },
      confidence: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        comment: 'Confidence score (0.0–1.0)',
      }
    }, {
      sequelize,                    // shared Sequelize connection instance
      modelName: 'keyframes'        // used inside Sequelize
    });

    
  
    return Keyframes;
  };
  