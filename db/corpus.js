/**
 * What "the corpus" is, and where the tools that move it live.
 *
 * `scripts/dump-corpus.js` and `scripts/load-corpus.js` are two halves of one
 * operation and must agree about three things exactly: which tables a corpus is
 * made of, what a manifest says, and where `pg_dump` is. Anything they both need
 * is here rather than in one of them, because a load that counts a different set
 * of tables than the dump did reports a mismatch that is not one.
 *
 * Refs #125.
 *
 * @fileoverview The corpus definition shared by the dump and load scripts.
 * @module db/corpus
 * @author Isaac Travers
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The tables a corpus is made of.
 *
 * **Not every table**, deliberately -- a dump carries all of them, but this list
 * is what the emptiness test and the round-trip comparison look at, and those
 * want the tables that are *survey work* rather than the ones the baseline
 * builds. `species` (854 rows) and `permissions` come straight from
 * `db/baseline/schema.sql`, and the bootstrap migration puts the first
 * administrator in `users`. So "any row anywhere" would declare every freshly
 * built database non-empty, refuse every load, and teach people to pass
 * `--force` by reflex -- which is the one habit this tool exists to avoid.
 *
 * Order is dependency order, so a printed report reads top-down.
 *
 * @constant
 * @type {Array<string>}
 */
const CORPUS_TABLES = [
    'projects',
    'sessions',
    'ml_models',
    'observations',
    'keyframes',
    'observation_thumbnails',
    'observation_reviews',
    'gpu_jobs',
];

/**
 * The file the dump is written to inside a dump directory.
 *
 * Named for the database it came from rather than timestamped: the timestamp is
 * the directory, so two dumps never collide and the file inside is always found
 * by the same name.
 *
 * @constant
 * @type {string}
 */
const DUMP_FILENAME = 'corpus.dump';

/**
 * The thumbnails directory inside a dump directory.
 *
 * Mirrors the name it has under `storage/` so that a person looking at a dump
 * directory can see which half is which without reading anything.
 *
 * @constant
 * @type {string}
 */
const THUMBNAILS_DIRNAME = 'observation-thumbnails';

/**
 * The manifest, written beside the dump.
 *
 * It is what makes R6 possible: without a record of what was in the database
 * when the dump was taken, a load can only report what it produced, which proves
 * nothing. **It carries no host, port or password** -- a dump is not tied to the
 * machine that made it, and writing a connection into it would be one more
 * environment literal to go stale.
 *
 * @constant
 * @type {string}
 */
const MANIFEST_FILENAME = 'manifest.json';

/**
 * Where the JPEG files live in a checkout.
 *
 * Read from `config/thumbnails.js` rather than restated, because that file owns
 * it and a second copy of a path is a second thing to get wrong.
 *
 * @constant
 * @type {string}
 */
const { STORAGE_DIR: THUMBNAIL_STORAGE_DIR } = require('../config/thumbnails');

/**
 * How the caller that invoked this spells its flags.
 *
 * These scripts are reached three ways -- `node scripts/load-corpus.js`,
 * `marp db load` on PowerShell, and `marp.sh db load` -- and the first and third
 * take `--apply` while the second takes `-Apply`. A message that names the wrong
 * one is worse than no message: it tells somebody to type something that does not
 * work, on the one command where they are already being careful.
 *
 * So `scripts/db.ps1` sets `MARP_CLI=pwsh` when it calls in, and the default is
 * this script's own spelling. Nothing infers it from the platform: PowerShell runs
 * on Linux and `marp.sh` runs on Windows.
 *
 * @constant
 * @type {Object<string, string>}
 */
const FLAG = process.env.MARP_CLI === 'pwsh'
    ? { apply: '-Apply', force: '-Force', port: '-Port', dataDir: '-DataDirName' }
    : { apply: '--apply', force: '--force', port: '--port', dataDir: '--data-dir' };

/**
 * Locate one of the PostgreSQL command-line tools.
 *
 * **This repository is not told where `.postgres/` is**, and must not be. It
 * reads five `DB_*` variables and has no idea what is serving them, which is
 * what lets any other PostgreSQL be pointed at it; a hard-coded path into the
 * umbrella's download would quietly undo that. So the tool is found the way
 * `config/thumbnails.js` finds ffmpeg: an explicit override, then a bin
 * directory, then `PATH`.
 *
 * `marp db dump` sets `PG_BIN` when it calls in, exactly as it already sets
 * `DB_*`.
 *
 * @param {string} tool - `pg_dump`, `pg_restore` or `psql`.
 * @returns {string} A path or a bare name for the child process to resolve.
 */
