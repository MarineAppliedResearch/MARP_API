/**
 * Widens the three `species` GUI ordering columns from `integer` to
 * `varchar(255)`, so the annotation GUI's existing layout encoding can be
 * stored verbatim.
 *
 * The GUI places a species by seven `GUI_*` columns, and five of them can hold
 * an underscore-delimited list rather than a single value, one slot per place
 * the species appears. `Fish.csv` uses this on 35 rows -- for example Starry RF
 * carries `GUI_MainTab = 'Rockfish_Rockfish'`, `GUI_SubTab = 'Home_Red Rockfish'`
 * and `GUI_ItemOrder = '17_4'`, meaning it appears twice: Rockfish -> Home at
 * position 17, and Rockfish -> Red Rockfish at position 4. Some rows have three
 * slots (`GUI_MainTabOrder = '2_2_2'`).
 *
 * `gui_maintab`, `gui_subtab` and `gui_home_order` are already `varchar`, so
 * they need nothing. The three order columns are `integer` and cannot hold
 * `17_4` at all, which blocks importing exactly the rows that put rockfish on
 * both the home tab and their taxonomic sub-tab.
 *
 * The GUI keeps parsing these values itself (see
 * `Functions.breakIntoMultipleFields`); nothing here changes how placement
 * works. Replacing the encoding with a placements table is a separate piece of
 * work.
 *
 * Refs #52.
 *
 * @fileoverview Migration widening species.gui_*_order columns to varchar.
 * @author Isaac Travers
 * @module migrations/widen-species-gui-order-columns
 */

'use strict';

/**
 * The columns to widen, all currently `integer` and all able to hold a
 * multi-slot value like `2_2` or `17_4`.
 *
 * @constant
 * @type {Array<string>}
 */
const ORDER_COLUMNS = ['gui_main_tab_order', 'gui_sub_tab_order', 'gui_item_order'];

/** @type {Object} */
module.exports = {
  /**
   * Changes each column in {@link ORDER_COLUMNS} to `varchar(255)`.
   *
   * Postgres casts `integer` to `varchar` implicitly, so no `USING` clause is
   * needed and existing values become their decimal text ("12" from 12).
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @param {Object} Sequelize - Sequelize library, for data-type constructors.
   * @returns {Promise<void>} Resolves once every column has been widened.
   * @throws {Error} Re-throws after rolling back if any column change fails.
   */
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      for (const column of ORDER_COLUMNS) {
        await queryInterface.changeColumn(
          'species',
          column,
          { type: Sequelize.STRING(255), allowNull: true },
          { transaction }
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Narrows each column back to `integer`.
   *
   * This only succeeds while every stored value is still numeric text. Once a
   * multi-slot value such as `17_4` has been imported the cast fails and the
   * migration cannot be reversed -- which is the intended behaviour, since
   * narrowing would otherwise silently destroy placement data. An explicit
   * `USING` cast is required because Postgres will not convert `varchar` to
   * `integer` implicitly.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
   * @returns {Promise<void>} Resolves once every column has been narrowed.
   * @throws {Error} Re-throws after rolling back if any value is not valid integer text.
   */
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      for (const column of ORDER_COLUMNS) {
        await queryInterface.sequelize.query(
          `ALTER TABLE species
             ALTER COLUMN "${column}" TYPE integer
             USING NULLIF(btrim("${column}"), '')::integer`,
          { transaction }
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
