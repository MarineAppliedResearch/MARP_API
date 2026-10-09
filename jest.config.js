/**
 * Jest configuration for the MARP API test suite.
 *
 * Tests run against a real PostgreSQL via Supertest (see tests/) rather than
 * against mocks, so testTimeout is raised above Jest's 5s default to give real
 * round-trips room, and `npm test` runs Jest with --runInBand (see
 * package.json) to avoid parallel workers racing each other over one database.
 *
 * **That database is a copy, not a master.** `marp setup` and `marp agent start`
 * build every workspace database by loading the published test corpus, so the
 * one these tests write to is reproducible from a dump -- which is what makes it
 * safe for them to write at all. This file used to say the suite ran against
 * "the real dev Postgres database" as a design choice; it was a description of
 * a workspace that had nowhere else to point, and a test deleting a row nobody
 * could put back was the cost of it.
 *
 * Two guards still stand, and neither is softened by the above.
 * `tests/setup/local-database-guard.js` refuses a DB_HOST that is not this
 * machine, because the development database carries production's name and only
 * the host tells them apart. `tests/setup/corpus-guard.js` fails a file that
 * changed a row it did not create: a copy is cheap to rebuild, but a suite that
 * quietly rewrites rows underneath the next one is still a suite nobody can
 * trust.
 *
 * @fileoverview Jest configuration for MARP API endpoint tests.
 * @author Isaac Travers
 * @module jest.config
 */
module.exports = {
  /**
   * Limits discovery to tests/, which is where this repository's suite lives.
   */
  roots: ['<rootDir>/tests'],

  /**
   * The walkthrough lives under tests/ but belongs to Playwright, not Jest. Without
   * this, Jest collects `tests/walkthrough/run.spec.mjs`, fails to make sense of a
   * Playwright spec, and reports a failing suite that has nothing to do with the API.
   */
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/walkthrough/'],

  /**
   * A plain Node environment (no DOM/browser globals), since the suite only
   * exercises the Express app and its HTTP layer — plus the corpus guard's
   * closing comparison, which has to run after every `afterAll` in the file
   * and so cannot be a hook. See tests/setup/corpus-guard-environment.js.
   */
  testEnvironment: '<rootDir>/tests/setup/corpus-guard-environment.js',

  /**
   * Per-test timeout in milliseconds. Raised from Jest's 5000ms default
   * because tests round-trip to a real Postgres database rather than a
   * mock.
   */
  testTimeout: 10000,

  /**
   * Replaces Jest's default reporter with tests/reporters/summary-reporter.js,
   * which prints a compact pass/fail line per test instead of interleaving
   * the application's own console output (Sequelize SQL logs,
   * `logger.info` calls, etc.) with test results, and writes a timestamped
   * copy of the report to tests/logs/.
   */
  reporters: ['<rootDir>/tests/reporters/summary-reporter.js'],

  /**
   * Suppresses Jest's own immediate printing of each test file's console
   * output (this happens in Jest's test runner itself, before reporters
   * ever run, so removing the default reporter alone doesn't stop it).
   * testResult.console is still populated for reporters even when this is
   * set, so the summary reporter above can still surface a failing test
   * file's console output in its failure section.
   */
  silent: true,

  /**
   * Redirects every require of logger/api.logger.js to a no-op stand-in
   * during tests. The real logger is built on the `pine` library, which
   * writes directly to stdout in a way `silent` above does not catch.
   */
  moduleNameMapper: {
    '.*/logger/api\\.logger$': '<rootDir>/tests/mocks/silent-logger.js',
  },

  /**
   * Runs once per test file, after the test framework is installed.
   * tests/setup/console-error-passthrough.js keeps console.error visible
   * despite `silent: true` above, since that's where a failing route's
   * real root cause (e.g. the underlying DB error behind a 500) actually
   * gets logged.
   */
  setupFilesAfterEnv: [
    // First, deliberately. Jest runs beforeAll hooks in declaration order, and
    // the corpus guard's snapshot has to be taken before authenticated-agent.js
    // creates its fixture user -- before any row the run is allowed to create.
    '<rootDir>/tests/setup/corpus-guard-setup.js',

    '<rootDir>/tests/setup/console-error-passthrough.js',

    // Gives every suite an authenticated agent as global.api. Every route
    // requires a permission now, so an anonymous call only ever gets 401.
    '<rootDir>/tests/setup/authenticated-agent.js',
  ],

  /**
   * Runs once per run, before any suite opens a connection. Refuses a database
   * that is not local: the tests write to whatever DB_* points at, and the
   * development database carries the same name as production, so only the host
   * tells them apart (#142).
   */
  globalSetup: '<rootDir>/tests/setup/local-database-guard.js',
};
