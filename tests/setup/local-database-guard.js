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
}

module.exports = globalSetup;
module.exports.assertLocalDatabase = assertLocalDatabase;
module.exports.OVERRIDE = OVERRIDE;
