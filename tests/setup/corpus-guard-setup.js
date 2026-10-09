/**
 * Arms the corpus guard for one test file.
 *
 * Two halves, and they are registered differently for a reason that cost an
 * afternoon to find:
 *
 * - **The opening snapshot is a `beforeAll`, and this file must be the *first*
 *   entry in `setupFilesAfterEnv`.** Jest runs `beforeAll` hooks in
 *   declaration order, so first here means before `authenticated-agent.js`
 *   creates its fixture user -- the snapshot has to predate every row the run
 *   is allowed to create.
 * - **The closing comparison is not a hook at all.** `afterAll` also runs in
 *   declaration order, and a setup file's hooks are registered before the test
 *   file's own, so an `afterAll` here would run *before* a suite's own cleanup
 *   and report every tidy suite as having left rows behind. Instead the closer
 *   is left on the sandbox global and called by
 *   `tests/setup/corpus-guard-environment.js` on jest-circus's `run_finish`,
 *   which fires once the file's tests and every `afterAll` in it are done.
 *
 * @fileoverview Registers the corpus guard's snapshot and hands the environment its closer.
 * @author Isaac Travers
 * @module tests/setup/corpus-guard-setup
 */

'use strict';

const guard = require('./corpus-guard');

/**
 * Ceiling for the opening snapshot. It is the first thing in the file to touch
 * the database, so it pays for opening the connection as well as for the
 * digest itself.
 *
 * @constant
 * @type {number}
 */
const SNAPSHOT_TIMEOUT_MS = 60000;

beforeAll(async () => {
    await guard.open();
}, SNAPSHOT_TIMEOUT_MS);

// Picked up by CorpusGuardEnvironment. It runs inside this sandbox, so it uses
// the suite's own Sequelize connection rather than opening another one.
global.__corpusGuardClose = async () => {
    const testPath = (expect.getState && expect.getState().testPath) || 'this test file';

    await guard.close(testPath);
};
