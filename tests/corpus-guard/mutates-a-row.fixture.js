/**
 * A suite that modifies a row it did not create, leaving every row count
 * identical. The corpus guard must fail it.
 *
 * This is the case a row count cannot see, and the reason the guard carries a
 * digest as well as a count (#142, A1).
 *
 * @fileoverview Fixture: a mutating suite the guard has to catch.
 * @author Isaac Travers
 * @module tests/corpus-guard/mutates-a-row.fixture
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../../model');

test('changes a pre-existing row without changing any row count', async () => {
    await db.sequelize.query(`UPDATE guard_rows SET label = 'quietly rewritten' WHERE id = 2`);

    const [{ label }] = await db.sequelize.query(
        'SELECT label FROM guard_rows WHERE id = 2',
        { type: QueryTypes.SELECT }
    );

    expect(label).toBe('quietly rewritten');
});
