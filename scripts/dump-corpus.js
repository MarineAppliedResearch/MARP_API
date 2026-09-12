/**
 * Take a loadable copy of the development corpus -- the database and the
 * thumbnails both.
 *
 * The development database stopped being disposable on 2026-09-10. It holds
 * observations and keyframes from GPU inference runs over real Jellyfin video,
 * the thumbnails extracted from that video, and real review decisions that are
 * the evidence behind recorded walkthroughs. There is no backup, which is why
 * the umbrella's `CLAUDE.md` forbids `marp db destroy` outright. This is the
 * first half of the answer; `load-corpus.js` is the second.
 *
 * **A dump of the rows alone is worse than useless.** `observation_thumbnails`
 * records a filename and the JPEG lives under `storage/`, which is git-ignored,
 * so rows without files restore a corpus whose every tile is a broken pointer --
 * it looks restored and is not. So this writes both halves into one directory.
 *
 * **The dump contains credential material**, by design: users,
 * `auth_identities` and `service_tokens` are in it, because without them a
 * loaded database cannot be logged into and *load and go* becomes *load and then
 * redo the setup*. Settled by the human in #125. It follows that the file stays
 * on the machine that made it -- never committed, never attached to an issue.
 *
 * Usage:
 *   node scripts/dump-corpus.js                   # into .marp/local/corpus/<timestamp>
 *   node scripts/dump-corpus.js <destination>
 *   node scripts/dump-corpus.js <destination> --force   # reuse a non-empty destination
 *
 * Reads the same `DB_*` settings as everything else, through `config/config.js`,
 * so it dumps whatever the API would talk to. Run `marp db status` to see which
 * database that is. Normally invoked as `marp db dump`, which locates `pg_dump`
 * for it.
 *
 * @fileoverview Dump the development corpus: the database and the thumbnails.
 * @module scripts/dump-corpus
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
    DUMP_FILENAME,
    THUMBNAILS_DIRNAME,
    MANIFEST_FILENAME,
    THUMBNAIL_STORAGE_DIR,
    CORPUS_TABLES,
    locateTool,
    countCorpus,
    countThumbnailFiles,
} = require('../db/corpus');

/** Exit code for every refusal, so a caller can tell "no" from "broke". */
const EXIT_REFUSED = 1;

/**
 * Where dumps go when no destination is given.
 *
 * `.marp/local/` because that is this project's convention for machine-specific
 * operational detail and it is git-ignored, so a 30 MB credential-bearing
 * artifact cannot be committed by accident. The cost is stated out loud when the
 * dump finishes: git-ignored also means `git clean -xdf` deletes it.
 *
 * @constant
 * @type {string}
 */
const DEFAULT_PARENT = path.join(__dirname, '..', '.marp', 'local', 'corpus');

/**
 * A timestamp that sorts, in local time.
 *
 * The directory carries it rather than the dump file, so two dumps never collide
 * and the file inside is always found by the same name.
 *
 * @returns {string} `YYYYMMDD-HHMMSS`.
 */
function stamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Run pg_dump into a file.
 *
 * Custom format (`-Fc`): one compressed file, and `pg_restore -l` can list what
 * is in it without loading it. Plain SQL was the alternative -- rejected because
 * a data dump is `COPY ... FROM stdin`, which the `pg` driver cannot execute, so
 * it would need `psql` anyway and be four times the size.
 *
 * Ownership and privileges are kept in the dump and dropped at *restore* time:
 * the dump should record what was there, and the role name on the machine doing
 * the loading is the loader's business.
 *
 * The password goes in the child's environment only. Putting it in an argument
 * would show it to anything that can list processes.
 *
 * @param {string} file - Destination path for the dump.
 * @returns {void}
 */
