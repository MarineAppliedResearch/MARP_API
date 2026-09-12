/**
 * Run the mosaic reviewer's browser tests against a real API, on a real database.
 *
 * The one command #132 asks for, in the human's words: *"a launcher or testing
 * script that runs tests, and if a database with the proper thumbnails hasn't
 * been stood up in that workspace, it makes it. And that way, anytime we run that
 * test again, it doesn't have to remake the whole database."*
 *
 *   npm run test:app:mosaic-review:api
 *   npm run test:app:mosaic-review:api -- -g "take-back"
 *
 * It does four things, and stops after any of them fails:
 *
 * 1. **Provisions the testing database, or finds it.** `scripts/testing-database.js`
 *    owns that and says which of the two happened, in as many words.
 * 2. **Starts an API of its own**, pointed at the testing database and its own
 *    thumbnails, on a port nothing else holds.
 * 3. **Runs the `api` Playwright project** against it, signed in as the reviewer
 *    login the provisioning created.
 * 4. **Stops the server it started.** Always -- a server outliving its work was
 *    once adopted by a different checkout's browser tests, which then graded that
 *    checkout's code for an hour without saying so.
 *
 * **The port is taken from the operating system, not chosen.** Nothing outside
 * needs to know it: this is what tells Playwright where to look, through
 * `MARP_API_BASE`. A fixed number is how a run comes to grade a server somebody
 * else started, and there are three of them on this machine already.
 *
 * **It never touches the development database.** The provisioning refuses when the
 * two names agree, and this only ever hands the child processes the testing one.
 *
 * Refs #132, #157.
 *
 * @fileoverview One command: provision if needed, serve, run the API tier, stop.
 * @module scripts/test-on-testing-database
 * @author Isaac Travers
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { provision, announce, readStamp } = require('./testing-database');

/** Exit code for a refusal, so a caller can tell "no" from "tests failed". */
const EXIT_REFUSED = 1;

/** The repository root. */
const ROOT = path.join(__dirname, '..');

/** The application whose tests these are. */
const APP_DIR = path.join(ROOT, 'frontend', 'apps', 'marp-mosaic-review');

/** How long to wait for the API to answer before giving up, in milliseconds. */
const STARTUP_TIMEOUT_MS = 60000;

/**
 * Where the API's own output goes while this runs.
 *
 * Not the terminal, and that is not tidiness. Sequelize logs every statement to
 * `console.log` in development and there is no switch for it, so a run that
 * inherits the server's stdout buries "1 passed" under a few hundred lines of
 * SQL -- including the mosaic query, which is ninety lines on its own. The log is
 * kept rather than discarded, and its tail is printed whenever something fails,
 * which is the only time anybody wants it.
 *
 * `.marp/local/` is git-ignored, and the log quotes rows from the corpus.
 *
 * @constant
 * @type {string}
 */
const API_LOG = path.join(__dirname, '..', '.marp', 'local', 'testing-api.log');

/** How much of that log is worth printing when something goes wrong. */
const LOG_TAIL_LINES = 40;

/**
 * Ask the operating system for a port nobody is using.
 *
 * Bind to 0, read what was given, let it go. There is a race in principle --
 * something could take it between the release and the server's own bind -- and it
 * is the right trade anyway: the alternative is a literal, and a literal here is
 * wrong the moment a second agent runs this, which is the normal case in this
 * workspace rather than the exception.
 *
 * @async
 * @returns {Promise<number>} A free port.
 */
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Wait until the API answers, or say what it did instead.
 *
 * Any HTTP response counts, including a 401 or a redirect to the sign-in page:
 * the question is whether the server is listening and serving, not whether this
 * request was allowed. Checking for a 200 on a gated route would wait for ever on
 * a perfectly healthy server.
 *
 * @async
 * @param {string} base - Where the API should be.
 * @param {Function} stillRunning - Returns false once the child has exited.
 * @returns {Promise<void>} Resolves when it answers.
 */
async function waitForApi(base, stillRunning) {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (!stillRunning()) {
            throw new Error('the API exited before it began listening -- its output is above.');
        }

        const answered = await new Promise((resolve) => {
            const request = http.get(`${base}/`, (response) => {
                response.resume();
                resolve(true);
            });
            request.on('error', () => resolve(false));
            request.setTimeout(2000, () => { request.destroy(); resolve(false); });
        });

        if (answered) { return; }
        await new Promise((wait) => { setTimeout(wait, 250); });
    }

    throw new Error(`the API did not answer on ${base} within ${STARTUP_TIMEOUT_MS / 1000}s.`);
}

