/**
 * ===================================================================
 * File: species.model.js
 * Author: Isaac Assegai Travers
 * Date: 2025-10-7
 * -------------------------------------------------------------------
 * Part of the MARP Machine Learning Database Schema.
 *
 * Purpose:
 * Defines the `species` table, which catalogs all taxa recognized
 * within MARP’s ecosystem. Each record represents a single taxon
 * (species, genus, family, etc.) and includes information needed by:
 *   - the machine learning pipeline (class labels, taxserial, etc.)
 *   - the MARP GUI (display order, tabs, and grouping)
 *   - reporting systems (expected habitats, depth range, etc.)
 *
 * This table is used by observations, datasets, and ML model
 * training processes for classification and display purposes.
 * ===================================================================
 */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Model: species
   * ----------------------------------------------------------------
   * Represents a taxonomic entry or display class used throughout
   * MARP. This table links biological taxonomy with GUI display
   * configuration, ensuring consistency between data analysis,
   * training labels, and user-facing tools.
   */
  class species extends Model {
    static associate(models) {
      // Many-to-many relationship: species ↔ models
      this.belongsToMany(models.ml_models, {
        through: models.model_species,
        as: 'ml_models',
        foreignKey: 'species_id',
        otherKey: 'model_id',
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
      },

      taxserial: {
        // Internal taxonomic identifier assigned by MARP
        type: DataTypes.INTEGER,
        allowNull: false,
        comment:
          'Internal MARP taxonomy serial number used as a unique ID across systems.',
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
      },

      gui_maintab: {
        // Which main tab this species belongs to in the GUI
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Main tab category where this item appears in the GUI (e.g., "Fish", "Invertebrates").',
      },

      gui_subtab: {
        // Which sub-tab within the main tab this belongs to
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Sub-tab within the main tab where this item is displayed (e.g., "Sea Stars", "Crabs").',
      },

      gui_main_tab_order: {
        // Display order number of the main tab
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Order number for the main tab this item belongs to (controls tab sequencing).',
      },

      gui_sub_tab_order: {
        // Display order within the subtab group
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Order number for the sub-tab this item belongs to (controls layout within a tab).',
      },

      gui_item_order: {
        // Display order within the main/subtab group
        type: DataTypes.INTEGER,
        allowNull: true,
        comment:
          'Position of this species within its GUI sub-tab group.',
      },

      gui_display_name: {
        // The label name to display in GUI (may differ from comname)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Display name for this item as shown in MARP GUI interfaces.',
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
      },

      species: {
        // Scientific name of the species
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Scientific or Latin name of the species (e.g., "Sebastes ruberrimus").',
      },

      observation_type: {
        // Category of observation (Fish, Invertebrate, Other)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Category describing what type of organism this is (e.g., "Fish", "Invertebrate").',
      },

      taxonomic_level: {
        // Level of taxonomy (species, genus, phylum, etc.)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Taxonomic rank (e.g., "Species", "Genus", "Phylum", "Class").',
      },

      report_group: {
        // Reporting group (used for rollups or reports)
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Report grouping (e.g., "Sea Stars", "Corals - Gorgonians", "Anemones").',
      },

      depth_min: {
        // Minimum observed or expected depth (in meters)
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Minimum depth (in meters) where this species is typically observed.',
      },

      depth_max: {
        // Maximum observed or expected depth (in meters)
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          'Maximum depth (in meters) where this species is typically observed.',
      },

      habitat_preference: {
        // Preferred habitat types
        type: DataTypes.STRING,
        allowNull: true,
        comment:
          'Habitat preference or substrate association (e.g., "Rocky", "Mud/Sand", "Mixed Hard/Soft").',
      },

      notes: {
        // Additional notes or remarks
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Freeform notes about this species, its classification, or GUI behavior.',
      },

      created_at: {
        // Record creation timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this species record was created.',
      },

      updated_at: {
        // Record update timestamp
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment:
          'Timestamp when this species record was last updated.',
      },
    },
    {
      sequelize,
      modelName: 'species',          // used inside Sequelize
      tableName: 'species',          // actual PostgreSQL table
      schema: 'public',
      timestamps: false,             // handled manually
      comment:
        'Taxonomic and GUI configuration table for species used in MARP observations, reports, and ML models.',
      indexes: [
        {
          name: 'species_pkey',
          unique: true,
          fields: ['id'],
        },
        {
          name: 'species_taxserial_idx',
          unique: true,
          fields: ['taxserial'],
        },
        {
          name: 'species_comname_idx',
          fields: ['comname'],
        },
        {
          name: 'species_report_group_idx',
          fields: ['report_group'],
        },
        {
          name: 'species_gui_maintab_idx',
          fields: ['gui_maintab'],
        },
        {
          name: 'species_gui_subtab_idx',
          fields: ['gui_subtab'],
        },
      ],
    }
  );

  return species;
};