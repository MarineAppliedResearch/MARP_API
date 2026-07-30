/**
 * Sequelize model definition for biological and habitat observations.
 *
 * This module defines the database fields, constraints, indexes, and model
 * associations used by observation records throughout the MARP API.
 *
 * Observation records connect project, session, user, taxonomy, video,
 * annotation, habitat, review, and machine-learning information. Related
 * keyframes describe frame-specific annotation data belonging to an
 * observation, and curated machine-learning datasets can include
 * observations through the dataset_observations join table.
 *
 * The `Observation` OpenAPI schema (generated from this model's Sequelize
 * attributes, see docs/openapi.js) covers fields stored directly on the
 * observation record. The composite `ObservationWithKeyframes`,
 * `ObservationWithSessionAndKeyframes`, and `ObservationWithDatasets` schemas
 * that extend it with association data live in docs/openapi.js instead of
 * here, since they aren't derivable from a single Sequelize model.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for observations.
 * @author Isaac Travers
 * @module model/observations
 */


const { Model } = require('sequelize');


/**
 * Create and initialize the observations Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to related models through
 * {@link Observations.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized observations model.
 */
module.exports = (sequelize, DataTypes) => {

    /**
     * Sequelize model representing one observation database record.
     *
     * @class Observations
     * @extends Model
     */
    class Observations extends Model {

        /**
         * Register relationships between observations and related models.
         *
         * Associations are configured after all Sequelize models have been
         * loaded into the shared model registry.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {

            // Connect each observation to its associated project.
            this.belongsTo(models.projects, {
                sourceKey: 'project_id',
                foreignKey: 'project_id',
                as: 'project',
            });

            // Connect each observation to the user associated with the record.
            this.belongsTo(models.users, {
                sourceKey: 'user_id',
                foreignKey: 'user_id',
                as: 'user',
            });

            // Connect each observation to the session in which it was recorded.
            this.belongsTo(models.sessions, {
                sourceKey: 'session_id',
                foreignKey: 'session_id',
                as: 'session',
            });

            // Connect each observation to its frame-specific keyframe records.
            this.hasMany(models.keyframes, {
                sourceKey: 'observation_id',
                foreignKey: 'observation_id',
                as: 'keyframes',

                // Delete dependent keyframes when their observation is deleted.
                onDelete: 'CASCADE',
            });

            // Curated datasets can include many observations, and one
            // observation can appear in many datasets.
            this.belongsToMany(models.datasets, {
                through: models.dataset_observations,
                as: 'datasets',
                foreignKey: 'observation_id',
                otherKey: 'dataset_id',
            });
        }
    }


    // Define the database fields and validation rules for observation records.
    Observations.init(
        {
            // Primary database identifier generated for each observation.
            observation_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                primaryKey: true,
                autoIncrement: true,
                jsonSchema: {
                    description: 'Primary database identifier for the observation.',
                    examples: [12045],
                },
            },

            // Observation identifier used by the source observation workflow.
            obsID: {
                type: DataTypes.INTEGER,
                allowNull: false,
                jsonSchema: {
                    description: 'Observation identifier used within the source workflow.',
                    examples: [42],
                },
            },

            // Optional identifier of a parent observation.
            PobsID: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Optional parent observation identifier.',
                    examples: [17],
                },
            },

            // Optional project directly associated with the observation.
            project_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'projects',
                    key: 'project_id',
                },
                jsonSchema: {
                    description: 'Identifier of the project associated with the observation.',
                    examples: [24],
                },
            },

            // Optional session in which the observation was recorded.
            session_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'sessions',
                    key: 'session_id',
                },
                jsonSchema: {
                    description: 'Identifier of the session associated with the observation.',
                    examples: [718],
                },
            },

            // Optional user associated with the observation record.
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'users',
                    key: 'user_id',
                },
                jsonSchema: {
                    description: 'Identifier of the user associated with the observation.',
                    examples: [12],
                },
            },

            // Starting time code of the observation in the source media.
            tc: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Starting time code for the observation.',
                    examples: ['00:12:21.520'],
                },
            },

            // Stored source-frame value associated with the observation.
            frame: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Stored source-frame value associated with the observation.',
                    examples: ['18322'],
                },
            },

            // Taxonomic serial identifier associated with the observation.
            taxserial: {
                type: DataTypes.INTEGER,
                allowNull: true,
                jsonSchema: {
                    description: 'Taxonomic serial identifier associated with the observation.',
                    examples: [1054],
                },
            },

            // Common name assigned to the observed biological taxon.
            comname: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Common name assigned to the observed taxon.',
                    examples: ['Bat star'],
                },
            },

            // Number of individuals represented by the observation.
            count: {
                type: DataTypes.INTEGER,
                allowNull: true,
                jsonSchema: {
                    description: 'Number of individuals represented by the observation.',
                    examples: [1],
                },
            },

            // Recorded sex classification when available.
            sex: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Recorded sex classification when available.',
                    examples: ['Unknown'],
                },
            },

            // Coarse size category assigned to the observation.
            coarsesize: {
                type: DataTypes.INTEGER,
                allowNull: true,
                jsonSchema: {
                    description: 'Coarse size classification assigned to the observation.',
                    examples: [3],
                },
            },

            // Stored size-review state or classification.
            sizereview: {
                type: DataTypes.INTEGER,
                allowNull: true,
                jsonSchema: {
                    description: 'Stored size-review state or classification.',
                    examples: [1],
                },
            },

            // Quadrant associated with the observation.
            quadrant: {
                type: DataTypes.INTEGER,
                allowNull: true,
                jsonSchema: {
                    description: 'Quadrant value associated with the observation.',
                    examples: [2],
                },
            },

            // Ending time code of the observation in the source media.
            etc: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Ending time code for the observation.',
                    examples: ['00:12:29.840'],
                },
            },

            // Taxonomic review status or code.
            taxReview: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Taxonomic review status or code.',
                    examples: ['R'],
                },
            },

            // Free-text note describing the observation.
            note: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Free-text note associated with the observation.',
                    examples: ['Partially obscured behind rock.'],
                },
            },

            // Stored down-camera value associated with the observation.
            downcamera: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Stored down-camera value associated with the observation.',
                    examples: ['false'],
                },
            },

            // Stored time-log value associated with the observation.
            timelog: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Stored observation time-log value.',
                    examples: ['2024-07-30 19:21:14'],
                },
            },

            // Name or identifier of the source video.
            video_source: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Video source associated with the observation.',
                    examples: ['20240730_190910 Fwd.mp4'],
                },
            },

            // Stored filesystem, server, or logical location of the source video.
            videoLocation: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Stored location of the associated video.',
                    examples: ['/CAMPA2024/Dive12/FWD'],
                },
            },

            // Stored position of the observation within the source media.
            mediaPosition: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Stored position of the observation within the source media.',
                    examples: ['741.520'],
                },
            },

            // Stored actual-position value associated with the observation.
            actualPosition: {
                type: DataTypes.STRING(255),
                allowNull: true,
                defaultValue: null,
                jsonSchema: {
                    description: 'Stored actual-position value associated with the observation.',
                    examples: ['741.520'],
                },
            },

            // Substrate classification flags allow multiple substrate types to
            // be recorded for the same observation.
            substrate_bedrock: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether bedrock substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_megaclast: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether megaclast substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_boulder: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether boulder substrate was recorded.',
                    examples: [true],
                },
            },

            substrate_cobble: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether cobble substrate was recorded.',
                    examples: [true],
                },
            },

            substrate_pebble: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether pebble substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_granule: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether granule substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_sand: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether sand substrate was recorded.',
                    examples: [true],
                },
            },

            substrate_mud: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether mud substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_coral_reef: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether coral-reef substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_coral_rubble: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether coral-rubble substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_shell_hash: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether shell-hash substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_shell_rubble: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether shell-rubble substrate was recorded.',
                    examples: [false],
                },
            },

            substrate_algal: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: false,
                jsonSchema: {
                    description: 'Indicates whether algal substrate was recorded.',
                    examples: [false],
                },
            },

            // Optional model confidence score represented on a zero-to-one scale.
            confidence: {
                type: DataTypes.DOUBLE,
                allowNull: true,
                comment: 'Confidence score (0.0–1.0)',
                jsonSchema: {
                    schema: { type: 'number', format: 'double', minimum: 0, maximum: 1 },
                    description: 'Machine-learning confidence score between zero and one.',
                    examples: [0.93],
                },
            },
        },
        {
            // Use the shared Sequelize connection supplied to the model factory.
            sequelize,

            // Register the model under the observations name.
            modelName: 'observations',

            // Map the model directly to the existing observations table.
            tableName: 'observations',
            schema: 'public',

            // Maintain Sequelize-created createdAt and updatedAt fields.
            timestamps: true,

            // Prevent Sequelize from pluralizing or modifying the table name.
            freezeTableName: true,

            // Preserve the field names declared above instead of converting
            // them automatically to underscored database-column names.
            underscored: false,

            // Do not allow synchronization to alter the existing table schema.
            sync: {
                alter: false,
            },

            // Declare the existing primary-key index for Sequelize metadata.
            indexes: [
                {
                    name: 'observations_pkey',
                    unique: true,
                    fields: ['observation_id'],
                },
            ],
        }
    );

    // Return the initialized model to the central model registry.
    return Observations;
};