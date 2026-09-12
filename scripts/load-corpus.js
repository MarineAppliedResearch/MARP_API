/**
 * Put a corpus dump back -- the database and the thumbnails both.
 *
 * The other half of `dump-corpus.js`. It loads into the database that is
 * *already running*, the one `marp db up` provides; it does not stand up a
 * second cluster and does not touch `.postgres/`.
 *
 * **This is the most destructive thing in the repository**, so the defaults are
 * arranged so that nothing happens by accident. There is exactly one irreplaceable
 * corpus on this machine -- three GPU runs, real review decisions behind recorded
 * walkthroughs, and no backup -- and a mistyped path must not be what takes it:
 *
 *   - a bare `load` is a **dry run**. It connects, counts, says what it would
 *     destroy, and exits. `--apply` is what writes.
 *   - a target that already holds a corpus is **refused**, `--apply` or not,
 *     until `--force` says so explicitly. The two flags guard different things:
 *     `--apply` means *write at all*, `--force` means *yes, destroy what is in
 *     there*.
 *   - the restore runs in one transaction, so a load that fails part-way leaves
 *     the database it found rather than half of two.
 *   - afterwards the counts are compared against the dump's manifest and a
 *     mismatch is a failure. A dump that cannot be loaded is not a backup, and
 *     that is checked here rather than left to whoever is watching.
 *
 * Stop the API first. `pg_restore --clean` drops every table, and an open
 * connection holding a lock on one of them is what turns a load into a hang.
 *
 * Usage:
 *   node scripts/load-corpus.js <dump> <thumbnails-dir>                  # dry run
 *   node scripts/load-corpus.js <dump> <thumbnails-dir> --apply
 *   node scripts/load-corpus.js <dump> <thumbnails-dir> --apply --force  # over a corpus
 *
 * A dump older than the schema is loaded and then migrated -- it carries
 * `SequelizeMeta`, so `npx sequelize-cli db:migrate` afterwards applies only what
 * has landed since. This prints that reminder when the dump is behind.
 *
 * Reads the same `DB_*` settings as everything else, through `config/config.js`.
 * Run `marp db status` to see which database that is. Normally invoked as
 * `marp db load`, which locates `pg_restore` for it.
 *
 * @fileoverview Load a corpus dump: the database and the thumbnails.
 * @module scripts/load-corpus
 * @author Isaac Travers
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const config = require('../config/config')[process.env.NODE_ENV || 'development'];

const {
    FLAG,
    MANIFEST_FILENAME,
    THUMBNAIL_STORAGE_DIR,
    CORPUS_TABLES,
    locateTool,
    countCorpus,
    countThumbnailFiles,
    holdsCorpus,
    compareCounts,
} = require('../db/corpus');

/** Exit code for every refusal, so a caller can tell "no" from "broke". */
const EXIT_REFUSED = 1;

/**
 * Connect, or explain why not.
 *
 * @async
 * @returns {Promise<import('pg').Client>} A connected client.
 */
async function connect() {
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
        console.error(`Cannot connect to ${config.database} -- ${error.message}`);
        console.error('Run `marp db status` to see whether the server is up and where.');
        process.exit(EXIT_REFUSED);
    }

    return client;
}

/**
 * Restore the dump over whatever is in the database.
 *
 * Three flags carry the weight, and each one is a decision:
 *
 * `--clean --if-exists` because the usual target is a database `marp db up` has
 * already given a schema to. A plain restore there fails on the first
 * `CREATE TABLE` and leaves nothing loaded, which reads as a broken tool rather
 * than as the wrong mode.
 *
 * `--single-transaction` so the whole replacement is atomic. Without it a
 * restore that fails half way has dropped the old tables and not finished
 * creating the new ones -- the one outcome this tool exists to prevent. It also
 * implies `--exit-on-error`, so the first real failure stops the load instead of
 * grinding on and reporting a count mismatch at the end.
 *
 * `--no-owner --no-privileges` because the role name on the machine doing the
 * loading is not the dump's business. Objects end up owned by whoever connected.
 *
 * @param {string} dumpFile - The dump to restore.
 * @returns {void}
 */
