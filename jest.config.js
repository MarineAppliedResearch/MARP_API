/**
 * Jest configuration for the MARP API test suite.
 *
 * Tests run against the real dev Postgres database via Supertest (see
 * tests/), rather than an isolated test database, so testTimeout is raised
 * above Jest's 5s default to give real DB round-trips room, and `npm test`
 * runs Jest with --runInBand (see package.json) to avoid parallel workers
 * racing on shared dev data.
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
   * Run tests in a plain Node environment (no DOM/browser globals), since
   * the suite only exercises the Express app and its HTTP layer.
   */
  testEnvironment: 'node',

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
    '<rootDir>/tests/setup/console-error-passthrough.js',

    // Gives every suite an authenticated agent as global.api. Every route
    // requires a permission now, so an anonymous call only ever gets 401.
    '<rootDir>/tests/setup/authenticated-agent.js',
  ],
};
