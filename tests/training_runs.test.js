/**
 * Endpoint tests for the training run CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Training runs require an existing model_id
 * (model/training_runs.model.js), so this suite builds a disposable
 * parent ml_model and tears it down afterward.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/training_run(s).
 * @author Isaac Travers
 * @module tests/training_runs
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * training run record.
 */
describe('Training run lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const modelName = `jest-pilot-trainingrun-model-${Date.now()}`;

  /**
   * id of the disposable parent ml_model created in beforeAll.
   *
   * @type {number|undefined}
   */
  let modelId;

  /**
   * id of the training run created below, used by the update/get/delete
   * steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let runId;

  /**
   * Creates the disposable parent ml_model the training run will
   * reference.
   */
  beforeAll(async () => {
    const res = await global.api
      .post('/api/v2/model')
      .send({ model: { name: modelName, model_type: 'yolov8' } });
    modelId = res.body.id;
  });

  /**
   * Deletes the training run and parent model created by this suite, in
   * case the "deletes the training run" test below didn't already remove
   * the run.
   */
  afterAll(async () => {
    if (runId) {
      await global.api.delete(`/api/v2/training_run/${runId}`);
    }
    if (modelId) {
      await global.api.delete(`/api/v2/model/${modelId}`);
    }
  });

  /**
   * POST /api/training_run should insert a new training_runs row and
   * return it.
   */
  it('creates a training run', async () => {
    const res = await global.api
      .post('/api/v2/training_run')
      .send({ training_run: { model_id: modelId, notes: 'created by jest' } });

    expect(res.status).toBe(200);
    expect(res.body.model_id).toBe(modelId);
    expect(res.body.id).toEqual(expect.any(Number));

    runId = res.body.id;
  });

  /**
   * PUT /api/training_run/:id should update the run's fields by id.
   */
  it('updates the training run', async () => {
    const res = await global.api
      .put(`/api/v2/training_run/${runId}`)
      .send({ training_run: { notes: 'updated by jest' } });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('updated by jest');
  });

  /**
   * GET /api/training_run/:id should return the run, reflecting the
   * update above.
   */
  it('gets the training run by id', async () => {
    const res = await global.api.get(`/api/v2/training_run/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(runId);
    expect(res.body.notes).toBe('updated by jest');
  });

  /**
   * DELETE /api/training_run/:id should remove the training run, leaving
   * no trace in the dev database.
   */
  it('deletes the training run', async () => {
    const res = await global.api.delete(`/api/v2/training_run/${runId}`);

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/training_run/${runId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
