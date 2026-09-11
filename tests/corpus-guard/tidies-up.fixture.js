/**
 * A well-behaved suite: it creates a row and removes it again. The corpus
 * guard must let it pass.
 *
 * Without this one the other three prove only that the guard fails things, not
 * that it fails the right things.
 *
 * @fileoverview Fixture: a suite that puts the database back.
 * @author Isaac Travers
 * @module tests/corpus-guard/tidies-up.fixture
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../../model');

afterAll(async () => {
    await db.sequelize.query(`DELETE FROM guard_rows WHERE id = 102`);
});

test('inserts a row of its own and cleans it up afterwards', async () => {
    await db.sequelize.query(`INSERT INTO guard_rows (id, label) VALUES (102, 'mine to remove')`);

    const [{ present }] = await db.sequelize.query(
        'SELECT count(*)::int AS present FROM guard_rows WHERE id = 102',
        { type: QueryTypes.SELECT }
    );

    expect(present).toBe(1);
});
