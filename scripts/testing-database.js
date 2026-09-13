/**
 * Stand up a testing database, once, and then leave it alone.
 *
 * The browser tier for the mosaic reviewer has always run against a fixture,
 * which cannot be wrong the way the endpoint is -- `src/data.js` writes an
 * observation's own status column in place when a page is committed and the API
 * never does, so every defect living in the gap between what a commit recorded
 * and what the row still says is invisible at every tier (#157). Pointing that
 * tier at a real server needs a real database that is **not** the development
 * corpus, because browser tests write.
 *
 * This is that database, and the whole of the design is one sentence: *the first
 * run builds it and every run after that finds it already there.*
 *
 *   node scripts/testing-database.js            # provision if needed, else reuse
 *   node scripts/testing-database.js status     # what is there, and where it came from
 *   node scripts/testing-database.js reset      # throw it away and build it again
 *
 * **It is a second database, not a second PostgreSQL.** `DB_*` says which server,
 * exactly as it always has, and this adds a database inside it with a name of its
 * own and -- since #132 -- a thumbnails directory of its own. A second server on
 * its own port works just as well and needs no change here: point `DB_PORT` at it.
 * What is not negotiable is that the two names differ, which is the one thing
 * this refuses on.
 *
 * **Where the data comes from: a dump, and nothing else.** There is no curated
 * test corpus and inventing one was explicitly not wanted. `marp db dump` writes
 * one to the git-ignored `.marp/local/corpus/`, and the newest one there is what
 * this loads. It does not extract thumbnails from video, it does not run
 * inference, and it never rebuilds anything: all of that is minutes of GPU and
 * Jellyfin time to produce pictures already sitting on the disk.
 *
 * **A dump is a credential file** -- it carries `users`, `auth_identities` and
 * `service_tokens` on purpose, so a loaded database can be logged into. So is the
 * stamp this writes, which records the reviewer login it created. Both live under
 * `.marp/local/`, which is git-ignored, and neither is ever committed or attached
 * to an issue.
 *
 * Refs #132, #157.
 *
 * @fileoverview Provision and inspect the testing database. Idempotent.
 * @module scripts/testing-database
 * @author Isaac Travers
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const config = require('../config/config')[process.env.NODE_ENV || 'development'];

const {
    DUMP_FILENAME,
    THUMBNAILS_DIRNAME,
    MANIFEST_FILENAME,
    countCorpus,
    countThumbnailFiles,
    holdsCorpus,
} = require('../db/corpus');

/** Exit code for every refusal, so a caller can tell "no" from "broke". */
const EXIT_REFUSED = 1;

/** The repository root. Everything relative resolves against this, never the cwd. */
const ROOT = path.join(__dirname, '..');

/**
 * The testing database's name when nothing says otherwise.
 *
 * `marp_`, not `mare_`. The development database is `mare_v1` and the production one
 * shares that name, which is why neither can be renamed casually -- but this database is
 * created here, is disposable, and had no reason to inherit a brand that was retired
 * before it existed. There is no MARE in MARP.
 */
const DEFAULT_DATABASE = 'marp_test';

/**
 * Where the testing database's thumbnails go by default.
 *
 * Under `storage/`, which is git-ignored, and in a `testing/` subdirectory rather
 * than a sibling with a decorated name: anything else a testing database needs on
 * disk later belongs beside it rather than scattered through `storage/`.
 *
 * @constant
 * @type {string}
 */
const DEFAULT_THUMBNAIL_DIR = path.join('storage', 'testing', 'observation-thumbnails');

/**
 * What the browser tier signs in as.
 *
 * A login of its own rather than the human's: the tier commits real decisions,
 * and a decision's attribution is part of the record it writes. `mosaic-testing`
 * appearing in a testing database is self-explanatory in a way that his name
 * would not be.
 *
 * @constant
 * @type {string}
 */
const DEFAULT_REVIEW_USERNAME = 'mosaic-testing';