/**
 * Run a child to completion and hand back its exit code.
 *
 * @async
 * @param {string} command - Executable.
 * @param {Array<string>} args - Arguments.
 * @param {Object} options - Passed to spawn.
 * @returns {Promise<number>} The exit code.
 */
function run(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', ...options });
        child.on('error', reject);
        child.on('close', (code) => resolve(code === null ? 1 : code));
    });
}

/**
 * Show the end of the API's own log.
 *
 * Called only on a failure. The whole point of writing it to a file is that
 * nobody wants it otherwise, and the whole point of keeping it is that when a
 * browser test fails against a real server, the server's side of it is usually
 * where the answer is.
 *
 * @returns {void}
 */
function printLogTail() {
    if (!fs.existsSync(API_LOG)) { return; }

    const lines = fs.readFileSync(API_LOG, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) { return; }

    console.log('');
    console.log(`--- the API's last ${Math.min(LOG_TAIL_LINES, lines.length)} lines `
        + `(${path.relative(ROOT, API_LOG)}) ---`);
    for (const line of lines.slice(-LOG_TAIL_LINES)) { console.log(line); }
}

/**
 * @async
 * @returns {Promise<void>} Resolves when the run is over; sets the exit code.
 */
async function main() {
    // Everything after a bare `--` is Playwright's, so `-- -g "take-back"` works
    // the way it does everywhere else. npm already strips one level of it.
    const passthrough = process.argv.slice(2).filter((argument) => argument !== '--');

    const outcome = await provision({ reset: process.argv.includes('--reset') });
    announce(outcome);

    const stamp = outcome.stamp || readStamp();
    if (!stamp || !stamp.password) {
        console.error('');
        console.error('The testing database has no recorded login, so there is nothing to sign');
        console.error('in as. Rebuild it:  node scripts/testing-database.js reset');
        process.exit(EXIT_REFUSED);
    }

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    fs.mkdirSync(path.dirname(API_LOG), { recursive: true });
    const logFile = fs.openSync(API_LOG, 'w');

    console.log('');
    console.log(`==> API on ${base}   (this run's own, stopped when it finishes)`);
    console.log(`    its output: ${path.relative(ROOT, API_LOG)}`);

    const api = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd: ROOT,
        // Real environment variables, so `dotenv` leaves them alone. This is the
        // only place the testing database reaches the application, and it is three
        // variables rather than an edited `.env` -- which would still be edited
        // tomorrow, pointing a development server at the testing corpus.
        env: {
            ...process.env,
            PORT: String(port),
            DB_NAME: stamp.database,
            THUMBNAIL_STORAGE_DIR: stamp.thumbnails,
        },
        stdio: ['ignore', logFile, logFile],
    });

    let exited = false;
    api.on('close', () => { exited = true; });

    /** Stop the server, whatever happened. Called from every path out of here. */
    const stopApi = () => {
        if (!exited) { api.kill(); }
    };
    process.on('exit', stopApi);
    process.on('SIGINT', () => { stopApi(); process.exit(130); });

    let code;
    try {
        await waitForApi(base, () => !exited);

        // Playwright's own entry point under `node`, not the `.bin` shim. The shim
        // is `playwright.cmd` on Windows, which needs `shell: true` to run at all
        // -- and passing arguments through a shell is unescaped concatenation,
        // which Node now warns about on every run. This is the same program with
        // nothing between it and the arguments.
        const playwright = path.join(APP_DIR, 'node_modules', '@playwright', 'test', 'cli.js');

        code = await run(process.execPath, [playwright, 'test', '--project=api', ...passthrough], {
            cwd: APP_DIR,
            env: {
                ...process.env,
                MARP_API_BASE: base,
                MARP_REVIEW_USERNAME: stamp.username,
                MARP_REVIEW_PASSWORD: stamp.password,
                // The testing database, for the tests that need to reach past the
                // application and write what only a second writer could -- the
                // conflict case. Named rather than assumed, so a test that uses it
                // cannot silently reach the development database instead.
                MARP_TESTING_DB_NAME: stamp.database,
            },
        });
    } finally {
        stopApi();
    }

    console.log('');
    if (code === 0) {
        console.log('The API tier passed, against a real server on the testing database.');
    } else {
        console.log(`The API tier failed (${code}). The database is still there; the next run`);
        console.log('reuses it, so a re-run starts in seconds.');
        printLogTail();
    }

    process.exitCode = code;
}

main().catch((error) => {
    console.error(`Could not run the API tier: ${error.message}`);
    // The likeliest failure here is the server not starting, and its reason is in
    // its own log rather than in this message.
    printLogTail();
    process.exit(EXIT_REFUSED);
});
