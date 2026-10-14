/**
 * Refuses to run the suite against a database that is not local.
 *
 * Jest's `globalSetup`, so it runs once per run, before any suite opens a
 * connection. The corpus guard detects a change after the fact; on production
 * after the fact is too late, because the rows are already gone and there is
 * no dump.
 *
 * This matters more here than it looks. **The development database is also
 * called `mare_v1`, the same name as production** — only the host tells them
 * apart, so a misdirected `.env` is genuinely dangerous rather than
 * theoretically so. #142, and the human's words: *"none of our tests ever
 * destructively hurt the data if I ever accidentally run the test on the
 * production server."*
 *
 * Somebody who knows what they are doing sets the override variable named
 * below. That is deliberate: a refusal with no way past it gets deleted the
 * first time it is inconvenient.
 *
 * @fileoverview Jest globalSetup that refuses a non-local test database.
 * @author Isaac Travers
 * @module tests/setup/local-database-guard
 */

'use strict';

/**
 * Hosts that name this machine. Anything else is somebody else's database.
 *
 * @constant
 * @type {string[]}
 */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/**
 * Environment variable that waives the refusal.
 *
 * @constant
 * @type {string}
 */
const OVERRIDE = 'MARP_TEST_ALLOW_REMOTE_DB';

/* The coordinator's own threshold, read rather than restated: a literal here
   would go on agreeing with itself after somebody changed the real one. */
const { WORKER_OFFLINE_SECONDS } = require('../../config/gpu-orchestration');

/**
 * Throws unless `DB_HOST` names this machine or the override is set.
 *
 * Exported so it has a test of its own: the refusal is only worth having if
 * somebody has watched it fire.
 *
 * @param {Object} env Environment to read, normally `process.env`.
 * @returns {void}
 * @throws {Error} When the host is not local and the override is not set.
 */
function assertLocalDatabase(env) {
    if (env[OVERRIDE]) {
        return;
    }

    const host = String(env.DB_HOST || '').trim();

    if (LOCAL_HOSTS.includes(host.toLowerCase())) {
        return;
    }

    // An unset DB_HOST is refused rather than assumed local: it is exactly the
    // state a half-written .env leaves behind.
    const named = host === '' ? 'DB_HOST is not set' : `DB_HOST is ${host}`;

    throw new Error(
        'Refusing to run the test suite against a database that is not local.\n'
        + `  ${named}; the suite only runs against ${LOCAL_HOSTS.slice(0, 2).join(' or ')}.\n`
        + '  The tests write to whatever DB_* points at, and the development database\n'
        + '  carries the same name as production, so only the host tells them apart.\n'
        + `  If this really is a disposable database, set ${OVERRIDE}=1.`
    );
}

/**
 * Jest's globalSetup entry point.
 *
 * @returns {Promise<void>} Resolves when the target is local.
 */
async function globalSetup() {
    // config/config.js loads .env into process.env; the suite reads the same
    // five DB_* variables the API does.
    require('dotenv').config();

    assertLocalDatabase(process.env);
    await settleStaleWorkers();
}

/**
 * Take the pool's own housekeeping before anything is measured.
 *
 * A poll and a pool read both retire workers that have stopped heartbeating
 * (#202), which means a suite that polls changes `gpu_workers.state` on machines
 * it never created -- and `tests/setup/corpus-guard.js` fails a file for exactly
 * that, correctly. The rows are not the suite's to touch.
 *
 * So the sweep is taken **here**, in `globalSetup`, which runs before any file's
 * opening snapshot. Anything the coordinator was going to retire is already
 * retired when the guard looks, and the in-suite sweeps become no-ops rather
 * than changes. The alternative was exempting `gpu_workers.state` from the
 * guard, and that is a blind spot in precisely the column #202 exists to make
 * trustworthy -- a test that flipped a worker's state for the wrong reason would
 * stop being caught.
 *
 * It is idempotent and self-correcting: a machine that is actually alive is
 * brought straight back to `online` by its next poll.
 *
 * Silent on failure. This is housekeeping, and a database that cannot do it --
 * an older schema without the column, say -- must not stop the suite running.
 *
 * @returns {Promise<void>} Resolves once the sweep has been attempted.
 */
async function settleStaleWorkers() {
    let db;

    try {
        db = require('../../model');
        await db.sequelize.query(
            `UPDATE gpu_workers
                SET state = 'offline'
              WHERE state = 'online'
                AND COALESCE(last_seen_at, enrolled_at)
                    < NOW() - (:seconds * INTERVAL '1 second')`,
            { replacements: { seconds: WORKER_OFFLINE_SECONDS } }
        );
    } catch {
        // Deliberately ignored; see above.
    } finally {
        if (db) { await db.sequelize.close().catch(() => {}); }
    }
}

module.exports = globalSetup;
module.exports.assertLocalDatabase = assertLocalDatabase;
module.exports.OVERRIDE = OVERRIDE;
