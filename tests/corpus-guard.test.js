/**
 * The corpus guard's own tests (#142, R6).
 *
 * A guard nobody has watched fail is not a guard, so this file makes it fail,
 * three ways: a suite that deletes a row it did not create, a suite that
 * modifies one, and a suite that inserts one and leaves it behind. A fourth
 * fixture creates a row and removes it, and must pass -- otherwise the other
 * three prove only that the guard fails things, not that it fails the right
 * things.
 *
 * **It never runs against the development corpus.** It creates its own
 * database on the same local server, puts one three-row table in it, runs the
 * fixture suites there as a child Jest process, and drops the database again.
 * The corpus is irreplaceable and R8 of the spec keeps this phase off it
 * entirely.
 *
 * Also covers the refusal in `tests/setup/local-database-guard.js`: the suite
 * will not run against a database that is not local.
 *
 * @fileoverview Proves the corpus guard catches a delete, a mutation and a leftover row.
 * @author Isaac Travers
 * @module tests/corpus-guard.test
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const { Client } = require('pg');

const { assertLocalDatabase, OVERRIDE } = require('./setup/local-database-guard');

/**
 * Repository root, used to reach the Jest binary and the fixture config.
 *
 * @constant
 * @type {string}
 */
const ROOT = path.join(__dirname, '..');

/**
 * Name of the scratch database this file builds and drops. The pid keeps two
 * runs on one machine from colliding.
 *
 * @constant
 * @type {string}
 */
const SCRATCH_DB = `marp_guard_scratch_${process.pid}`;

/**
 * Connection settings for the local server, taken from the same five DB_*
 * variables the API reads. Only the database name differs.
 *
 * @returns {Object} pg client options for the maintenance database.
 */
function serverConnection() {
    return {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        database: 'postgres',
    };
}

/**
 * Runs one statement against the maintenance database.
 *
 * CREATE DATABASE and DROP DATABASE cannot run inside a transaction, and the
 * application's Sequelize connection is already bound to the corpus, so this
 * opens its own short-lived client.
 *
 * @param {string} sql Statement to run.
 * @returns {Promise<void>} Resolves when the statement has run.
 */
async function onServer(sql) {
    const client = new Client(serverConnection());

    await client.connect();

    try {
        await client.query(sql);
    } finally {
        await client.end();
    }
}

/**
 * Runs statements against the scratch database.
 *
 * @param {string[]} statements Statements to run in order.
 * @returns {Promise<void>} Resolves when all of them have run.
 */
async function onScratch(statements) {
    const client = new Client({ ...serverConnection(), database: SCRATCH_DB });

    await client.connect();

    try {
        for (const sql of statements) {
            await client.query(sql);
        }
    } finally {
        await client.end();
    }
}

/**
 * Output of the fixture run, captured once in beforeAll so the child Jest is
 * spawned a single time rather than once per assertion.
 *
 * @type {{status: number, output: string}}
 */
let run;

beforeAll(async () => {
    await onServer(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
    await onServer(`CREATE DATABASE "${SCRATCH_DB}"`);

    // Three rows that exist before any fixture runs, so deleting or modifying
    // one is exactly the offence the guard is for.
    await onScratch([
        'CREATE TABLE guard_rows (id integer PRIMARY KEY, label text)',
        `INSERT INTO guard_rows (id, label) VALUES
           (1, 'the one that gets deleted'),
           (2, 'the one that gets rewritten'),
           (3, 'the one nothing touches')`,
    ]);

    const result = spawnSync(
        process.execPath,
        [
            path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js'),
            '--config',
            path.join(ROOT, 'tests', 'corpus-guard', 'jest.fixture.config.js'),
            '--runInBand',
            '--forceExit',
        ],
        {
            cwd: ROOT,
            encoding: 'utf8',
            // DB_NAME set here wins: dotenv does not overwrite a variable that
            // is already in the environment, so the child talks to the scratch
            // database while everything else stays as configured.
            env: { ...process.env, DB_NAME: SCRATCH_DB },
        }
    );

    run = {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
    };
}, 180000);

afterAll(async () => {
    await onServer(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
}, 60000);

describe('the corpus guard catches a suite that changed the database', () => {
    test('the fixture run fails, and only the well-behaved suite passes', () => {
        expect(run.status).not.toBe(0);
        expect(run.output).toMatch(/Tests:\s+4 passed/);
        expect(run.output).toMatch(/Test Suites:\s+3 failed, 1 passed, 4 total/);
    });

    test('names the file that deleted a row it did not create', () => {
        expect(run.output).toContain('deletes-a-row.fixture.js changed the database');
        expect(run.output).toContain('guard_rows: 1 row(s) deleted that the suite did not create');
    });

    test('names the file that modified a row, where no row count moved', () => {
        expect(run.output).toContain('mutates-a-row.fixture.js changed the database');
        expect(run.output).toContain('guard_rows: row(s) modified, count unchanged at');
    });

    test('names the file that left a row behind', () => {
        expect(run.output).toContain('leaves-a-row.fixture.js changed the database');
        expect(run.output).toContain('guard_rows: 1 row(s) added and left behind');
    });

    test('does not fail the suite that removed the row it created', () => {
        expect(run.output).not.toContain('tidies-up.fixture.js changed the database');
    });
});

describe('the guard is inert when nothing changed', () => {
    const { differences } = require('./setup/corpus-guard');

    test('reports nothing for two identical snapshots', () => {
        const snapshot = new Map([
            ['observations', { count: '2093', digest: '1234' }],
            ['keyframes', { count: '29682', digest: '5678' }],
        ]);

        expect(differences(snapshot, new Map(snapshot))).toEqual([]);
    });

    test('reports nothing for an empty database, which is what CI has', () => {
        const empty = new Map([
            ['observations', { count: '0', digest: '0' }],
            ['keyframes', { count: '0', digest: '0' }],
        ]);

        expect(differences(empty, new Map(empty))).toEqual([]);
    });
});

describe('the suite refuses a database that is not local', () => {
    test('allows 127.0.0.1 and localhost', () => {
        expect(() => assertLocalDatabase({ DB_HOST: '127.0.0.1' })).not.toThrow();
        expect(() => assertLocalDatabase({ DB_HOST: 'localhost' })).not.toThrow();
        expect(() => assertLocalDatabase({ DB_HOST: ' LocalHost ' })).not.toThrow();
    });

    test('refuses anything else, naming the host and the override', () => {
        let message = '';

        try {
            assertLocalDatabase({ DB_HOST: 'db.example.org' });
        } catch (error) {
            message = error.message;
        }

        expect(message).toContain('Refusing to run the test suite');
        expect(message).toContain('db.example.org');
        expect(message).toContain(OVERRIDE);
    });

    test('refuses an unset host rather than assuming it is local', () => {
        expect(() => assertLocalDatabase({})).toThrow(/DB_HOST is not set/);
    });

    test('lets somebody who means it past, with the override set', () => {
        expect(() => assertLocalDatabase({ DB_HOST: 'db.example.org', [OVERRIDE]: '1' }))
            .not.toThrow();
    });
});
