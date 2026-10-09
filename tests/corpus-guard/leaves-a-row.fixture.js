/**
 * A suite that creates a row and does not remove it. The corpus guard must
 * fail it.
 *
 * The non-destructive half of #142: the run that lost an observation also left
 * 358 review rows behind, which the mosaic then showed as real decisions.
 *
 * @fileoverview Fixture: a suite that leaves its rows behind.
 * @author Isaac Travers
 * @module tests/corpus-guard/leaves-a-row.fixture
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../../model');

test('inserts a row and never cleans it up', async () => {
    await db.sequelize.query(`INSERT INTO guard_rows (id, label) VALUES (101, 'left behind')`);

    const [{ present }] = await db.sequelize.query(
        'SELECT count(*)::int AS present FROM guard_rows WHERE id = 101',
        { type: QueryTypes.SELECT }
    );

    expect(present).toBe(1);
});
