/**
 * Rename existing thumbnails to their content hash, and point the rows at them.
 *
 * The one-off repair behind `db/thumbnail-filename.js`. Tiles written before that
 * are named `${observation_id}.jpg`, and `observation_id` is assigned as
 * `max(observation_id) + 1` **per database** (#62) -- so two independent databases
 * hand out overlapping ranges by construction and both own `582.jpg`. That is why
 * they cannot share a thumbnails directory, and why a collision is not a broken
 * tile: `routes/thumbnail.routes.js` serves what the row names after checking only
 * that the file exists, so the answer is a 200, a plausible ETag and a picture of
 * the wrong animal.
 *
 * A script rather than something typed at a prompt, because "seed it, do not type
 * it" is about a one-off repair as much as about rows: this has to run on a
 * disposable database first and the development one after, and the two runs have
 * to be the same run.
 *
 * **No migration, deliberately.** `observation_thumbnails.filename` already holds
 * the name and serving reads it off the row rather than deriving it, so the
 * column's meaning does not change. Thumbnails have never run on production --
 * `master` is roughly a year behind and that migration has never been applied
 * there -- so there is no installed base to preserve and no compatibility shim to
 * write.
 *
 * Usage:
 *   node scripts/rename-thumbnails-by-content.js            # dry run
 *   node scripts/rename-thumbnails-by-content.js --apply
 *
 * Reads the same `DB_*` settings as everything else and the same
 * `THUMBNAIL_STORAGE_DIR` as the extractor, so it repairs whichever corpus those
 * two name. `marp db status` says which database that is; `npm run testing-db
 * status` says the same about the testing one.
 *
 * **Idempotent.** A second run finds every file already named by its bytes and
 * changes nothing -- which is a property of the naming rule rather than of a flag:
 * the name of a file's content is the same every time it is computed.
 *
 * Refs #62.
 *
 * @fileoverview Rename observation thumbnails to their content hash. Idempotent.
 * @module scripts/rename-thumbnails-by-content
 * @author Isaac Travers
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const config = require('../config/config')[process.env.NODE_ENV || 'development'];
const { STORAGE_DIR } = require('../config/thumbnails');
const { HASH_ALGORITHM, EXTENSION, CONTENT_NAME_PATTERN } = require('../db/thumbnail-filename');

/** Exit code for every refusal and every failed check, so a caller can tell "no" from "broke". */
const EXIT_REFUSED = 1;

/** How many examples a report prints before it summarises the rest. */
const EXAMPLES = 20;

/**
 * Work out what has to happen, from rows and digests alone.
 *
 * Pure, and separated from the database and the disk for the reason
 * `db/corpus.js` gives about `holdsCorpus`: the decision is the part worth
 * testing, and it should be testable without standing anything up.
 *
 * Five outcomes, and four of them are reports rather than work:
 *
 * - **rename** -- a row whose file is on disk under the wrong name.
 * - **alreadyNamed** -- a row whose file is already its own digest. This is what
 *   makes a second run a no-op.
 * - **missingFile** -- a row naming a file that is not there. Reported, never
 *   "fixed": the row carries the frame and the source dimensions it was made
 *   from, so the picture is re-extractable, and inventing one here would be
 *   inventing evidence.
 * - **noFilename** -- a row that never had a file.
 * - **orphan** -- a file no row names.
 *
 * Two rows may share a target, because two rows may hold byte-identical tiles.
 * That is the mechanism working rather than a collision: identical bytes are one
 * file, and both rows point at it.
 *
 * @param {Array<Object>} rows - `{observation_id, status, filename}`.
 * @param {Map<string, string>} digests - Filename to hex digest. Absent means no file.
 * @param {Array<string>} filesOnDisk - Every file in the storage directory.
 * @returns {Object} `{renames, alreadyNamed, missingFiles, noFilename, orphans}`.
 */
