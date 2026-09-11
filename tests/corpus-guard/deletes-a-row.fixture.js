/**
 * A suite that deletes a row it did not create. The corpus guard must fail it.
 *
 * Its assertion passes, which is the point: this is what #142 looked like from
 * the outside -- 44 suites green and one real observation gone.
 *
 * @fileoverview Fixture: a destructive suite the guard has to catch.
 * @author Isaac Travers
 * @module tests/corpus-guard/deletes-a-row.fixture
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../../model');

test('deletes a pre-existing row and reports success', async () => {
    await db.sequelize.query('DELETE FROM guard_rows WHERE id = 1');

    const [{ remaining }] = await db.sequelize.query(
        'SELECT count(*)::int AS remaining FROM guard_rows WHERE id = 1',
        { type: QueryTypes.SELECT }
    );

    expect(remaining).toBe(0);
});