/**
 * The permissions the mosaic reviewer needs, mirroring `create-review-user.js`.
 *
 * Restated rather than imported because that script is a CLI and exports nothing;
 * `tools/api-session.mjs` checks the same three and names them in its failure, so
 * a drift here arrives as a sign-in refusal that says which one is missing.
 *
 * @constant
 * @type {Array<string>}
 */
const REVIEW_PERMISSIONS = ['observations:read', 'observations:write', 'species:read'];

/**
 * The login a person signs in with to look at a testing database.
 *
 * Asked for on 2026-09-12: *"Make sure the test databases and the dump databases
 * always have an admin account with all rights that I could sign in with a
 * lowercase i-s-a-a-c for both the username and the password."* `marp agent
 * start` creates the bootstrap administrator row and never sets its password, so
 * there is an account and no way to authenticate as it -- which is not something
 * anybody should have to discover by hand at the moment they want to look at a
 * running app.
 *
 * **This is a deliberately weak credential and the literal is the point.** It is
 * not a secret being committed: it opens exactly one kind of database, one this
 * script created on this machine and can drop, and `weakCredentialRefusal` below
 * is what keeps it that way. **Do not move it into `.env` and make it
 * configurable.** That is the obvious tidy-up, and it is the one change that
 * would let isaac/isaac reach somewhere real -- a variable can be pointed
 * anywhere, and a literal cannot.
 *
 * Beside the reviewer login rather than replacing it: `mosaic-testing` holds
 * three permissions on purpose, because an account holding everything cannot
 * show that the gate works.
 *
 * @constant
 * @type {Object}
 */
const ADMIN_LOGIN = { username: 'isaac', password: 'isaac' };

/** The stamp: what was built, from which dump, and how to sign in to it. */
const STAMP_FILE = path.join(ROOT, '.marp', 'local', 'testing-database.json');

/** Where `marp db dump` leaves dumps on this machine. */
const DUMP_HOME = path.join(ROOT, '.marp', 'local', 'corpus');

/**
 * Hosts this is willing to create a database on.
 *
 * The same reasoning as `tests/setup/local-database-guard.js`: the development
 * database carries the same name as production and only the host tells them
 * apart, so a `DB_HOST` pointing somewhere real must stop this rather than be
 * discovered afterwards. Provisioning creates and drops databases; that is not
 * something to do down a connection whose other end is a guess.
 *
 * @constant
 * @type {Array<string>}
 */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/**
 * Everything the caller can change, resolved once.
 *
 * @returns {Object} The testing database's name, its thumbnails directory, and the login.
 */
function settings() {
    return {
        database: process.env.MARP_TESTING_DB_NAME || DEFAULT_DATABASE,
        thumbnails: path.resolve(
            ROOT,
            process.env.MARP_TESTING_THUMBNAIL_DIR || DEFAULT_THUMBNAIL_DIR
        ),
        username: process.env.MARP_REVIEW_USERNAME || DEFAULT_REVIEW_USERNAME,
    };
}

/**
 * Refuse anything that would put this on top of the development corpus.
 *
 * R7, and it is the only refusal here that is not about a missing prerequisite.
 * The whole point of a testing database is that it is a *second* one; a
 * configuration where the two names agree is not a testing database with a
 * confusing name, it is the corpus about to be replaced by a dump.
 *
 * @param {Object} where - From settings().
 * @returns {void} Exits on a refusal.
 */
function refuseIfUnsafe(where) {
    if (where.database === config.database) {
        console.error(`Refused: the testing database and the development database are both `
            + `"${config.database}".`);
        console.error('');
        console.error('Nothing has been changed. A testing database is a second database --');
        console.error('give it a different name with MARP_TESTING_DB_NAME, or point DB_NAME at');
        console.error('the development one. `marp db status` says which is which.');
        process.exit(EXIT_REFUSED);
    }

    if (!LOCAL_HOSTS.includes(String(config.host))) {
        console.error(`Refused: DB_HOST is ${config.host}, which is not this machine.`);
        console.error('');
        console.error('This creates and drops databases. The development database carries the');
        console.error('same name as production and only the host tells them apart, so a remote');
        console.error('host stops this rather than being discovered afterwards.');
        process.exit(EXIT_REFUSED);
    }

    if (where.thumbnails === path.resolve(ROOT, path.join('storage', 'observation-thumbnails'))) {
        console.error('Refused: the testing thumbnails directory is the default development one.');
        console.error('');
        console.error('Loading replaces that directory wholesale, so this would delete the');
        console.error('development corpus\'s pictures. Set MARP_TESTING_THUMBNAIL_DIR, or leave');
        console.error(`it unset for ${DEFAULT_THUMBNAIL_DIR}.`);
        process.exit(EXIT_REFUSED);
    }
}

