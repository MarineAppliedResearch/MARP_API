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
};