function planActions(rows, digests, filesOnDisk) {
    const renames = [];
    const alreadyNamed = [];
    const missingFiles = [];
    const noFilename = [];
    const claimed = new Set();

    for (const row of rows) {
        if (!row.filename) {
            noFilename.push(row);
            continue;
        }

        const digest = digests.get(row.filename);

        if (!digest) {
            missingFiles.push(row);
            continue;
        }

        claimed.add(row.filename);

        const target = digest + EXTENSION;

        if (row.filename === target) {
            alreadyNamed.push(row);
            continue;
        }

        renames.push({ observationId: row.observation_id, from: row.filename, to: target });
    }

    // A file is an orphan when no row names it -- including a row that names it
    // now and is about to be pointed somewhere else, which is why `claimed` is
    // recorded before the rename rather than after.
    const orphans = filesOnDisk.filter((file) => !claimed.has(file));

    return { renames, alreadyNamed, missingFiles, noFilename, orphans };
}

/**
 * Digest every file in the storage directory.
 *
 * One at a time rather than in parallel: this is a few thousand files of about
 * 20 KB and the whole pass is seconds, so nothing is bought by holding thousands
 * of buffers at once.
 *
 * @param {Array<string>} files - Filenames, relative to the storage directory.
 * @returns {Map<string, string>} Filename to hex digest.
 */
function digestFiles(files) {
    const digests = new Map();

    for (const file of files) {
        const bytes = fs.readFileSync(path.join(STORAGE_DIR, file));
        digests.set(file, crypto.createHash(HASH_ALGORITHM).update(bytes).digest('hex'));
    }

    return digests;
}

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
 * Copy each file to its content name, leaving the original in place.
 *
 * **Copy rather than move, and that is the whole safety argument for doing this
 * in three phases.** A move leaves a window in which the file has its new name
 * and the row still holds the old one, and nothing can recover from that: the
 * mapping from row to file *was* the name. A copy leaves both names present, so
 * every row stays servable throughout and an interrupted run is repaired by
 * running it again.
 *
 * It transiently doubles the directory. At a few thousand tiles of about 20 KB
 * that is tens of megabytes, which is the cheapest part of this.
 *
 * @param {Array<Object>} renames - From planActions.
 * @returns {number} Files copied, not counting ones already in place.
 */
function copyToContentNames(renames) {
    let copied = 0;

    for (const action of renames) {
        const target = path.join(STORAGE_DIR, action.to);

        // Already there means an earlier run put it there, or two rows hold
        // byte-identical tiles and the first of them wrote it. Identical bytes by
        // construction -- the name is the digest -- so there is nothing to choose
        // between them and nothing to overwrite.
        if (fs.existsSync(target)) { continue; }

        fs.copyFileSync(path.join(STORAGE_DIR, action.from), target);
        copied++;
    }

    return copied;
}

/**
 * Point the rows at the new names, all of them or none.
 *
 * One transaction: half-renamed rows beside a directory holding both names is a
 * state nobody should have to reason about, and there is no reason to accept it
 * when the whole update is a few thousand small statements.
 *
 * The `filename = $3` in the predicate is not decoration. It means a row somebody
 * changed between the plan and the write is left alone rather than pointed at a
 * file derived from bytes it no longer holds, and the count that comes back says
 * so.
 *
 * @async
 * @param {import('pg').Client} client - A connected client.
 * @param {Array<Object>} renames - From planActions.
 * @returns {Promise<number>} Rows updated.
 */
async function updateRows(client, renames) {
    let updated = 0;

    await client.query('begin');
    try {
        for (const action of renames) {
            const result = await client.query(
                `update observation_thumbnails
                    set filename = $2, updated_at = now()
                  where observation_id = $1 and filename = $3`,
                [action.observationId, action.to, action.from]
            );
            updated += result.rowCount;
        }
        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        throw error;
    }

    return updated;
}