function runPgDump(file) {
    const tool = locateTool('pg_dump');

    const result = spawnSync(tool, [
        '-h', String(config.host),
        '-p', String(config.port),
        '-U', String(config.username),
        '-d', String(config.database),
        '--format=custom',
        '--file', file,
    ], {
        env: { ...process.env, PGPASSWORD: config.password || '' },
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    if (result.error && result.error.code === 'ENOENT') {
        throw new Error(
            `pg_dump was not found (tried "${tool}"). It ships with the PostgreSQL that `
            + '`marp db up` downloads; run this as `marp db dump`, which points PG_BIN at it, '
            + 'or set PG_DUMP to the binary.'
        );
    }
    if (result.error) { throw result.error; }
    if (result.status !== 0) { throw new Error(`pg_dump exited with ${result.status}`); }
}

/**
 * Write the pointer that says where the corpus is on this machine.
 *
 * #125 asks for this explicitly: an agent told "load the corpus" should be able
 * to find it without being handed the path every time. Overwritten each dump, so
 * it names the newest one -- older dumps are still on disk, and this is a pointer
 * rather than a history.
 *
 * @param {string} destination - The dump directory just written.
 * @param {Object} manifest - What went into it.
 * @returns {string} Path to the pointer file.
 */
function writePointer(destination, manifest) {
    const pointer = path.join(__dirname, '..', '.marp', 'local', 'corpus-dump.md');

    const lines = [
        '# The corpus dump on this machine',
        '',
        'Written by `marp db dump`. Git-ignored, and so is everything it points at.',
        '',
        `- **Taken:** ${manifest.taken}`,
        `- **Dump:** \`${path.join(destination, DUMP_FILENAME)}\``,
        `- **Thumbnails:** \`${path.join(destination, THUMBNAILS_DIRNAME)}\``,
        `- **Rows:** ${CORPUS_TABLES.map((t) => `${t} ${manifest.counts[t]}`).join(', ')}`,
        `- **Thumbnail files:** ${manifest.thumbnailFiles}`,
        '',
        '## Load it',
        '',
        'Into the database that is already running -- `marp db status` says which that is.',
        `A bare \`load\` is a dry run; \`${FLAG.apply}\` writes, and \`${FLAG.force}\` is`,
        'additionally required when the target already holds a corpus.',
        '',
        '```',
        `marp db load "${path.join(destination, DUMP_FILENAME)}" `
            + `"${path.join(destination, THUMBNAILS_DIRNAME)}" ${FLAG.apply}`,
        '```',
        '',
        '**This dump contains credential material** -- users, `auth_identities` and',
        '`service_tokens`, deliberately, so a loaded database can be logged into. It stays on',
        'this machine.',
        '',
    ];

    fs.writeFileSync(pointer, lines.join('\n'), 'utf8');
    return pointer;
}

/**
 * @async
 * @returns {Promise<void>} Resolves when the dump is written, or exits.
 */
async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const positional = args.filter((arg) => !arg.startsWith('--'));

    const destination = positional[0]
        ? path.resolve(positional[0])
        : path.join(DEFAULT_PARENT, stamp());

    if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0 && !force) {
        console.error(`${destination} already has something in it.`);
        console.error(`Pass ${FLAG.force} to write into it anyway, or give a different destination.`);
        process.exit(EXIT_REFUSED);
    }

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
        console.error(`Cannot connect to ${config.database} -- ${error.message}`);
        console.error('Run `marp db status` to see whether the server is up and where.');
        process.exit(EXIT_REFUSED);
    }

    let counts;
    let serverVersion;
    let migrationHead;
    try {
        counts = await countCorpus(client);
        const version = await client.query('show server_version');
        serverVersion = version.rows[0].server_version;

        // The migration the dump was taken at. What makes restore-then-migrate a
        // supported path rather than a guess: a loader can see how far behind the
        // dump is before running db:migrate over it.
        const ledger = await client.query(
            `select coalesce(max(name), '') as head from public."SequelizeMeta"`
        );
        migrationHead = ledger.rows[0].head;
    } finally {
        await client.end();
    }

    const thumbnailFiles = countThumbnailFiles(THUMBNAIL_STORAGE_DIR);

    console.log(`Dumping ${config.database}`);
    for (const table of CORPUS_TABLES) {
        console.log(`  ${String(counts[table] === null ? '-' : counts[table]).padStart(7)}  ${table}`);
    }
    console.log(`  ${String(thumbnailFiles).padStart(7)}  thumbnail files`);
    console.log('');

    fs.mkdirSync(destination, { recursive: true });

    const dumpFile = path.join(destination, DUMP_FILENAME);
    console.log(`==> pg_dump -> ${dumpFile}`);
    runPgDump(dumpFile);
    const dumpBytes = fs.statSync(dumpFile).size;
    console.log(`    ${(dumpBytes / 1048576).toFixed(1)} MB`);

    const thumbnailDestination = path.join(destination, THUMBNAILS_DIRNAME);
    console.log(`==> thumbnails -> ${thumbnailDestination}`);
    if (thumbnailFiles > 0) {
        fs.cpSync(THUMBNAIL_STORAGE_DIR, thumbnailDestination, { recursive: true });
    } else {
        // Created empty rather than skipped, so `load` always has a directory to
        // be pointed at and a corpus with no tiles yet is not a special case.
        fs.mkdirSync(thumbnailDestination, { recursive: true });
    }
    const copied = countThumbnailFiles(thumbnailDestination);
    console.log(`    ${copied} files`);

    if (copied !== thumbnailFiles) {
        throw new Error(
            `copied ${copied} thumbnail files but there were ${thumbnailFiles}. `
            + 'The dump is incomplete; do not rely on it.'
        );
    }

    // No host, port or password: a dump is not tied to the machine that made it,
    // and a connection written in here would be one more environment literal to
    // go stale. The database name is kept because a restore replaces objects in a
    // database and it is worth seeing which one they came from.
    const manifest = {
        taken: new Date().toISOString(),
        database: config.database,
        serverVersion,
        migrationHead,
        counts,
        thumbnailFiles,
        dumpBytes,
    };
    fs.writeFileSync(
        path.join(destination, MANIFEST_FILENAME),
        `${JSON.stringify(manifest, null, 4)}\n`,
        'utf8'
    );

    const pointer = writePointer(destination, manifest);

    console.log('');
    console.log('Dump complete.');
    console.log(`  ${destination}`);
    console.log(`  recorded in ${path.relative(path.join(__dirname, '..'), pointer)}`);
    console.log('');
    console.log('Two things worth knowing about it:');
    console.log('  - It holds users, auth_identities and service_tokens, so it is a');
    console.log('    credential file. Do not commit it or attach it to an issue.');
    console.log('  - It is under a git-ignored directory, which `git clean -xdf` deletes.');
    console.log('    Copy it somewhere outside the workspace if it is the only copy.');
    console.log('');
    console.log('Load it into an empty database with:');
    console.log(`  marp db load "${path.join(destination, DUMP_FILENAME)}" "${thumbnailDestination}" ${FLAG.apply}`);
}

main().catch((error) => {
    console.error(`Dump failed: ${error.message}`);
    process.exit(EXIT_REFUSED);
});
