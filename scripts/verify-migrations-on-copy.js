/**
 * Verify every pending migration on a restored copy of a database, before it touches the real one.
 *
 * #173. Production `mare_v1` is a scientific record and is far behind `develop`: its
 * pending migrations include the Mosaic review schema (#103) and, since #321, an in-place
 * rewrite of `ml_models`. The rule is that a migration must lose nothing, and the only way
 * to show that about production's data is to run them on a copy of it and compare. This is
 * that run, written down so it is the same run every time:
 *
 * 1. Record what the copy is: PostgreSQL version, the migration ledger, and which
 *    migrations are pending.
 * 2. Before: row counts of the scientific tables; dataset rows whose observation is gone
 *    (the review-schema migration aborts on any, which needs a data-meaning decision);
 *    a checksum of the observations' scientific fields; and a checksum of `ml_models`.
 * 3. Run every pending migration in one pass.
 * 4. After: the counts and the observation checksum must be unchanged, and every
 *    observation must have version 1. `ml_models` is rewritten on purpose (#321), so
 *    every row it changed must carry its originals in `notes`.
 * 5. With `--undo`: undo back to where the copy started, and both checksums must be the
 *    ones it started with -- the migrations are reversible on real data, not only in tests.
 *
 * **It refuses anything that is not a local database.** It runs on a copy restored for the
 * purpose (for example `marp db up --port 5440` and a restore into it), never on the
 * database the copy came from. A written report lands in `.marp/local/`.
 *
 * Usage:
 *   node scripts/verify-migrations-on-copy.js --port 5440 --db mare_v1
 *   node scripts/verify-migrations-on-copy.js --port 5440 --db mare_v1 --undo
 *
 * @fileoverview The pre-production migration check on a restored copy.
 * @author Isaac Travers
 * @module scripts/verify-migrations-on-copy
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');

/** The tables whose rows must all still be there afterwards. */
const COUNTED = ['observations', 'keyframes', 'dataset_observations', 'datasets', 'sessions', 'projects', 'ml_models', 'model_species', 'species'];

/** The migration that gives observations a version, which starts every one at 1 (#103). */
const VERSIONS = '20260909120000-add-observations-version-and-model.js';

/** The observation fields a scientist reads, which no migration may change. */
const SCIENTIFIC = ['comname', 'taxserial', 'taxReview', 'sizereview', 'tc', 'etc', 'mediaPosition', 'actualPosition', 'frame'];

const arg = (name, fallback = null) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
};

const host = arg('--host', '127.0.0.1');
const port = Number(arg('--port', process.env.DB_PORT));
const database = arg('--db', process.env.DB_NAME);
const undo = process.argv.includes('--undo');

const lines = [];
const say = (line = '') => { console.log(line); lines.push(line); };

/** A query's rows. */
async function rows(client, sql, values) {
    return (await client.query(sql, values)).rows;
}

/** Which of `names` the table has, quoted for SQL. */
async function present(client, table, names) {
    const found = new Set((await rows(client,
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table])).map((r) => r.column_name));
    return names.filter((name) => found.has(name)).map((name) => `"${name}"`);
}

/** One digest over a table's chosen columns, order-independent. */
async function checksum(client, table, columns, key) {
    if (!columns.length) return null;
    const [row] = await rows(client,
        `SELECT md5(string_agg(md5(ROW(${columns.join(', ')})::text), '' ORDER BY ${key})) AS digest, COUNT(*)::int AS n FROM ${table}`);
    return `${row.digest} over ${row.n}`;
}