/**
 * Remove the old-named files, now that nothing points at them.
 *
 * Last, and only for files this run copied away from. A file goes on the strength
 * of its content living on under another name, never on the strength of one row
 * having stopped pointing at it -- no row owns its file, because two rows may
 * share one.
 *
 * @param {Array<Object>} renames - From planActions.
 * @param {Set<string>} stillNamed - Filenames some row still holds.
 * @returns {number} Files removed.
 */
function removeSupersededFiles(renames, stillNamed) {
    let removed = 0;

    for (const action of renames) {
        if (stillNamed.has(action.from)) { continue; }

        const source = path.join(STORAGE_DIR, action.from);

        // The copy has to be there before the original goes. Checked rather than
        // assumed: this is the one step that destroys anything.
        if (!fs.existsSync(path.join(STORAGE_DIR, action.to))) { continue; }
        if (!fs.existsSync(source)) { continue; }

        fs.rmSync(source);
        removed++;
    }

    return removed;
}

/**
 * Check every ready row can still be served.
 *
 * The only claim this script makes that matters, so it is checked rather than
 * inferred from the counts above it. `status = 'ready'` plus a filename plus a
 * file is exactly what `routes/thumbnail.routes.js` requires before it serves
 * anything.
 *
 * @async
 * @param {import('pg').Client} client - A connected client.
 * @returns {Promise<Object>} `{ready, servable, broken}`, broken being the rows.
 */
async function verifyReadyRows(client) {
    const { rows } = await client.query(
        `select observation_id, filename from observation_thumbnails
          where status = 'ready' order by observation_id`
    );

    const broken = rows.filter(
        (row) => !row.filename || !fs.existsSync(path.join(STORAGE_DIR, row.filename))
    );

    return { ready: rows.length, servable: rows.length - broken.length, broken };
}

/**
 * Say what the corpus looks like and what would happen to it.
 *
 * @param {Object} plan - From planActions.
 * @param {number} files - Files on disk.
 * @returns {void}
 */
function report(plan, files) {
    console.log('In it now:');
    console.log(`  ${String(files).padStart(8)}  thumbnail files`);
    console.log(`  ${String(plan.renames.length).padStart(8)}  rows to rename`);
    console.log(`  ${String(plan.alreadyNamed.length).padStart(8)}  rows already named by their content`);
    console.log(`  ${String(plan.missingFiles.length).padStart(8)}  rows whose file is missing`);
    console.log(`  ${String(plan.noFilename.length).padStart(8)}  rows that never had a file`);
    console.log(`  ${String(plan.orphans.length).padStart(8)}  files no row names`);

    // All three of the following are reported and left alone. A row with no file
    // is re-extractable from what the row carries, and a file no row names is
    // somebody's evidence until they say otherwise -- neither is this script's to
    // decide about.
    if (plan.noFilename.length > 0) {
        const byStatus = {};
        for (const row of plan.noFilename) {
            byStatus[row.status] = (byStatus[row.status] || 0) + 1;
        }
        console.log('');
        console.log('Rows with no file, by status:');
        for (const [status, count] of Object.entries(byStatus)) {
            console.log(`  ${String(count).padStart(8)}  ${status}`);
        }
        console.log('  A failed extraction never wrote a file, so a `failed` count here is a');
        console.log('  record of a failure rather than a gap a rename could close.');
    }

    if (plan.missingFiles.length > 0) {
        console.log('');
        console.log('Rows naming a file that is not on disk:');
        for (const row of plan.missingFiles.slice(0, EXAMPLES)) {
            console.log(`  observation ${row.observation_id}  ${row.status}  ${row.filename}`);
        }
        if (plan.missingFiles.length > EXAMPLES) {
            console.log(`  ... and ${plan.missingFiles.length - EXAMPLES} more`);
        }
        console.log('  Left alone. The row carries the frame and the source dimensions it was');
        console.log('  made from, so the picture is re-extractable; inventing one is not.');
    }

    if (plan.orphans.length > 0) {
        console.log('');
        console.log('Files no row names:');
        for (const file of plan.orphans.slice(0, EXAMPLES)) { console.log(`  ${file}`); }
        if (plan.orphans.length > EXAMPLES) {
            console.log(`  ... and ${plan.orphans.length - EXAMPLES} more`);
        }
        console.log('  Left alone, and not renamed either: a file nothing points at is not this');
        console.log('  script\'s to delete. Said out loud so whoever knows can decide.');
    }
}

