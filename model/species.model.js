/**
 * Sequelize model definition for the species taxonomy and GUI display table.
 *
 * Defines the `species` table, which catalogs all taxa recognized within
 * MARP's ecosystem. Each record represents a single taxon (species, genus,
 * family, etc.) and includes information needed by:
 *   - the machine learning pipeline (class labels, taxserial, etc.)
 *   - the MARP GUI (display order, tabs, and grouping)
 *   - reporting systems (expected habitats, depth range, etc.)
 *
 * This table is used by observations, datasets, and ML model training
 * processes for classification and display purposes.
 *
 * @fileoverview Sequelize model and OpenAPI response schema for species.
 * @author Isaac Assegai Travers
 * @module model/species
 */

const { Model } = require('sequelize');

/**
 * Create and initialize the species Sequelize model.
 *
 * Sequelize calls this factory with the shared database connection and
 * configured data-type collection. The returned model is registered in the
 * central model registry and later connected to the ml_models,
 * metrics_summary, and metrics_curves models through {@link species.associate}.
 *
 * @param {Object} sequelize - Shared Sequelize connection.
 * @param {Object} DataTypes - Sequelize data-type definitions.
 * @returns {Model} Initialized species model.
 */
module.exports = (sequelize, DataTypes) => {
  /**
   * Sequelize model representing one species taxonomy/display record.
   *
   * Links biological taxonomy with GUI display configuration, ensuring
   * consistency between data analysis, training labels, and user-facing
   * tools.
   *
   * @class species
   * @extends Model
   */
  class species extends Model {

    /**
     * Register relationships between species and related models.
     *
     * Associations are configured after all Sequelize models have been
     * loaded into the shared model registry.
     *
     * @param {Object} models - Initialized Sequelize model registry.
     * @returns {void}
     */
    static associate(models) {
      // Many-to-many relationship: species ↔ models
      this.belongsToMany(models.ml_models, {
        through: models.model_species,
        as: 'ml_models',
        foreignKey: 'species_id',
        otherKey: 'model_id',
      });

      // One species can appear in many aggregated metrics summaries.
      this.hasMany(models.metrics_summary, {
        as: 'metrics_summaries',
        foreignKey: 'species_id',
      });

      // One species can appear in many fine-grained metrics curve points.
      this.hasMany(models.metrics_curves, {
        as: 'metrics_curves',
        foreignKey: 'species_id',
      });
    }
  }

  species.init(
    {
      id: {
        // Primary key for this species record
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        comment: 'Unique numeric identifier for this species record.',
        jsonSchema: {
            readOnly: true,
            description: 'Unique numeric identifier for this species record.',
            examples: [42],
        },
      },

      taxserial: {
        // Internal taxonomic identifier assigned by MARP
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Internal MARP taxonomy serial number used as a unique ID across systems.',
        jsonSchema: {
            description: 'Internal MARP taxonomy serial number used as a unique ID across systems.',
            examples: [1054],
        },
      },

      // -----------------------------------------------------------
      // GUI DISPLAY CONFIGURATION
      // -----------------------------------------------------------

      gui_home_order: {
        // Determines overall order of appearance on the home screen
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Ordering key used by MARP GUI to position this item on the home screen.',
        jsonSchema: {
            description: 'Ordering key used by the MARP GUI to position this item on the home screen.',
            examples: ['010'],
        },
      },

      gui_maintab: {
        // Which main tab this species belongs to in the GUI
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Main tab category where this item appears in the GUI (e.g., "Fish", "Invertebrates").',
        jsonSchema: {
            description: 'Main tab category where this item appears in the GUI.',
            examples: ['Fish'],
        },
      },

      gui_subtab: {
        // Which sub-tab within the main tab this belongs to
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Sub-tab within the main tab where this item is displayed (e.g., "Sea Stars", "Crabs").',
        jsonSchema: {
            description: 'Sub-tab within the main tab where this item is displayed.',
            examples: ['Sea Stars'],
        },
      },

      gui_main_tab_order: {
        // Display order number of the main tab
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Order number for the main tab this item belongs to (controls tab sequencing).',
        jsonSchema: {
            description: 'Order number for the main tab this item belongs to.',
            examples: [2],
        },
      },

      gui_sub_tab_order: {
        // Display order within the subtab group
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Order number for the sub-tab this item belongs to (controls layout within a tab).',
        jsonSchema: {
            description: 'Order number for the sub-tab this item belongs to.',
            examples: [5],
        },
      },

      gui_item_order: {
        // Display order within the main/subtab group
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Position of this species within its GUI sub-tab group.',
        jsonSchema: {
            description: 'Position of this species within its GUI sub-tab group.',
            examples: [12],
        },
      },

      gui_display_name: {
        // The label name to display in GUI (may differ from comname)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Display name for this item as shown in MARP GUI interfaces.',
        jsonSchema: {
            description: 'Display name for this item shown in MARP GUI interfaces, may differ from comname.',
            examples: ['Bat Star'],
        },
      },

      // -----------------------------------------------------------
      // TAXONOMY / BIOLOGY
      // -----------------------------------------------------------

      comname: {
        // Common (English) name of this species
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Common name used for this species (e.g., "Rockfish", "Sea Star").',
        jsonSchema: {
            description: 'Common name used for this species.',
            examples: ['Bat star'],
        },
      },

      species: {
        // Scientific name of the species
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Scientific or Latin name of the species (e.g., "Sebastes ruberrimus").',
        jsonSchema: {
            description: 'Scientific or Latin name of the species.',
            examples: ['Patiria miniata'],
        },
      },

      observation_type: {
        // Category of observation (Fish, Invertebrate, Other)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Category describing what type of organism this is (e.g., "Fish", "Invertebrate").',
        jsonSchema: {
            description: 'Category describing what type of organism this is.',
            examples: ['Invertebrate'],
        },
      },

      taxonomic_level: {
        // Level of taxonomy (species, genus, phylum, etc.)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Taxonomic rank (e.g., "Species", "Genus", "Phylum", "Class").',
        jsonSchema: {
            description: 'Taxonomic rank.',
            examples: ['Species'],
        },
      },

      report_group: {
        // Reporting group (used for rollups or reports)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Report grouping (e.g., "Sea Stars", "Corals - Gorgonians", "Anemones").',
        jsonSchema: {
            description: 'Report grouping used for rollups or reports.',
            examples: ['Sea Stars'],
        },
      },

      depth_min: {
        // Minimum observed or expected depth (in meters)
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Minimum depth (in meters) where this species is typically observed.',
        jsonSchema: {
            description: 'Minimum depth in meters where this species is typically observed (range semantics are dataset-dependent).',
            examples: [5.5],
        },
      },

      depth_max: {
        // Maximum observed or expected depth (in meters)
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Maximum depth (in meters) where this species is typically observed.',
        jsonSchema: {
            description: 'Maximum depth in meters where this species is typically observed (range semantics are dataset-dependent).',
            examples: [45],
        },
      },

      habitat_preference: {
        // Preferred habitat types
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Habitat preference or substrate association (e.g., "Rocky", "Mud/Sand", "Mixed Hard/Soft").',
        jsonSchema: {
            description: 'Habitat preference or substrate association.',
            examples: ['Rocky'],
        },
      },

      notes: {
        // Additional notes or remarks
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes about this species, its classification, or GUI behavior.',
        jsonSchema: {
            schema: { type: 'string' },
            description: 'Freeform notes about this species, its classification, or GUI behavior.',
            examples: ['Legacy synonym handled in reporting mapper.'],
        },
      },

      created_at: {
        // Record creation timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this species record was created.',
        jsonSchema: {
            readOnly: true,
            description: 'Timestamp when this species record was created.',
            examples: ['2026-07-22T15:33:10.000Z'],
        },
      },

      updated_at: {
        // Record update timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this species record was last updated.',
        jsonSchema: {
            readOnly: true,
            description: 'Timestamp when this species record was last updated.',
            examples: ['2026-07-23T09:12:01.000Z'],
        },
      },
    },
    {
      sequelize,                     // shared Sequelize connection instance
      modelName: 'species',          // used inside Sequelize
      tableName: 'species',          // actual PostgreSQL table
      schema: 'public',              // database schema containing the table
      timestamps: false,             // handled manually
      comment:
        'Taxonomic and GUI configuration table for species used in MARP observations, reports, and ML models.',
      indexes: [
        {
          name: 'species_pkey',            // primary key index
          unique: true,
          fields: ['id'],
        },
        {
          name: 'species_taxserial_idx',    // enforces one record per taxonomic serial number
          unique: true,
          fields: ['taxserial'],
        },
        {
          name: 'species_comname_idx',      // speeds up lookups by common name
          fields: ['comname'],
        },
        {
          name: 'species_report_group_idx', // speeds up report rollups by group
          fields: ['report_group'],
        },
        {
          name: 'species_gui_maintab_idx',  // speeds up GUI main-tab grouping queries
          fields: ['gui_maintab'],
        },
        {
          name: 'species_gui_subtab_idx',   // speeds up GUI sub-tab grouping queries
          fields: ['gui_subtab'],
        },
      ],
    }
  );

  return species;
};