/**
 * Why a known weak credential may not be created here, or null when it may.
 *
 * Returns the reason rather than exiting, so the judgement can be tested without
 * a database and without a process to kill. Same shape as `holdsCorpus` in
 * `db/corpus.js`, and for the same reason: the decision a refusal turns on is the
 * part worth watching fire.
 *
 * Two conditions, and neither is a new judgement -- both are the one
 * `tests/setup/local-database-guard.js` already makes:
 *
 * - **the host names this machine.** An unset `DB_HOST` is refused rather than
 *   assumed local: that is exactly the state a half-written `.env` leaves behind.
 * - **the target is not the database this checkout develops against.** The
 *   development database carries the same name as production and only the host
 *   tells them apart, so "is this production" is not a question a name can
 *   answer. What it can answer is "this is the second database, the one this
 *   script created here and can drop", and that is the whole licence for putting
 *   `isaac`/`isaac` in it.
 *
 * **`MARP_TEST_ALLOW_REMOTE_DB` is deliberately not honoured.** That override
 * exists so a refusal nobody can get past does not get deleted the first time it
 * is inconvenient -- a good reason for the test suite and a bad one here. The
 * whole value of this refusal is that no flag makes a weak password reach a
 * database somewhere else.
 *
 * @param {Object} where - From settings().
 * @param {string} development - The database `DB_NAME` names.
 * @param {string} host - The database host, from `DB_HOST`.
 * @returns {?string} The reason, or null when it is safe.
 */
function weakCredentialRefusal(where, development, host) {
    const named = String(host === undefined || host === null ? '' : host).trim().toLowerCase();

    if (!LOCAL_HOSTS.includes(named)) {
        return `DB_HOST is ${named === '' ? 'not set' : named}, which is not this machine. A login `
            + `as weak as ${ADMIN_LOGIN.username}/${ADMIN_LOGIN.password} is only ever created on a `
            + 'database this script made here and can drop.';
    }

    if (!where.database || where.database === development) {
        return `The target is ${where.database || '(unnamed)'}, which is the database this checkout `
            + 'develops against. That one carries the same name as production and is not disposable, '
            + 'so it does not get a known weak credential.';
    }

    return null;
}

/**
 * Give the testing database a login a person can actually sign in with.
 *
 * **After the restore, always** -- on the reused path as much as the provisioned
 * one. "Always has an admin account" is the requirement, and a database built
 * before this existed, or one whose password somebody changed, is exactly the
 * case where finding out by hand is expensive.
 *
 * Idempotent because `create-review-user.js` is: it resets the password and
 * re-grants rather than failing or duplicating. Every permission key, read from
 * the catalogue rather than listed here, because `requirePermission` compares the
 * key exactly -- `admin` is not a bypass, so "all rights" has to mean every key
 * actually granted.
 *
 * @param {Object} where - From settings().
 * @param {Object} overrides - DB_NAME and THUMBNAIL_STORAGE_DIR for the child.
 * @returns {void} Exits on a refusal.
 */
function ensureAdminLogin(where, overrides) {
    const refusal = weakCredentialRefusal(where, config.database, config.host);

    if (refusal) {
        console.error(`Refused: ${refusal}`);
        console.error('');
        console.error('Nothing has been changed. This account is a convenience for a throwaway');
        console.error('database and is not a thing to create anywhere else, so there is no flag');
        console.error('that gets past this.');
        process.exit(EXIT_REFUSED);
    }

    console.log(`==> admin login ${ADMIN_LOGIN.username}`);
    runScript(
        'scripts/create-review-user.js',
        ['--username', ADMIN_LOGIN.username, '--all-permissions'],
        { ...overrides, MARP_REVIEW_PASSWORD: ADMIN_LOGIN.password }
    );
}


