/**
 * Endpoint tests for the species API.
 *
 * Covers the read-only GET /api/species list route plus the full
 * create -> update -> get -> delete lifecycle for the species CRUD routes.
 * Runs against the app exported by app.js via Supertest, in-process,
 * against the real dev Postgres database (see jest.config.js). Species are
 * standalone (no required foreign keys), so no parent chain needs to be
 * built.
 *
 * @fileoverview Endpoint tests for GET/POST/PUT/DELETE /api/species.
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

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * species record.
 */
describe('Species lifecycle', () => {

  /**
   * Unique per test run, kept within Postgres INTEGER range, to satisfy
   * the unique constraint on species.taxserial (see
   * model/species.model.js).
   *
   * @constant
   * @type {number}
   */
  const taxserial = Date.now() % 2000000000;

  /**
   * id of the row created below, used by the update/get/delete steps and
   * cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let speciesId;

  /**
   * Deletes the species record created by this suite, in case the
   * "deletes the species" test below didn't already remove it.
   */
  afterAll(async () => {
    if (speciesId) {
      await request(app).delete(`/api/species/${speciesId}`);
    }
  });

  /**
   * POST /api/species should insert a new species row and return it.
   */
  it('creates a species record', async () => {
    const res = await request(app)
      .post('/api/species')
      .send({ species: { taxserial, comname: 'Jest Test Species' } });

    expect(res.status).toBe(200);
    expect(res.body.taxserial).toBe(taxserial);
    expect(res.body.id).toEqual(expect.any(Number));

    speciesId = res.body.id;
  });

  /**
   * PUT /api/species/:id should update the species' fields by id.
   */
  it('updates the species', async () => {
    const res = await request(app)
      .put(`/api/species/${speciesId}`)
      .send({ species: { comname: 'Updated Jest Species' } });

    expect(res.status).toBe(200);
    expect(res.body.comname).toBe('Updated Jest Species');
  });

  /**
   * GET /api/species/:id should return the species, reflecting the update
   * above.
   */
  it('gets the species by id', async () => {
    const res = await request(app).get(`/api/species/${speciesId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(speciesId);
    expect(res.body.comname).toBe('Updated Jest Species');
  });

  /**
   * DELETE /api/species/:id should remove the species, leaving no trace
   * in the dev database.
   */
  it('deletes the species', async () => {
    const res = await request(app).delete(`/api/species/${speciesId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/species/${speciesId}`);
    expect(getRes.body).toBeNull();
  });
});
