/**
 * Sequelize model definition for the per-observation thumbnail record.
 *
 * One row per observation, holding what the filesystem cannot say: whether a
 * picture has been asked for, whether it failed, and whether retrying could ever
 * help. **The file is the truth for the bytes** -- `status = 'ready'` says a
 * picture was made, and the serving route answers 404 with an explanation when
 * the row has outlived the file, exactly as the species picture routes do.
 *
 * Deliberately not columns on `observations`: `updatedAt` there is a mosaic sort
 * field and `version` is the commit routes' concurrency token, so writing a
 * thumbnail state onto that row would reorder the mosaic under a reviewer and
 * make every commit conflict because a picture arrived.
 *
 * The absence of a row is a state in its own right -- *nothing has ever been
 * asked for* -- and is never written. Serving a mosaic page enqueues what is
 * missing, so absence reports `queued` to the client.
 *
 * Refs #118.
 *
 * @fileoverview Sequelize model for observation_thumbnails.
 * @author Isaac Travers
 * @module model/observation_thumbnails
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the observation_thumbnails Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized observation_thumbnails model.
 */
module.exports = (sequelize, DataTypes) => {
    /**
     * Sequelize model representing one observation's thumbnail record.
     *
     * @class ObservationThumbnail
     * @extends Model
     */
    class ObservationThumbnail extends Model {
        /**
         * Register the relationship to the observation this pictures.
         *
         * @param {Object} models - Initialized Sequelize model registry.
         * @returns {void}
         */
        static associate(models) {
            this.belongsTo(models.observations, {
                sourceKey: 'observation_id',
                foreignKey: 'observation_id',
                as: 'observation',
            });
        }
    }

    ObservationThumbnail.init(
        {
            observation_thumbnail_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                primaryKey: true,
                autoIncrement: true,
                comment: 'Identifier for this thumbnail record.',
            },
            observation_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
                references: { model: 'observations', key: 'observation_id' },
                comment: 'The observation this picture is of.',
            },
            status: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: 'queued',
                comment: 'queued, ready or failed.',
            },
            permanent: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: 'A failure retrying cannot help.',
            },
            framenum: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'The absolute frame the picture was cut from.',
            },
            subset: {
                type: DataTypes.STRING(64),
                allowNull: true,
                comment: 'Which track within the observation the box came from.',
            },
            filename: {
                type: DataTypes.STRING(255),
                allowNull: true,
                unique: true,
                comment: 'Path relative to storage/observation-thumbnails/.',
            },
            content_type: {
                type: DataTypes.STRING(64),
                allowNull: true,
                comment: 'MIME type, used directly as the Content-Type when serving.',
            },
            byte_size: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Size of the file in bytes.',
            },
            width: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Width of the stored tile, in pixels.',
            },
            height: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Height of the stored tile, in pixels.',
            },
            source_width: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Width of the decoded frame the crop was computed against.',
            },
            source_height: {
                type: DataTypes.INTEGER,
                allowNull: true,
                comment: 'Height of the decoded frame the crop was computed against.',
            },
            generation: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1,
                comment: 'Bumped by every re-extraction. What the served ETag is built from.',
            },
            attempts: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: 'How many times extraction has been claimed for this row.',
            },
            last_error: {
                type: DataTypes.TEXT,
                allowNull: true,
                comment: 'Why the last attempt failed. Never a stream URL: that embeds an access token.',
            },
            requested_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'When this thumbnail was first asked for. The queue is served in this order.',
            },
            claimed_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'When an extractor took this row. With a timeout, the lease that lets a dead extraction be reclaimed.',
            },
            completed_at: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'When extraction last finished, successfully or not.',
            },
        },
        {
            sequelize,
            modelName: 'observation_thumbnails',
            tableName: 'observation_thumbnails',
            schema: 'public',
            timestamps: true,
            // The table uses snake_case timestamps, matching observation_reviews
            // and species_pictures rather than the quoted camelCase on
            // observations.
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            comment: 'One thumbnail record per observation: the state a file cannot express, and the reference to the file itself.',
        }
    );

    return ObservationThumbnail;
};
