/**
 * Endpoint tests for the ML model CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Runs against the app exported by app.js via Supertest,
 * in-process, against the real dev Postgres database (see jest.config.js).
 * ml_models are standalone here (parent_model_id is nullable), so no parent
 * chain needs to be built.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/model(s).
 * @author Isaac Travers
 * @module tests/ml_models
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for an ML
 * model record.
 */
describe('ML model lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const modelName = `jest-pilot-model-${Date.now()}`;

  /**
   * id of the row created below, used by the update/get/delete steps and
   * cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let modelId;

  /**
   * Deletes the ML model record created by this suite, in case the
   * "deletes the model" test below didn't already remove it.
   */
  afterAll(async () => {
    if (modelId) {
      await global.api.delete(`/api/v2/model/${modelId}`);
    }
  });

  /**
   * POST /api/model should insert a new ml_models row and return it.
   */
  it('creates a model', async () => {
    const res = await global.api
      .post('/api/v2/model')
      .send({ model: { name: modelName, model_type: 'yolov8' } });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(modelName);
    expect(res.body.id).toEqual(expect.any(Number));

    modelId = res.body.id;
  });

  /**
   * PUT /api/model/:id should update the model's fields by id.
   */
  it('updates the model', async () => {
    const res = await global.api
      .put(`/api/v2/model/${modelId}`)
      .send({ model: { status: 'trained' } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('trained');
  });

  /**
   * GET /api/model/:id should return the model, reflecting the update
   * above.
   */
  it('gets the model by id', async () => {
    const res = await global.api.get(`/api/v2/model/${modelId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(modelId);
    expect(res.body.status).toBe('trained');
  });

  /**
   * DELETE /api/model/:id should remove the model, leaving no trace in
   * the dev database.
   */
  it('deletes the model', async () => {
    const res = await global.api.delete(`/api/v2/model/${modelId}`);

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/model/${modelId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
