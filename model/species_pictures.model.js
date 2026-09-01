/**
 * Sequelize model definition for species pictures.
 *
 * Defines the `species_pictures` table, which records the pictures available for
 * a species and where each file lives. The bytes are on disk under
 * `storage/species-pictures/`, not in the database, so `filename` is a path
 * relative to that directory rather than the image itself.
 *
 * Pictures used to live only inside the annotation GUI, matched to a species by
 * a naming convention and a directory scan at display time. Moving them here
 * lets any MARP application show a picture of what it is naming, and makes the
 * species-to-picture association a recorded fact rather than a filename.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for species pictures.
 * @author Isaac Travers
 * @module model/species_pictures
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the species_pictures Sequelize model.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized species_pictures model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one picture of one species.
   *
   * @class SpeciesPictures
   * @extends Model
   */
  class SpeciesPictures extends Model {
    /**
     * Register relationships between species pictures and related models.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      this.belongsTo(models.species, {
        sourceKey: 'id',
        foreignKey: 'species_id',
        as: 'species',
      });

      // Who uploaded it, where that is known. Null for the imported set, which
      // predates any upload page.
      this.belongsTo(models.users, {
        sourceKey: 'user_id',
        foreignKey: 'uploaded_by',
        as: 'uploader',
      });
    }
  }

  SpeciesPictures.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        jsonSchema: {
          readOnly: true,
          description: 'Unique identifier for this picture.',
          examples: [1204],
        },
      },
      species_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'species', key: 'id' },
        jsonSchema: {
          description: 'Identifier of the species this picture depicts.',
          examples: [412],
        },
      },
      filename: {
        // Relative, so nothing stored here depends on where the API runs.
        type: DataTypes.STRING(255),
        allowNull: false,
        jsonSchema: {
          description: 'Path relative to the picture storage directory.',
          examples: ['412-1.png'],
        },
      },
      original_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        jsonSchema: {
          description: "Filename as supplied. For the imported set this keeps the GUI's original name, which is the only record of how the picture was matched to its species.",
          examples: ['Barred Sand Bass_167834_FI20200619.png'],
        },
      },
      content_type: {
        type: DataTypes.STRING(64),
        allowNull: false,
        jsonSchema: {
          description: 'MIME type, used as the Content-Type when serving the file.',
          examples: ['image/png'],
        },
      },
      byte_size: {
        type: DataTypes.INTEGER,
        allowNull: true,
        jsonSchema: {
          description: 'Size of the file in bytes.',
          examples: [76543],
        },
      },
      width: {
        // Stored rather than read off disk: a species picker asks for a couple
        // of hundred records at once and wants to lay out boxes before any
        // image has loaded.
        type: DataTypes.INTEGER,
        allowNull: true,
        jsonSchema: {
          description: "Width in pixels. Uploads are resized to 244, the width the annotation GUI's species buttons are built around.",
          examples: [244],
        },
      },
      height: {
        type: DataTypes.INTEGER,
        allowNull: true,
        jsonSchema: {
          description: "Height in pixels. Varies with the source image's aspect ratio.",
          examples: [176],
        },
      },
      is_default: {
        // At most one per species, enforced by a partial unique index.
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        jsonSchema: {
          description: 'Whether this is the picture to show when only one is wanted. At most one per species.',
          examples: [true],
        },
      },
      uploaded_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'user_id' },
        jsonSchema: {
          description: 'User who uploaded this picture. Null for the imported set.',
          examples: [8],
        },
      },
    },
    {
      sequelize,
      modelName: 'species_pictures',
      tableName: 'species_pictures',
      schema: 'public',
      timestamps: true,
      // The table uses snake_case timestamps, matching `species`.
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          name: 'species_pictures_species_id_idx',
          fields: ['species_id'],
        },
        {
          // Makes a re-run of the import an update rather than a duplicate.
          name: 'species_pictures_species_filename_unique',
          unique: true,
          fields: ['species_id', 'filename'],
        },
      ],
    }
  );

  return SpeciesPictures;
};