/**
 * Connect to a database on the configured server.
 *
 * @async
 * @param {string} database - Which database.
 * @returns {Promise<import('pg').Client>} A connected client.
 */
async function connect(database) {
    const client = new Client({
        host: config.host,
        port: config.port,
        database,
        user: config.username,
        password: config.password,
    });
    await client.connect();
    return client;
}

/**
 * Find the dump to load.
 *
 * `MARP_CORPUS_DUMP` wins and may name either the dump directory or the
 * `corpus.dump` inside it, because both are things somebody reasonably has in
 * hand. Otherwise the newest directory under `.marp/local/corpus/`, which is
 * where `marp db dump` puts them and what `.marp/local/corpus-dump.md` records.
 *
 * Newest by name rather than by mtime: the directories are timestamps, so the
 * name *is* the ordering, and a file copy that rewrote the mtimes would otherwise
 * reorder them.
 *
 * @returns {?Object} `{directory, dumpFile, thumbnails, manifest}`, or null when there is none.
 */
function findDump() {
    const nominated = process.env.MARP_CORPUS_DUMP;

    let directory = null;
    if (nominated) {
        const resolved = path.resolve(nominated);
        directory = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
            ? resolved
            : path.dirname(resolved);
    } else if (fs.existsSync(DUMP_HOME)) {
        const candidates = fs.readdirSync(DUMP_HOME, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        if (candidates.length > 0) {
            directory = path.join(DUMP_HOME, candidates[candidates.length - 1]);
        }
    }

    if (!directory) { return null; }

    const dumpFile = path.join(directory, DUMP_FILENAME);
    const thumbnails = path.join(directory, THUMBNAILS_DIRNAME);
    const manifestPath = path.join(directory, MANIFEST_FILENAME);

    if (!fs.existsSync(dumpFile) || !fs.existsSync(thumbnails)) { return null; }

    return {
        directory,
        dumpFile,
        thumbnails,
        manifest: fs.existsSync(manifestPath)
            ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            : null,
    };
}

/**
 * Say where `pg_restore` is, or explain what to set.
 *
 * `db/corpus.js` already looks at `PG_RESTORE`, then `PG_BIN`, then `PATH`, and
 * `marp db load` supplies `PG_BIN` because the umbrella is what knows where its
 * downloaded PostgreSQL lives. Nothing supplies it here, and **this repository
 * must not learn it** -- it reads five `DB_*` variables and has no idea what is
 * serving them, which is what lets any other PostgreSQL be pointed at it.
 *
 * So the last resort asks the *server* rather than the umbrella: `data_directory`
 * is a fact the connection already carries, and a self-contained PostgreSQL keeps
 * its binaries a few levels above its data. That is a **hint, not a contract** --
 * it is wrong on a packaged Linux install, where `bin` and `data` are unrelated
 * paths -- so a miss is a message naming `PG_BIN`, never a guess that fails later
 * inside `pg_restore`.
 *
 * @async
 * @returns {Promise<?string>} A bin directory to put in `PG_BIN`, or null to leave it alone.
 */
async function locatePostgresBin() {
    if (process.env.PG_BIN || process.env.PG_RESTORE) { return process.env.PG_BIN || null; }

    const suffix = process.platform === 'win32' ? '.exe' : '';

    const client = await connect('postgres');
    let dataDirectory;
    try {
        const result = await client.query(
            'select setting from pg_settings where name = \'data_directory\''
        );
        dataDirectory = result.rows[0] && result.rows[0].setting;
    } finally {
        await client.end();
    }

    if (!dataDirectory) { return null; }

    // Up from the data directory, trying the two shapes a self-contained build
    // takes: `<somewhere>/bin` and the zipped distribution's `<somewhere>/pgsql/bin`.
    let ancestor = path.resolve(dataDirectory);
    for (let level = 0; level < 6; level += 1) {
        for (const candidate of [path.join(ancestor, 'bin'), path.join(ancestor, 'pgsql', 'bin')]) {
            if (fs.existsSync(path.join(candidate, `pg_restore${suffix}`))) { return candidate; }
        }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) { break; }
        ancestor = parent;
    }

    return null;
}

