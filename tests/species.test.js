/**
 * Endpoint tests for the species API.
 *
 * Pilot test for the MARP API test suite: a read-only GET route, so no
 * created data needs to be cleaned up afterward. Runs against the app
 * exported by app.js via Supertest, in-process, against the real dev
 * Postgres database (see jest.config.js) — assertions check response
 * shape/type only, never exact record counts, since dev data changes over
 * time.
 *
 * @fileoverview Endpoint tests for GET /api/species.
 * @author Isaac Travers
 * @module tests/species
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies that GET /api/species responds successfully with the expected
 * response shape.
 */
describe('GET /api/species', () => {

  /**
   * The species controller/service/repository chain resolves to an array
   * (empty on failure or when no rows exist), so a well-formed response is
   * always a 200 with an array body, whatever its contents.
   */
  it('returns 200 with an array of species records', async () => {
    const res = await request(app).get('/api/species');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
