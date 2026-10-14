/**
 * The Habitat list carries Pull, Stop and Off Transect, which the annotation
 * GUI's stop/pull import (VIDEO_PROCESSING_GUI#254) records the field log as.
 *
 * The migrations have already run against this database, so these read the
 * result through the API the GUI uses, then run `up` again to show a database
 * that already has the items -- production -- is left exactly as it was.
 *
 * @fileoverview Tests for the habitat stop/pull/off-transect migration.
 * @author Isaac Travers
 * @module tests/habitat-stop-pull-items
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const migration = require('../migrations/20261007120000-add-habitat-stop-pull-off-transect');

describe('Habitat stop, pull and off transect items', () => {

  /** @constant @type {Array<Object>} */
  const expected = [
    { taxserial: 666009, comname: 'Pull' },
    { taxserial: 666010, comname: 'Stop' },
    { taxserial: 666011, comname: 'Off Transect' },
  ];

  /**
   * The three rows as they stand, in taxserial order.
   *
   * @returns {Promise<Array<Object>>} id, taxserial, comname and both orders.
   */
  async function currentRows() {
    return db.sequelize.query(
      `SELECT id, taxserial, comname, gui_item_order, gui_home_order, updated_at
         FROM species
        WHERE species_list = 'Habitat' AND taxserial IN (666009, 666010, 666011)
        ORDER BY taxserial`,
      { type: QueryTypes.SELECT }
    );
  }

  test('R13: the Habitat list the GUI loads has all three, as HAB buttons', async () => {
    const res = await global.api.get('/api/v2/species/list/Habitat');

    expect(res.status).toBe(200);

    for (const item of expected) {
      const row = res.body.find((r) => Number(r.taxserial) === item.taxserial);

      expect(row).toBeDefined();
      expect(row.comname).toBe(item.comname);
      expect(row.gui_display_name).toBe(item.comname);
      expect(row.gui_maintab).toBe('HAB');
      expect(row.gui_subtab).toBe('TYPE1');
    }
  });

  test('R13: running it again on a database that has them changes nothing', async () => {
    const before = await currentRows();

    await migration.up(db.sequelize.getQueryInterface());

    const after = await currentRows();

    expect(after).toEqual(before);
    expect(after.map((r) => r.comname)).toEqual(expected.map((e) => e.comname));
  });
});