function runPgRestore(dumpFile) {
    const tool = locateTool('pg_restore');

    const result = spawnSync(tool, [
        '-h', String(config.host),
        '-p', String(config.port),
        '-U', String(config.username),
        '-d', String(config.database),
        '--clean',
        '--if-exists',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        dumpFile,
    ], {
        env: { ...process.env, PGPASSWORD: config.password || '' },
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    if (result.error && result.error.code === 'ENOENT') {
        throw new Error(
            `pg_restore was not found (tried "${tool}"). It ships with the PostgreSQL that `
            + '`marp db up` downloads; run this as `marp db load`, which points PG_BIN at it, '
            + 'or set PG_RESTORE to the binary.'
        );
    }
    if (result.error) { throw result.error; }
    if (result.status !== 0) {
        throw new Error(
            `pg_restore exited with ${result.status}. It ran in one transaction, so the `
            + 'database is as it was before this started.'
        );
    }
}

/**
 * Replace the thumbnail files.
 *
 * Contents removed rather than the directory itself: the extractor holds the
 * path from `config/thumbnails.js` and a deleted-then-recreated directory is one
 * more way for a running process to be holding a handle to nothing.
 *
 * Done after the database, so a failed restore has not touched the files.
 *
 * @param {string} source - The dump's thumbnails directory.
 * @returns {number} Files now in place.
 */
function replaceThumbnails(source) {
    fs.mkdirSync(THUMBNAIL_STORAGE_DIR, { recursive: true });

    for (const entry of fs.readdirSync(THUMBNAIL_STORAGE_DIR)) {
        fs.rmSync(path.join(THUMBNAIL_STORAGE_DIR, entry), { recursive: true, force: true });
    }

    fs.cpSync(source, THUMBNAIL_STORAGE_DIR, { recursive: true });
    return countThumbnailFiles(THUMBNAIL_STORAGE_DIR);
}

/**
 * Print a two-column count report.
 *
 * @param {Object<string, ?number>} counts - From countCorpus.
 * @param {number} thumbnailFiles - Files on disk.
 * @returns {void}
 */
function report(counts, thumbnailFiles) {
    for (const table of CORPUS_TABLES) {
        const value = counts[table] === null || counts[table] === undefined ? 'no table' : counts[table];
        console.log(`  ${String(value).padStart(8)}  ${table}`);
    }
    console.log(`  ${String(thumbnailFiles).padStart(8)}  thumbnail files`);
}

/**
 * @async
 * @returns {Promise<void>} Resolves when the load is done, or exits.
 */
async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const force = args.includes('--force');
    const positional = args.filter((arg) => !arg.startsWith('--'));

    if (positional.length < 2) {
        console.error(`Usage: load <dump> <thumbnails-dir> [${FLAG.apply}] [${FLAG.force}]`);
        console.error('');
        console.error('Both halves are required. A dump of the rows alone restores a corpus whose');
        console.error('every tile is a broken pointer, which looks restored and is not.');
        console.error('`.marp/local/corpus-dump.md` records where the last dump on this machine is.');
        process.exit(EXIT_REFUSED);
    }

    const dumpFile = path.resolve(positional[0]);
    const thumbnailSource = path.resolve(positional[1]);

    if (!fs.existsSync(dumpFile) || !fs.statSync(dumpFile).isFile()) {
        console.error(`Not a file: ${dumpFile}`);
        process.exit(EXIT_REFUSED);
    }
    if (!fs.existsSync(thumbnailSource) || !fs.statSync(thumbnailSource).isDirectory()) {
        console.error(`Not a directory: ${thumbnailSource}`);
        process.exit(EXIT_REFUSED);
    }

    // Beside the dump, and optional: a dump somebody moved still loads, it just
    // cannot have its round trip checked, and that is said out loud rather than
    // passed over.
    const manifestPath = path.join(path.dirname(dumpFile), MANIFEST_FILENAME);
    const manifest = fs.existsSync(manifestPath)
        ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        : null;

    const client = await connect();
    let before;
    let migrationHead;
    try {
        before = await countCorpus(client);

        // Two statements, and the guard cannot be folded into the second.
        // `to_regclass` returns null for a missing table at *run* time, but the
        // subquery beside it is resolved at *parse* time -- so a single CASE
        // statement still fails with `relation "public.SequelizeMeta" does not
        // exist`, whichever branch would have been taken. That never showed up
        // while every target was a database `marp db up` had already given a
        // schema to; a genuinely empty one, which is what a testing database
        // starts as (#132), is the case that finds it.
        migrationHead = null;
        const ledger = await client.query(
            'select to_regclass(\'public."SequelizeMeta"\') is not null as present'
        );
        if (ledger.rows[0].present) {
            const head = await client.query('select max(name) as head from public."SequelizeMeta"');
            migrationHead = head.rows[0].head;
        }
    } finally {
        await client.end();
    }

    const beforeFiles = countThumbnailFiles(THUMBNAIL_STORAGE_DIR);

    console.log(`Target: ${config.database}   (marp db status says where)`);
    console.log('');
    console.log('In it now:');
    report(before, beforeFiles);

    if (manifest) {
        console.log('');
        console.log(`In the dump, taken ${manifest.taken}:`);
        report(manifest.counts, manifest.thumbnailFiles);
        if (manifest.migrationHead && migrationHead && manifest.migrationHead !== migrationHead) {
            console.log('');
            console.log(`The dump is at migration ${manifest.migrationHead};`);
            console.log(`this database is at ${migrationHead}.`);
            console.log('Restore-then-migrate is the supported path: after loading, run');
            console.log('    npx sequelize-cli db:migrate');
        }
    } else {
        console.log('');
        console.log(`No ${MANIFEST_FILENAME} beside the dump, so the round trip cannot be checked.`);
    }

    const occupied = holdsCorpus(before);

    /* An empty database with files beside it. `holdsCorpus` used to refuse this and
       no longer does (#132, R3) -- the directory belongs to a database now, so those
       files are this database's orphans rather than possibly somebody else's corpus.
       Permitted is not the same as unremarked: say the number out loud, because the
       one reading it is the person best placed to know whether the empty database is
       a surprise. */
    if (!occupied && beforeFiles > 0) {
        console.log('');
        console.log(`Note: no rows here, but ${beforeFiles} thumbnail files are on disk.`);
        console.log(`They are orphans -- nothing in ${config.database} names them -- and a load`);
        console.log(`replaces them. Their directory is ${THUMBNAIL_STORAGE_DIR}`);
        console.log('(THUMBNAIL_STORAGE_DIR, or its default). If that is not the directory you');
        console.log('meant, stop now: the rows that name these files are in another database.');
    }

    if (occupied && !force) {
        // console.log rather than console.error, deliberately. Node's stdout is
        // pipe-buffered and its stderr is not, so a refusal written to stderr
        // arrived *above* the counts it was drawn from -- a verdict printed before
        // its own evidence reads as a bug in the tool. The exit code is what a
        // caller checks; the ordering is what a person reads.
        console.log('');
        console.log('Refused: this database already holds a corpus, and a load replaces it.');
        console.log('');
        console.log('Nothing has been changed. If this is the corpus that has no backup, take');
        console.log('one first:  marp db dump');
        console.log('If you meant a second database, it needs a thumbnails directory of its');
        console.log('own as well as a name of its own -- THUMBNAIL_STORAGE_DIR, or let');
        console.log('`node scripts/testing-database.js` arrange both.');
        console.log(`If you really do mean to replace what is in there, say so: ${FLAG.force}`);
        process.exit(EXIT_REFUSED);
    }

    if (!apply) {
        console.log('');
        console.log('Dry run -- nothing written.');
        if (occupied) {
            console.log(`With ${FLAG.apply} ${FLAG.force} this would drop every table above and`);
            console.log(`replace the ${beforeFiles} thumbnail files on disk.`);
        } else {
            console.log(`With ${FLAG.apply} this would load the dump into this empty database.`);
        }
        return;
    }

    console.log('');
    console.log(`==> pg_restore <- ${dumpFile}`);
    runPgRestore(dumpFile);
    console.log('    restored');

    console.log(`==> thumbnails <- ${thumbnailSource}`);
    const files = replaceThumbnails(thumbnailSource);
    console.log(`    ${files} files`);

    const after = await connect();
    let counts;
    try {
        counts = await countCorpus(after);
    } finally {
        await after.end();
    }

    console.log('');
    console.log('Loaded:');
    report(counts, files);

    if (!manifest) {
        console.log('');
        console.log('Loaded, but unverified: there was no manifest to compare against.');
        return;
    }

    const differences = compareCounts(manifest.counts, counts);
    if (files !== manifest.thumbnailFiles) {
        differences.push({
            table: 'thumbnail files',
            expected: manifest.thumbnailFiles,
            actual: files,
        });
    }

    if (differences.length > 0) {
        // Same stream as the counts above, for the same reason as the refusal.
        console.log('');
        console.log('The load does not match the dump:');
        for (const difference of differences) {
            console.log(`  ${difference.table}: expected ${difference.expected}, got ${difference.actual}`);
        }
        console.log('');
        console.log('Do not treat this dump as a backup until that is understood.');
        process.exit(EXIT_REFUSED);
    }

    console.log('');
    console.log('Round trip verified: every count matches the manifest.');
    if (manifest.migrationHead && manifest.migrationHead !== migrationHead) {
        console.log('');
        console.log('The schema is the dump\'s now. Bring it forward with:');
        console.log('    npx sequelize-cli db:migrate');
    }
}

main().catch((error) => {
    console.error(`Load failed: ${error.message}`);
    process.exit(EXIT_REFUSED);
});