function locateTool(tool) {
    const override = process.env[tool.toUpperCase()];
    if (override) { return override; }

    if (process.env.PG_BIN) {
        // .exe on Windows, nothing elsewhere. spawn does not consult PATHEXT for
        // an absolute path, so the extension has to be right here rather than
        // left to the shell -- which it would be if this were a bare name.
        const suffix = process.platform === 'win32' ? '.exe' : '';
        const candidate = path.join(process.env.PG_BIN, `${tool}${suffix}`);
        if (fs.existsSync(candidate)) { return candidate; }
    }

    return tool;
}

/**
 * Count the corpus tables in a connected database.
 *
 * One statement rather than one per table, so the counts are read in a single
 * snapshot. That matters more than it looks: an inference run writing while this
 * runs would otherwise give observations and keyframes from different moments,
 * and the round-trip comparison would fail on a difference that is real and
 * harmless.
 *
 * A table that does not exist counts as null rather than raising, so this can be
 * used to describe a database with no schema at all.
 *
 * @async
 * @param {import('pg').Client} client - A connected client.
 * @returns {Promise<Object<string, ?number>>} Table name to row count, or null when absent.
 */
async function countCorpus(client) {
    const present = await client.query(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name = any($1)`,
        [CORPUS_TABLES]
    );

    const exists = new Set(present.rows.map((row) => row.table_name));
    const counted = CORPUS_TABLES.filter((table) => exists.has(table));

    const counts = {};
    for (const table of CORPUS_TABLES) { counts[table] = null; }

    if (counted.length > 0) {
        // Identifiers cannot be bound, so they are quoted from CORPUS_TABLES --
        // a constant in this file, never anything a caller supplied.
        const selects = counted
            .map((table) => `(select count(*)::int from public."${table}") as "${table}"`)
            .join(', ');
        const result = await client.query(`select ${selects}`);
        Object.assign(counts, result.rows[0]);
    }

    return counts;
}

/**
 * How many thumbnail files are in a directory.
 *
 * Counts files rather than listing them: a report says "1,110 files", and the
 * names are the database's business. A missing directory is 0, not an error --
 * that is the state of a fresh checkout.
 *
 * @param {string} directory - Directory to count.
 * @returns {number} File count.
 */
function countThumbnailFiles(directory) {
    if (!fs.existsSync(directory)) { return 0; }
    return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .length;
}

/**
 * Whether a database holds work somebody would mind losing.
 *
 * The decision a load's refusal turns on, kept here so it can be tested without
 * a database.
 *
 * **It used to take the thumbnail file count as well, and short-circuit on it.**
 * Files on disk made a database "occupied" before the database itself was looked
 * at, so a provably empty second database was refused -- and the refusal then
 * advised bringing up a second database on its own port, which is exactly what
 * the caller had already done. That read as a bug and was not one: while the
 * storage directory was hardcoded into the checkout there was only ever one of
 * them, so those files were *some* database's corpus and no load could tell
 * which. The short circuit was a guard standing in front of the missing
 * per-database storage.
 *
 * `THUMBNAIL_STORAGE_DIR` (#132, R1) is the thing it was guarding, so it comes
 * out: a directory belongs to a database now rather than to a checkout, and
 * files sitting beside a database with no rows in it are that database's
 * orphans. The count does not stop being reported -- `scripts/load-corpus.js`
 * prints it, says how many orphaned files it is about to replace, and still
 * compares it against the manifest afterwards. It stops being a *refusal*,
 * which is the only thing it was ever wrong about.
 *
 * @param {Object<string, ?number>} counts - From countCorpus.
 * @returns {boolean} True when something is there to lose.
 */
function holdsCorpus(counts) {
    return CORPUS_TABLES.some((table) => (counts[table] || 0) > 0);
}

/**
 * Which counts differ between a dump's manifest and what a load produced.
 *
 * Returns the differences rather than a boolean, because "it did not round trip"
 * is not a useful thing to be told -- which table, and by how much, is.
 *
 * A table the manifest does not mention is skipped rather than treated as zero:
 * an older manifest with a shorter table list should report nothing about the
 * tables it never knew.
 *
 * @param {Object<string, ?number>} expected - Counts recorded at dump time.
 * @param {Object<string, ?number>} actual - Counts after loading.
 * @returns {Array<{table: string, expected: ?number, actual: ?number}>} Empty when they agree.
 */
function compareCounts(expected, actual) {
    const differences = [];

    for (const table of Object.keys(expected)) {
        const before = expected[table];
        const after = actual[table];
        if (before === null || before === undefined) { continue; }
        if ((after || 0) !== before) {
            differences.push({ table, expected: before, actual: after === undefined ? null : after });
        }
    }

    return differences;
}

module.exports = {
    CORPUS_TABLES,
    FLAG,
    DUMP_FILENAME,
    THUMBNAILS_DIRNAME,
    MANIFEST_FILENAME,
    THUMBNAIL_STORAGE_DIR,
    locateTool,
    countCorpus,
    countThumbnailFiles,
    holdsCorpus,
    compareCounts,
};