/**
 * What is there now.
 *
 * @async
 * @param {Object} where - From settings().
 * @returns {Promise<Object>} `{exists, counts, thumbnailFiles, occupied, ready}`.
 */
async function inspect(where) {
    const server = await connect('postgres');
    let exists;
    try {
        const result = await server.query('select 1 from pg_database where datname = $1', [
            where.database,
        ]);
        exists = result.rowCount > 0;
    } finally {
        await server.end();
    }

    const thumbnailFiles = countThumbnailFiles(where.thumbnails);

    if (!exists) {
        return { exists: false, counts: {}, thumbnailFiles, occupied: false, ready: false };
    }

    const client = await connect(where.database);
    let counts;
    try {
        counts = await countCorpus(client);
    } finally {
        await client.end();
    }

    const occupied = holdsCorpus(counts);

    // "Ready" is deliberately both halves. A database with rows whose thumbnails
    // directory is empty is a corpus where every tile is a broken pointer -- it
    // looks provisioned and is not, which is the same trap `load` refuses one
    // input for.
    return { exists, counts, thumbnailFiles, occupied, ready: occupied && thumbnailFiles > 0 };
}

/** @returns {?Object} The stamp from the last provision, or null. */
function readStamp() {
    if (!fs.existsSync(STAMP_FILE)) { return null; }
    try {
        return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'));
    } catch (error) {
        // A stamp that will not parse is not worth failing over: it is a record of
        // what happened, not a source of truth. The database itself is that.
        return null;
    }
}

/**
 * Run one of this repository's own scripts against the testing database.
 *
 * Overrides arrive as **real environment variables**, which is how `marp db load`
 * already does it: `dotenv` does not overwrite something already set, so these win
 * for this one child process and `.env` is left exactly as written. That is the
 * whole mechanism by which a second database is reachable without editing
 * anything.
 *
 * @param {string} script - Path relative to the repository root.
 * @param {Array<string>} args - Arguments.
 * @param {Object} environment - Extra variables for the child.
 * @returns {void} Throws on a non-zero exit.
 */
function runScript(script, args, environment) {
    const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
        cwd: ROOT,
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    if (result.error) { throw result.error; }
    if (result.status !== 0) {
        throw new Error(`${script} exited with ${result.status}.`);
    }
}

/**
 * A password for the testing login.
 *
 * Generated rather than asked for, because the point of all this is one command.
 * It is written to the stamp under `.marp/local/`, which is git-ignored, and the
 * database it opens is disposable by construction.
 *
 * @returns {string} A URL-safe random password.
 */
function generatePassword() {
    return crypto.randomBytes(18).toString('base64url');
}

/**
 * Build the testing database, or find it already built.
 *
 * @async
 * @param {Object} options - `{reset}`.
 * @returns {Promise<Object>} `{action, where, state, stamp}` where action is 'reused' or 'provisioned'.
 */
