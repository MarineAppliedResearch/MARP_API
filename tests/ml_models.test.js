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
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

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
  let modelRoot;
  const artifactBytes = Buffer.from('model-weights-for-route-test');

  beforeAll(async () => {
    modelRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'marp-model-artifact-'));
    process.env.MODEL_STORAGE_ROOT = modelRoot;
    await fs.mkdir(path.join(modelRoot, 'models'), { recursive: true });
    await fs.writeFile(path.join(modelRoot, 'models', 'test.pt'), artifactBytes);
  });

  /**
   * Deletes the ML model record created by this suite, in case the
   * "deletes the model" test below didn't already remove it.
   */
  afterAll(async () => {
    if (modelId) {
      await global.api.delete(`/api/v2/model/${modelId}`);
    }
    delete process.env.MODEL_STORAGE_ROOT;
    if (modelRoot) await fs.rm(modelRoot, { recursive: true, force: true });
  });

  /**
   * POST /api/model should insert a new ml_models row and return it.
   */
  it('creates a model', async () => {
    const res = await global.api
      .post('/api/v2/model')
      .send({ model: { name: modelName, model_type: 'yolov8', storage_path: 'models/test.pt' } });

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

  it('streams registered model bytes, including byte ranges', async () => {
    const whole = await global.api.get(`/api/v2/model/${modelId}/artifact`).buffer(true);
    expect(whole.status).toBe(200);
    expect(whole.body).toEqual(artifactBytes);

    const range = await global.api
      .get(`/api/v2/model/${modelId}/artifact`)
      .set('Range', 'bytes=0-4')
      .buffer(true);
    expect(range.status).toBe(206);
    expect(range.body).toEqual(artifactBytes.subarray(0, 5));
  });

  it('requires authentication and hides invalid host paths', async () => {
    const anonymous = await request(app).get(`/api/v2/model/${modelId}/artifact`);
    expect(anonymous.status).toBe(401);

    await global.api
      .put(`/api/v2/model/${modelId}`)
      .send({ model: { storage_path: path.resolve(modelRoot, '..', 'outside.pt') } });
    const escaped = await global.api.get(`/api/v2/model/${modelId}/artifact`);
    expect(escaped.status).toBe(404);
    expect(JSON.stringify(escaped.body)).not.toContain(modelRoot);

    await global.api
      .put(`/api/v2/model/${modelId}`)
      .send({ model: { storage_path: 'models/test.pt' } });
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
