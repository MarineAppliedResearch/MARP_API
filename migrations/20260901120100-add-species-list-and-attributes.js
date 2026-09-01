/**
 * Adds the columns the `species` table needs before the seven annotation lists
 * can be imported into it.
 *
 * `species_list` is the important one. A species is identified by its list plus
 * its taxserial, not by taxserial alone: values below 10000 are local codes
 * invented per list and reused across them, so `taxserial 55` is
 * "Copper/Gopher Rockfish complex" on the Fish list, "Large red Malacalcyonacea"
 * on GULF_Inverts and "Metal structure" on MarineDebris. 59 taxserials appear in
 * more than one list.
 *
 * `observation_type` cannot serve as that discriminator, which is why a new
 * column is needed rather than reusing it: five of the seven lists leave it
 * blank on every row, and one row's value is the sentence "This is a recognized
 * species, without a tax. Code".
 *
 * Left nullable here. The import backfills it, and only then can it become NOT
 * NULL with a unique constraint on `(species_list, taxserial)` -- the 218 rows
 * already in the table have no list, and two Inverts taxserials appear twice and
 * need merging first.
 *
 * Refs #52.
 *
 * @fileoverview Migration adding species_list, itis_tsn and four attribute columns.
 * @author Isaac Travers
 * @module migrations/add-species-list-and-attributes
 */

'use strict';

/** @type {Object} */
module.exports = {
  /**
   * Adds `species_list`, `itis_tsn`, `region`, `likelihood`, `max_size` and
   * `record_max`, all nullable.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, for data-type constructors.
   * @returns {Promise<void>} Resolves once every column has been added.
   * @throws {Error} Re-throws after rolling back if any column cannot be added.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'species',
        'species_list',
        {
          type: Sequelize.STRING(64),
          // Nullable until the import backfills every row; tightened in a
          // later migration alongside the unique constraint.
          allowNull: true,
          comment:
            "Which annotation list this entry belongs to (e.g. 'Fish', 'GULF_Inverts'). Together with taxserial this identifies an entry; taxserial alone does not, because codes below 10000 are local to a list and reused across lists.",
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'species',
        'itis_tsn',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment:
            'ITIS taxonomic serial number, when taxserial is genuinely one (>= 10000). Null for the local per-list codes, and for Habitat\'s synthetic 666xxx values. Lets the same taxon be recognised across lists, which taxserial cannot do on its own.',
        },
        { transaction }
      );

      // Four attributes the CSVs carry that this table had no column for.
      // Region appears on four of the seven lists; likelihood, max_size and
      // record_max are only populated on Fish, so they are null for most rows.
      await queryInterface.addColumn(
        'species',
        'region',
        {
          type: Sequelize.STRING(32),
          allowNull: true,
          comment: "Geographic range code for this entry, e.g. 'AK-SCA', 'NCA-Baja'. Present on the Fish, GULF_Fish, GULF_Inverts and Inverts lists only.",
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'species',
        'likelihood',
        {
          type: Sequelize.STRING(32),
          allowNull: true,
          comment: "How likely this species is to be encountered: 'Common', 'Uncommon' or 'No data'. Populated on the Fish list only.",
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'species',
        'max_size',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment: 'Maximum recorded size for this species, in centimetres. Populated on the Fish list only.',
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'species',
        'record_max',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment: 'Record maximum size for this species, in centimetres. Populated on the Fish list only.',
        },
        { transaction }
      );

      // The list is in every query that serves a species picker, and the pair
      // is what the unique constraint will eventually enforce.
      await queryInterface.addIndex('species', ['species_list'], {
        name: 'species_species_list_idx',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Removes the index and all six columns.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once every column has been removed.
   * @throws {Error} Re-throws after rolling back if any removal fails.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeIndex('species', 'species_species_list_idx', { transaction });

      for (const column of ['record_max', 'max_size', 'likelihood', 'region', 'itis_tsn', 'species_list']) {
        await queryInterface.removeColumn('species', column, { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
