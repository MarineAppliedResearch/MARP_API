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
 *       description: Frame-specific annotation associated with an observation.
 *       properties:
 *         keyframe_id:
 *           type: integer
 *           example: 48291
 *         observation_id:
 *           type: integer
 *           example: 12045
 *         frame:
 *           type: integer
 *           example: 18520
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
  