/**
 * @async
 * @returns {Promise<void>} Resolves when the rename is done, or exits.
 */
async function main() {
    const apply = process.argv.includes('--apply');

    if (!fs.existsSync(STORAGE_DIR)) {
        console.error(`No thumbnails directory at ${STORAGE_DIR}`);
        console.error('That is THUMBNAIL_STORAGE_DIR, or its default. Nothing to rename.');
        process.exit(EXIT_REFUSED);
    }

    const client = await connect();

    try {
        const { rows } = await client.query(
            'select observation_id, status, filename from observation_thumbnails order by observation_id'
        );

        const files = fs.readdirSync(STORAGE_DIR, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name);

        const plan = planActions(rows, digestFiles(files), files);

        console.log(`Database:   ${config.database}   (marp db status says where)`);
        console.log(`Thumbnails: ${STORAGE_DIR}`);
        console.log('');
        report(plan, files.length);

        if (plan.renames.length === 0) {
            console.log('');
            console.log('Every row that has a file is already named by its content. Nothing to do.');
        } else if (!apply) {
            console.log('');
            console.log('Dry run -- nothing written.');
            console.log(`With --apply this would rename ${plan.renames.length} file(s) and update`);
            console.log('the same number of rows to match.');
        }

        if (!apply) { return; }

        if (plan.renames.length > 0) {
            // Three phases, and the order is the safety argument: copy, so both
            // names exist and every row stays servable; update, in one
            // transaction; then remove what nothing points at. An interruption at
            // any point leaves a corpus that serves, and a re-run finishes it.
            console.log('');
            console.log('==> copying to content names');
            const copied = copyToContentNames(plan.renames);
            console.log(`    ${copied} copied, ${plan.renames.length - copied} already there`);

            console.log('==> updating rows');
            const updated = await updateRows(client, plan.renames);
            console.log(`    ${updated} rows`);

            if (updated !== plan.renames.length) {
                console.log(`    ${plan.renames.length - updated} row(s) had changed since the plan`);
                console.log('    and were left holding the name they hold now.');
            }

            const stillNamed = new Set(
                (await client.query(
                    'select distinct filename from observation_thumbnails where filename is not null'
                )).rows.map((row) => row.filename)
            );

            console.log('==> removing superseded files');
            console.log(`    ${removeSupersededFiles(plan.renames, stillNamed)} removed`);
        }

        const check = await verifyReadyRows(client);

        console.log('');
        console.log(`Checked: ${check.servable} of ${check.ready} ready rows have their file.`);

        if (check.broken.length > 0) {
            console.log('');
            console.log('These ready rows cannot be served:');
            for (const row of check.broken.slice(0, EXAMPLES)) {
                console.log(`  observation ${row.observation_id}  ${row.filename || '(no filename)'}`);
            }
            console.log('');
            console.log('Do not treat this corpus as renamed until that is understood.');
            process.exit(EXIT_REFUSED);
        }

        const stillOld = (await client.query(
            'select count(*)::int as n from observation_thumbnails'
            + " where filename is not null and filename !~ $1",
            [CONTENT_NAME_PATTERN.source]
        )).rows[0].n;

        if (stillOld > 0) {
            console.log('');
            console.log(`Refused to call this done: ${stillOld} row(s) still hold a name that is`);
            console.log('not a content hash.');
            process.exit(EXIT_REFUSED);
        }

        console.log('Every filename in the table is a content hash.');
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`Rename failed: ${error.message}`);
        process.exit(EXIT_REFUSED);
    });
}

module.exports = {
    planActions,
};
