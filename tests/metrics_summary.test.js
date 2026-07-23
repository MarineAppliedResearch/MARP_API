/**
 * Endpoint tests for the metrics_summary CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. metrics_summary requires an existing training_run_id
 * (model/metrics_summary.model.js), which itself requires an existing
 * model_id, so this suite builds a disposable ml_model -> training_run
 * chain and tears it all down afterward, in reverse order.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/metrics_summary.
 * @author Isaac Travers
 * @module tests/metrics_summary
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * metrics_summary record.
 */
describe('Metrics summary lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const modelName = `jest-pilot-metricssummary-model-${Date.now()}`;

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
   * id of the metrics_summary created below, used by the update/get/
   * delete steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let summaryId;

  /**
   * Creates the disposable parent ml_model and training_run the
   * metrics_summary will reference.
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
   * Deletes the metrics_summary, training_run, and model created by this
   * suite, in case the "deletes the metrics_summary" test below didn't
   * already remove the summary.
   */
  afterAll(async () => {
    if (summaryId) {
      await request(app).delete(`/api/metrics_summary/${summaryId}`);
    }
    if (runId) {
      await request(app).delete(`/api/training_run/${runId}`);
    }
    if (modelId) {
      await request(app).delete(`/api/model/${modelId}`);
    }
  });

  /**
   * POST /api/metrics_summary should insert a new metrics_summary row
   * and return it.
   */
  it('creates a metrics_summary', async () => {
    const res = await request(app)
      .post('/api/metrics_summary')
      .send({ metrics_summary: { training_run_id: runId, dataset_split: 'val' } });

    expect(res.status).toBe(200);
    expect(res.body.training_run_id).toBe(runId);
    expect(res.body.id).toEqual(expect.any(Number));

    summaryId = res.body.id;
  });

  /**
   * PUT /api/metrics_summary/:id should update the summary's fields by
   * id.
   */
  it('updates the metrics_summary', async () => {
    const res = await request(app)
      .put(`/api/metrics_summary/${summaryId}`)
      .send({ metrics_summary: { fitness: 0.9 } });

    expect(res.status).toBe(200);
    expect(res.body.fitness).toBe(0.9);
  });

  /**
   * GET /api/metrics_summary/:id should return the summary, reflecting
   * the update above.
   */
  it('gets the metrics_summary by id', async () => {
    const res = await request(app).get(`/api/metrics_summary/${summaryId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(summaryId);
    expect(res.body.fitness).toBe(0.9);
  });

  /**
   * DELETE /api/metrics_summary/:id should remove the summary, leaving
   * no trace in the dev database.
   */
  it('deletes the metrics_summary', async () => {
    const res = await request(app).delete(`/api/metrics_summary/${summaryId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/metrics_summary/${summaryId}`);
    expect(getRes.body).toBeNull();
  });
});