async function provision({ reset = false } = {}) {
    const where = settings();
    refuseIfUnsafe(where);

    const before = await inspect(where);
    const stamp = readStamp();

    // Both paths below need these, and the reused one needs them before it
    // returns, so they are resolved here rather than beside the load.
    const overrides = {
        DB_NAME: where.database,
        THUMBNAIL_STORAGE_DIR: where.thumbnails,
    };

    if (before.ready && !reset) {
        // On the reused path too, deliberately. A database built before this
        // existed has no such login, and "it is already there" is exactly when
        // nobody thinks to check.
        ensureAdminLogin(where, overrides);

        return { action: 'reused', where, state: before, stamp };
    }

    const dump = findDump();
    if (!dump) {
        console.error('No corpus dump to load, so there is nothing to build the testing');
        console.error('database from.');
        console.error('');
        console.error('There is no curated test dataset and none is invented: the testing');
        console.error('database is a copy of the development corpus. Take one with');
        console.error('    marp db dump');
        console.error(`and it lands under ${path.relative(ROOT, DUMP_HOME)}/, or point`);
        console.error('MARP_CORPUS_DUMP at one you already have.');
        process.exit(EXIT_REFUSED);
    }

    const binDirectory = await locatePostgresBin();
    if (!binDirectory && !process.env.PG_RESTORE) {
        console.error('pg_restore was not found, and a dump cannot be loaded without it.');
        console.error('');
        console.error('It ships with the PostgreSQL that `marp db up` downloads. Point PG_BIN at');
        console.error('that bin directory, or PG_RESTORE at the binary itself. This repository');
        console.error('deliberately does not know where the umbrella keeps its download.');
        process.exit(EXIT_REFUSED);
    }

    // Dropped and recreated rather than restored over. `pg_restore --clean` would
    // do the tables, but a database that has been reviewed against holds sequences
    // and projection rows the dump's own DDL does not mention, and "the same as a
    // fresh one" is the only state worth calling provisioned.
    const server = await connect('postgres');
    try {
        if (before.exists) {
            console.log(`==> dropping ${where.database}`);
            // WITH (FORCE) because a server left running from an earlier run holds a
            // connection, and "database is being accessed by other users" is a
            // confusing way to be told that.
            await server.query(`drop database if exists "${where.database}" with (force)`);
        }
        console.log(`==> creating ${where.database}`);
        await server.query(`create database "${where.database}"`);
    } finally {
        await server.end();
    }

    if (binDirectory) { overrides.PG_BIN = binDirectory; }

    console.log(`==> loading ${path.relative(ROOT, dump.directory) || dump.directory}`);
    runScript('scripts/load-corpus.js', [dump.dumpFile, dump.thumbnails, '--apply'], overrides);

    // Restore, then migrate -- the supported path, and here it is not optional.
    // A dump is a snapshot of the schema on the day it was taken, and a branch
    // that adds a migration is a branch whose code expects a column the dump does
    // not carry. That failure arrives from deep inside a query during a browser
    // test, which is about the worst place to learn it. The dump carries
    // `SequelizeMeta`, so this applies only what has landed since and is a no-op
    // when the dump is level with the branch, which is the ordinary case.
    console.log('==> migrations');
    runScript('node_modules/sequelize-cli/lib/sequelize', ['db:migrate'], overrides);

    // The login comes last, for the reason the umbrella's setup orders its own
    // steps: the permission catalogue the grant looks keys up in arrives with the
    // dump and may be extended by a migration, so a user created before either one
    // is a user whose grants have nothing to point at.
    const password = (stamp && stamp.password) || generatePassword();
    console.log(`==> reviewer login ${where.username}`);
    runScript(
        'scripts/create-review-user.js',
        ['--username', where.username, '--permissions', REVIEW_PERMISSIONS.join(',')],
        { ...overrides, MARP_REVIEW_PASSWORD: password }
    );

    // Last, for the same reason the reviewer login is: the permission catalogue
    // it grants every key from arrives with the dump and may be extended by a
    // migration, so an account created before either has nothing to point at.
    ensureAdminLogin(where, overrides);

    const after = await inspect(where);

    const written = {
        database: where.database,
        thumbnails: where.thumbnails,
        username: where.username,
        password,
        dump: dump.directory,
        dumpTaken: dump.manifest ? dump.manifest.taken : null,
        provisionedAt: new Date().toISOString(),
        host: os.hostname(),
        counts: after.counts,
        thumbnailFiles: after.thumbnailFiles,
    };

    fs.mkdirSync(path.dirname(STAMP_FILE), { recursive: true });
    fs.writeFileSync(STAMP_FILE, `${JSON.stringify(written, null, 4)}\n`);

    return { action: 'provisioned', where, state: after, stamp: written };
}