/** What the copy holds now. */
async function snapshot(client) {
    const counts = {};
    for (const table of COUNTED) {
        const exists = (await rows(client, 'SELECT to_regclass($1) AS t', [table]))[0].t;
        counts[table] = exists ? (await rows(client, `SELECT COUNT(*)::int AS n FROM ${table}`))[0].n : null;
    }
    const obsColumns = await present(client, 'observations', SCIENTIFIC);
    const modelColumns = (await rows(client,
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'ml_models' AND column_name NOT IN ('updated_at') ORDER BY ordinal_position"))
        .map((r) => `"${r.column_name}"`);
    return {
        counts,
        observations: await checksum(client, 'observations', obsColumns, 'observation_id'),
        observationColumns: obsColumns,
        models: await checksum(client, 'ml_models', modelColumns, 'id'),
    };
}

/** Run sequelize-cli against the copy. */
function cli(args) {
    const env = { ...process.env, DB_HOST: host, DB_PORT: String(port), DB_NAME: database };
    return execFileSync(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), ...args],
        { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
        throw new Error(`refusing ${host}: this runs on a local restored copy, never on the database it came from`);
    }
    if (!port || !database) throw new Error('name the copy: --port <port> --db <database>');

    const client = new Client({ host, port, database, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await client.connect();

    say(`# Migration check on ${database} at ${host}:${port}, ${new Date().toISOString()}`);
    say(`PostgreSQL ${(await rows(client, 'SHOW server_version'))[0].server_version}`);

    const ledger = (await rows(client, 'SELECT name FROM "SequelizeMeta" ORDER BY name')).map((r) => r.name);
    const files = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((f) => f.endsWith('.js')).sort();
    const pending = files.filter((file) => !ledger.includes(file));
    const gone = ledger.filter((name) => !files.includes(name));
    say(`Ledger: ${ledger.length} rows; ${gone.length} name files that are not in this checkout; ${pending.length} pending.`);
    for (const file of pending) say(`  pending: ${file}`);

    const orphans = (await rows(client, `SELECT COUNT(*)::int AS n FROM dataset_observations d
        WHERE NOT EXISTS (SELECT 1 FROM observations o WHERE o.observation_id = d.observation_id)`))[0].n;
    say(`Dataset rows whose observation is gone: ${orphans}${orphans ? '  <-- stop: what these rows meant is a decision, not a migration' : ''}`);

    const before = await snapshot(client);
    say(`Before: ${JSON.stringify(before.counts)}`);
    say(`  observations (${before.observationColumns.join(', ')}): ${before.observations}`);
    say(`  ml_models: ${before.models}`);

    let failed = 0;
    const check = (ok, text) => { say(`${ok ? '  ok  ' : '  FAIL'} ${text}`); if (!ok) failed += 1; };

    if (orphans) {
        check(false, 'orphaned dataset rows: not migrating');
    } else if (!pending.length) {
        say('Nothing pending.');
    } else {
        say('Migrating, in one pass...');
        cli(['db:migrate']);
        const after = await snapshot(client);
        say(`After: ${JSON.stringify(after.counts)}`);
        for (const table of COUNTED) {
            check(after.counts[table] === before.counts[table], `${table}: ${before.counts[table]} -> ${after.counts[table]}`);
        }
        check(after.observations === before.observations, `observations' scientific fields unchanged (${after.observations})`);

        /* Only right after the migration that adds versions: on a copy that already had
           them, an observation edited since is rightly past 1. */
        if (pending.includes(VERSIONS)) {
            const versioned = (await rows(client, "SELECT COUNT(*)::int AS n FROM observations WHERE version IS DISTINCT FROM 1"))[0].n;
            check(versioned === 0, `every observation at version 1 (${versioned} not)`);
        }

        const rewritten = (await rows(client, "SELECT COUNT(*)::int AS n FROM ml_models WHERE notes LIKE '%Before #321:%'"))[0].n;
        say(`  ml_models rows rewritten by #321, originals in notes: ${rewritten}`);

        if (undo) {
            say(`Undoing back to where the copy started (to ${pending[0]})...`);
            cli(['db:migrate:undo:all', '--to', pending[0]]);
            const restored = await snapshot(client);
            check(restored.observations === before.observations, 'observations checksum back to the start');
            check(restored.models === before.models, 'ml_models checksum back to the start: #321 lost nothing');
            for (const table of COUNTED) check(restored.counts[table] === before.counts[table], `${table} back to ${before.counts[table]}`);
        }
    }

    say(failed ? `\n${failed} check(s) FAILED` : '\nEvery check passed.');
    await client.end();

    const out = path.join(__dirname, '..', '.marp', 'local', `migration-check-${database}-${port}-${Date.now()}.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log(`Report: ${out}`);
    process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 2;
});
