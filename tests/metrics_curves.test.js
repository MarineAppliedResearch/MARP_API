/**
 * Endpoint tests for the metrics_curve CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. metrics_curves require an existing metrics_summary_id
 * (model/metrics_curves.model.js), which itself requires an existing
 * training_run_id, which requires an existing model_id, so this suite
 * builds a disposable ml_model -> training_run -> metrics_summary chain
 * and tears it all down afterward, in reverse order. This is the deepest
 * foreign-key chain in the MARP API.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/metrics_curve.
 * @author Isaac Travers
 * @module tests/metrics_curves
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * metrics_curve record.
 */
describe('Metrics curve lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const modelName = `jest-pilot-metricscurve-model-${Date.now()}`;

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
   * id of the disposable parent metrics_summary created in beforeAll.
   *
   * @type {number|undefined}
   */
  let summaryId;

  /**
   * id of the metrics_curve created below, used by the update/get/delete
   * steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let curveId;

  /**
   * Creates the disposable parent ml_model, training_run, and
   * metrics_summary the metrics_curve will reference.
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

    const summaryRes = await request(app)
      .post('/api/metrics_summary')
      .send({ metrics_summary: { training_run_id: runId, dataset_split: 'val' } });
    summaryId = summaryRes.body.id;
  });

  /**
   * Deletes the metrics_curve, metrics_summary, training_run, and model
   * created by this suite, in case the "deletes the metrics_curve" test
   * below didn't already remove the curve.
   */
  afterAll(async () => {
    if (curveId) {
      await request(app).delete(`/api/metrics_curve/${curveId}`);
    }
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
   * POST /api/metrics_curve should insert a new metrics_curves row and
   * return it.
   */
  it('creates a metrics_curve', async () => {
    const res = await request(app)
      .post('/api/metrics_curve')
      .send({ metrics_curve: { metrics_summary_id: summaryId, confidence_threshold: 0.5 } });

    expect(res.status).toBe(200);
    expect(res.body.metrics_summary_id).toBe(summaryId);
    expect(res.body.id).toEqual(expect.any(Number));

    curveId = res.body.id;
  });

  /**
   * PUT /api/metrics_curve/:id should update the curve's fields by id.
   */
  it('updates the metrics_curve', async () => {
    const res = await request(app)
      .put(`/api/metrics_curve/${curveId}`)
      .send({ metrics_curve: { precision: 0.75 } });

    expect(res.status).toBe(200);
    expect(res.body.precision).toBe(0.75);
  });

  /**
   * GET /api/metrics_curve/:id should return the curve, reflecting the
   * update above.
   */
  it('gets the metrics_curve by id', async () => {
    const res = await request(app).get(`/api/metrics_curve/${curveId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(curveId);
    expect(res.body.precision).toBe(0.75);
  });

  /**
   * DELETE /api/metrics_curve/:id should remove the curve, leaving no
   * trace in the dev database.
   */
  it('deletes the metrics_curve', async () => {
    const res = await request(app).delete(`/api/metrics_curve/${curveId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/metrics_curve/${curveId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