/**
 * Print what a caller most wants to know, in the order they want it.
 *
 * The first line says *provisioned* or *reused* in as many words. That is R9, and
 * it is not decoration: the difference between the two is minutes against seconds,
 * and inferring which happened from how long it took is exactly the kind of thing
 * that is wrong the one time it matters.
 *
 * @param {Object} outcome - From provision().
 * @returns {void}
 */
function announce(outcome) {
    const { action, where, state, stamp } = outcome;

    console.log('');
    if (action === 'reused') {
        console.log(`Testing database: REUSED  (${where.database} was already there)`);
    } else {
        console.log(`Testing database: PROVISIONED  (${where.database} built from a dump)`);
    }

    console.log(`  observations     ${state.counts.observations}`);
    console.log(`  reviews          ${state.counts.observation_reviews}`);
    console.log(`  thumbnail files  ${state.thumbnailFiles}`);
    console.log(`  thumbnails in    ${path.relative(ROOT, where.thumbnails)}`);
    console.log(`  sign in as       ${ADMIN_LOGIN.username} / ${ADMIN_LOGIN.password}`);

    if (stamp && stamp.dumpTaken) {
        console.log(`  dump taken       ${stamp.dumpTaken}`);
    }

    // A5: a newer dump is reported and never acted on. Reloading by surprise would
    // throw away whatever a run had set up, and how stale is too stale is a
    // judgement rather than an error.
    if (action === 'reused') {
        const available = findDump();
        const taken = available && available.manifest && available.manifest.taken;
        if (taken && stamp && stamp.dumpTaken && taken > stamp.dumpTaken) {
            console.log('');
            console.log(`A newer dump is on disk, taken ${taken}.`);
            console.log('This reused what is already loaded. To take the newer one:');
            console.log('    node scripts/testing-database.js reset');
        }
    }
}

/**
 * @async
 * @returns {Promise<void>} Resolves when the command is done, or exits.
 */
async function main() {
    const command = process.argv[2] || 'up';

    if (command === 'status') {
        const where = settings();
        const state = await inspect(where);
        const stamp = readStamp();

        console.log(`Server:   ${config.host}:${config.port}   (marp db status says more)`);
        console.log(`Testing:  ${where.database}`);
        console.log(`          ${state.exists ? 'exists' : 'does not exist'}`
            + `, ${state.ready ? 'ready' : 'not ready'}`);
        console.log(`Develop:  ${config.database}   (untouched by anything here)`);
        console.log('');
        console.log(`  thumbnails in    ${path.relative(ROOT, where.thumbnails)}`);
        console.log(`  thumbnail files  ${state.thumbnailFiles}`);
        for (const [table, value] of Object.entries(state.counts)) {
            console.log(`  ${table.padEnd(24)} ${value === null ? 'no table' : value}`);
        }
        if (stamp) {
            console.log('');
            console.log(`  built ${stamp.provisionedAt} from ${stamp.dump}`);
            console.log(`  login ${stamp.username}   (password in ${path.relative(ROOT, STAMP_FILE)})`);
        }
        // Said whether or not there is a stamp: this login does not come from
        // one, and a database built before stamps existed still has it.
        if (state.exists) {
            console.log(`  login ${ADMIN_LOGIN.username} / ${ADMIN_LOGIN.password}   (every permission; `
                + 'a testing database only)');
        }
        return;
    }

    if (command !== 'up' && command !== 'reset') {
        console.error(`Unknown command "${command}". Try: up, status, reset.`);
        process.exit(EXIT_REFUSED);
    }

    const outcome = await provision({ reset: command === 'reset' });
    announce(outcome);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`Testing database: ${error.message}`);
        process.exit(EXIT_REFUSED);
    });
}

module.exports = {
    ADMIN_LOGIN,
    DEFAULT_DATABASE,
    DEFAULT_THUMBNAIL_DIR,
    REVIEW_PERMISSIONS,
    STAMP_FILE,
    settings,
    weakCredentialRefusal,
    findDump,
    inspect,
    provision,
    announce,
    readStamp,
};
