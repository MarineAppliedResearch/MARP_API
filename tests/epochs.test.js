/**
 * Endpoint tests for the epoch CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Epochs require an existing training_run_id
 * (model/epochs.model.js), which itself requires an existing model_id, so
 * this suite builds a disposable ml_model -> training_run chain and tears
 * it all down afterward, in reverse order.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/epoch(s).
 * @author Isaac Travers
 * @module tests/epochs
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for an
 * epoch record.
 */
describe('Epoch lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const modelName = `jest-pilot-epoch-model-${Date.now()}`;

  /**
   * id of the disposable parent ml_model created in beforeAll.
   *
   * @type {number|undefined}
   */
  let modelId;

  /**
   * id of the disposable parent training_run created in beforeAll.
   *
   * @type {number|undefined}
   */
  let runId;

  /**
   * id of the epoch created below, used by the update/get/delete steps
   * and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let epochId;

  /**
   * Creates the disposable parent ml_model and training_run the epoch
   * will reference.
   */
  beforeAll(async () => {
    const modelRes = await request(app)
      .post('/api/model')
      .send({ model: { name: modelName, model_type: 'yolov8' } });
    modelId = modelRes.body.id;

    const runRes = await request(app)
      .post('/api/training_run')
      .send({ training_run: { model_id: modelId } });
    runId = runRes.body.id;
  });

  /**
   * Deletes the epoch, training_run, and model created by this suite, in
   * case the "deletes the epoch" test below didn't already remove the
   * epoch.
   */
  afterAll(async () => {
    if (epochId) {
      await request(app).delete(`/api/epoch/${epochId}`);
    }
    if (runId) {
      await request(app).delete(`/api/training_run/${runId}`);
    }
    if (modelId) {
      await request(app).delete(`/api/model/${modelId}`);
    }
  });

  /**
   * POST /api/epoch should insert a new epochs row and return it.
   */
  it('creates an epoch', async () => {
    const res = await request(app)
      .post('/api/epoch')
      .send({ epoch: { training_run_id: runId, epoch_number: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.training_run_id).toBe(runId);
    expect(res.body.id).toEqual(expect.any(Number));

    epochId = res.body.id;
  });

  /**
   * PUT /api/epoch/:id should update the epoch's fields by id.
   */
  it('updates the epoch', async () => {
    const res = await request(app)
      .put(`/api/epoch/${epochId}`)
      .send({ epoch: { box_loss: 0.5 } });

    expect(res.status).toBe(200);
    expect(res.body.box_loss).toBe(0.5);
  });

  /**
   * GET /api/epoch/:id should return the epoch, reflecting the update
   * above.
   */
  it('gets the epoch by id', async () => {
    const res = await request(app).get(`/api/epoch/${epochId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(epochId);
    expect(res.body.box_loss).toBe(0.5);
  });

  /**
   * DELETE /api/epoch/:id should remove the epoch, leaving no trace in
   * the dev database.
   */
  it('deletes the epoch', async () => {
    const res = await request(app).delete(`/api/epoch/${epochId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/epoch/${epochId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
