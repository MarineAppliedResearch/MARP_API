/**
 * Endpoint tests for the dataset CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Runs against the app exported by app.js via Supertest,
 * in-process, against the real dev Postgres database (see jest.config.js).
 * Datasets are standalone (no required foreign keys), so no parent chain
 * needs to be built.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/dataset(s).
 * @author Isaac Travers
 * @module tests/datasets
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * dataset record.
 */
describe('Dataset lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const datasetName = `jest-pilot-dataset-${Date.now()}`;

  /**
   * id of the row created below, used by the update/get/delete steps and
   * cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let datasetId;

  /**
   * Deletes the dataset record created by this suite, in case the
   * "deletes the dataset" test below didn't already remove it.
   */
  afterAll(async () => {
    if (datasetId) {
      await request(app).delete(`/api/dataset/${datasetId}`);
    }
  });

  /**
   * POST /api/dataset should insert a new datasets row and return it.
   */
  it('creates a dataset', async () => {
    const res = await request(app)
      .post('/api/dataset')
      .send({ dataset: { name: datasetName } });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(datasetName);
    expect(res.body.id).toEqual(expect.any(Number));

    datasetId = res.body.id;
  });

  /**
   * PUT /api/dataset/:id should update the dataset's fields by id.
   */
  it('updates the dataset', async () => {
    const res = await request(app)
      .put(`/api/dataset/${datasetId}`)
      .send({ dataset: { description: 'updated by jest' } });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('updated by jest');
  });

  /**
   * GET /api/dataset/:id should return the dataset, reflecting the update
   * above.
   */
  it('gets the dataset by id', async () => {
    const res = await request(app).get(`/api/dataset/${datasetId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(datasetId);
    expect(res.body.description).toBe('updated by jest');
  });

  /**
   * DELETE /api/dataset/:id should remove the dataset, leaving no trace
   * in the dev database.
   */
  it('deletes the dataset', async () => {
    const res = await request(app).delete(`/api/dataset/${datasetId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/dataset/${datasetId}`);
    expect(getRes.body).toBeNull();
  });
});
