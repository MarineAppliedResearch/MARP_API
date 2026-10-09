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
        autoIncrement: true,
        jsonSchema: {
            readOnly: true,
            description: 'Unique identifier for this keyframe record.',
            examples: [48291],
        },
      },
      // Foreign key to link the keyframe to an observation
      observation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'observations',
          key: 'observation_id'
        },
        jsonSchema: {
            description: 'Foreign key to the parent observation record.',
            examples: [12045],
        },
      },
      // Subset identifier to group keyframes by annotation within an observation
      subset: {
        type: DataTypes.STRING,
        allowNull: false,
        jsonSchema: {
            description:
                'Tracker/group label used to separate multiple boxed items within the same observation (for example, subset "0" and subset "1" for two independently tracked items).',
            examples: ['0'],
        },
      },
      comname: {
        type: DataTypes.STRING,
        allowNull: false,
        jsonSchema: {
            description: 'Common-name label assigned to this keyframe annotation.',
            examples: ['Bat star'],
        },
      },
      // Type of the keyframe (start, middle, end). Stored as a plain STRING
      // rather than a DB-level ENUM (see commented-out line below), so this
      // enum constraint is documentation-only, not database-enforced.
      type: {
        //type: DataTypes.ENUM('start', 'middle', 'end'),
        type: DataTypes.STRING,
        allowNull: false,
        jsonSchema: {
            schema: { type: 'string', enum: ['start', 'middle', 'end'] },
            description: 'Position marker in the tracked sequence for this subset.',
            examples: ['start'],
        },
      },
      // The hand-written OpenAPI schema this migrated from also documented a
      // `frame` property, but no such attribute was ever defined here -- it
      // never actually appeared in a real API response. Not carried forward.
      framenum: {
        type: DataTypes.INTEGER,
        allowNull: false,
        jsonSchema: {
            description: 'Frame-position value captured by the current keyframe workflow.',
            examples: [18520],
        },
      },
      // X-coordinate of the annotation rectangle
      x: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        jsonSchema: {
            schema: { type: 'number', format: 'double', minimum: 0, maximum: 1 },
            description: 'Normalized left coordinate of the annotation box (0..1).',
            examples: [0.423],
        },
      },
      // Y-coordinate of the annotation rectangle
      y: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        jsonSchema: {
            schema: { type: 'number', format: 'double', minimum: 0, maximum: 1 },
            description: 'Normalized top coordinate of the annotation box (0..1).',
            examples: [0.318],
        },
      },
      // Height of the annotation rectangle
      height: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        jsonSchema: {
            schema: { type: 'number', format: 'double', minimum: 0, maximum: 1 },
            description: 'Normalized annotation-box height (0..1).',
            examples: [0.169],
        },
      },
      // Width of the annotation rectangle
      width: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        jsonSchema: {
            schema: { type: 'number', format: 'double', minimum: 0, maximum: 1 },
            description: 'Normalized annotation-box width (0..1).',
            examples: [0.112],
        },
      },
      confidence: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        comment: 'Confidence score (0.0–1.0)',
        jsonSchema: {
            schema: { type: 'number', format: 'double', minimum: 0, maximum: 1 },
            description: 'Optional model confidence score for this annotation.',
            examples: [0.91],
        },
      }
    }, {
      sequelize,                    // shared Sequelize connection instance
      modelName: 'keyframes'        // used inside Sequelize
    });

    
  
    return Keyframes;
  };
  