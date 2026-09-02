/**
 * File: scripts/init-database.js
 * Purpose: Restore the baseline schema into an empty database, so that
 *          `db:migrate` has the starting point its migrations assume.
 * Context: The migrations here cannot build a database from nothing --
 *          `observations`, `projects`, `sessions` and `metaInfos` have no
 *          createTable migration and every migration touching them assumes
 *          they exist. Without this step a fresh database cannot be brought
 *          up at all, so standing up MARP meant being handed a copy of
 *          somebody else's database. This is that missing first step.
 *
 * Usage:
 *   node scripts/init-database.js            restore the baseline
 *   node scripts/init-database.js --check    report what is there, change nothing
 *
 * Reads the same DB_* settings as everything else, through config/config.js,
 * so it connects wherever the API would. Then:
 *
 *   npx sequelize-cli db:migrate
 *
 * applies the migrations the baseline predates.
 *
 * Deliberately not a Sequelize migration. A migration numbered before the
 * others would be run by the CLI against production too, and recorded in
 * production's ledger, for no benefit -- production already has this schema.
 * A script that only a fresh database ever runs keeps the migration history
 * meaning exactly one thing: the upgrade path.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const config = require('../config/config')[process.env.NODE_ENV || 'development'];

/**
 * Baseline files, in the order they must be applied.
 *
 * The ledger is not optional. Restoring the schema without it leaves
 * `SequelizeMeta` empty, so `db:migrate` re-runs migrations whose work is
 * already present and fails on the first one.
 *
 * @constant
 * @type {Array<{file: string, description: string}>}
 */
const BASELINE_FILES = [
    { file: 'schema.sql', description: 'tables, views, indexes and constraints' },
    { file: 'applied-migrations.sql', description: 'migrations the baseline already contains' },
];

const BASELINE_DIR = path.join(__dirname, '..', 'db', 'baseline');

/** Exit code used for every refusal, so a caller can tell "no" from "broke". */
const EXIT_REFUSED = 1;

/**
 * Describes what is currently in the target database.
 *
 * @async
 * @param {Client} client - A connected client.
 * @returns {Promise<{tables: number, views: number, migrations: ?number}>} Counts; migrations is null when there is no ledger yet.
 */
async function inspect(client) {
    const objects = await client.query(`
        select
            count(*) filter (where table_type = 'BASE TABLE')::int as tables,
            count(*) filter (where table_type = 'VIEW')::int       as views
        from information_schema.tables
        where table_schema = 'public'
    `);

    const ledger = await client.query(`
        select to_regclass('public."SequelizeMeta"') is not null as present
    `);

    let migrations = null;
    if (ledger.rows[0].present) {
        const counted = await client.query('select count(*)::int as n from public."SequelizeMeta"');
        migrations = counted.rows[0].n;
    }

    return { tables: objects.rows[0].tables, views: objects.rows[0].views, migrations };
}

/**
 * Applies one baseline file.
 *
 * The whole file goes to the server as a single multi-statement query, which
 * PostgreSQL runs in one implicit transaction -- so a failure part-way through
 * leaves nothing behind rather than half a schema. This is also why the
 * committed baseline carries no psql meta-commands: it has to be executable by
 * a plain driver, with no psql installed.
 *
 * @async
 * @param {Client} client - A connected client.
 * @param {string} file - Filename within db/baseline.
 * @returns {Promise<void>} Resolves once applied.
 */
async function apply(client, file) {
    const full = path.join(BASELINE_DIR, file);
    if (!fs.existsSync(full)) {
        throw new Error(`Baseline file missing: ${path.relative(process.cwd(), full)}`);
    }
    await client.query(fs.readFileSync(full, 'utf8'));
}

/**
 * @async
 * @returns {Promise<void>} Resolves when the baseline is in place, or exits.
 */
async function main() {
    const checkOnly = process.argv.includes('--check');

    for (const key of ['database', 'username', 'host']) {
        if (!config[key]) {
            console.error(`No ${key} configured. Copy .env.example to .env and fill in the DB_* values.`);
            process.exit(EXIT_REFUSED);
        }
    }

    const client = new Client({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
    });

    try {
        await client.connect();
    } catch (error) {
        console.error(`Cannot connect to ${config.database} at ${config.host}:${config.port} -- ${error.message}`);
        console.error('');
        console.error('The database itself must already exist; this script fills it, it does not create it.');
        console.error(`If the server is running but the database is not there:  createdb ${config.database}`);
        process.exit(EXIT_REFUSED);
    }

    try {
        const state = await inspect(client);
        console.log(`${config.database} at ${config.host}:${config.port}`);
        console.log(`  ${state.tables} tables, ${state.views} views, ${state.migrations === null ? 'no' : state.migrations} migrations recorded`);

        if (checkOnly) return;

        // Anything already here is either a finished database or somebody's
        // work in progress. Restoring over it would be destructive in a way
        // that is not this script's call to make.
        if (state.tables > 0 || state.views > 0) {
            console.log('');
            console.log('Not empty, so the baseline was not applied.');
            console.log('The baseline is for building a database from nothing. To bring an existing');
            console.log('one up to date instead, run:  npx sequelize-cli db:migrate');
            process.exit(EXIT_REFUSED);
        }

        console.log('');
        for (const { file, description } of BASELINE_FILES) {
            console.log(`Applying db/baseline/${file} -- ${description}`);
            await apply(client, file);
        }

        const after = await inspect(client);
        console.log('');
        console.log(`Baseline in place: ${after.tables} tables, ${after.views} views, ${after.migrations} migrations recorded.`);
        console.log('');
        console.log('Now apply the migrations the baseline predates:');
        console.log('    npx sequelize-cli db:migrate');
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error(`Baseline restore failed: ${error.message}`);
    process.exit(EXIT_REFUSED);
});
