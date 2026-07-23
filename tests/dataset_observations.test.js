/**
 * Endpoint tests for the dataset_observation CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. dataset_observations require both an existing
 * dataset_id and observation_id (model/dataset_observations.model.js), so
 * this suite builds disposable parent dataset and observation (via
 * session) records and tears them all down afterward, in reverse order.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/dataset_observation(s).
 * @author Isaac Travers
 * @module tests/dataset_observations
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * dataset_observation record.
 */
describe('Dataset observation lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const uniqueTag = `jest-pilot-datasetobs-${Date.now()}`;

  /**
   * id of the disposable parent dataset created in beforeAll.
   *
   * @type {number|undefined}
   */
  let datasetId;

  /**
   * session_id of the disposable parent session created in beforeAll,
   * needed only to create the parent observation.
   *
   * @type {number|undefined}
   */
  let sessionId;

  /**
   * observation_id of the disposable parent observation created in
   * beforeAll.
   *
   * @type {number|undefined}
   */
  let observationId;

  /**
   * id of the dataset_observation created below, used by the update/get/
   * delete steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let datasetObservationId;

  /**
   * Creates the disposable parent dataset, session, and observation the
   * dataset_observation will reference.
   */
  beforeAll(async () => {
    const datasetRes = await request(app)
      .post('/api/dataset')
      .send({ dataset: { name: uniqueTag } });
    datasetId = datasetRes.body.id;

    const sessionRes = await request(app)
      .post('/api/session')
      .send({ session: { dive: 'Dive 1', line: 'Line A', lineId: uniqueTag, type: 'ROV' } });
    sessionId = sessionRes.body.session_id;

    const observationRes = await request(app)
      .post('/api/observation')
      .send({ observation: { session_id: sessionId, comname: 'Jest DatasetObs Parent' } });
    observationId = observationRes.body.observation_id;
  });

  /**
   * Deletes the dataset_observation, observation, session, and dataset
   * created by this suite, in case the "deletes the dataset_observation"
   * test below didn't already remove the join record.
   */
  afterAll(async () => {
    if (datasetObservationId) {
      await request(app).delete(`/api/dataset_observation/${datasetObservationId}`);
    }
    if (observationId) {
      await request(app).delete(`/api/observation/${observationId}`);
    }
    if (sessionId) {
      await request(app).delete(`/api/session/${sessionId}`);
    }
    if (datasetId) {
      await request(app).delete(`/api/dataset/${datasetId}`);
    }
  });

  /**
   * POST /api/dataset_observation should insert a new
   * dataset_observations row and return it.
   */
  it('creates a dataset_observation', async () => {
    const res = await request(app)
      .post('/api/dataset_observation')
      .send({
        dataset_observation: {
          dataset_id: datasetId,
          observation_id: observationId,
          inclusion_type: 'train',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.dataset_id).toBe(datasetId);
    expect(res.body.observation_id).toBe(observationId);
    expect(res.body.id).toEqual(expect.any(Number));

    datasetObservationId = res.body.id;
  });

  /**
   * PUT /api/dataset_observation/:id should update the join record's
   * fields by id.
   */
  it('updates the dataset_observation', async () => {
    const res = await request(app)
      .put(`/api/dataset_observation/${datasetObservationId}`)
      .send({ dataset_observation: { inclusion_type: 'val' } });

    expect(res.status).toBe(200);
    expect(res.body.inclusion_type).toBe('val');
  });

  /**
   * GET /api/dataset_observation/:id should return the join record,
   * reflecting the update above.
   */
  it('gets the dataset_observation by id', async () => {
    const res = await request(app).get(`/api/dataset_observation/${datasetObservationId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(datasetObservationId);
    expect(res.body.inclusion_type).toBe('val');
  });

  /**
   * DELETE /api/dataset_observation/:id should remove the join record,
   * leaving no trace in the dev database.
   */
  it('deletes the dataset_observation', async () => {
    const res = await request(app).delete(`/api/dataset_observation/${datasetObservationId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/dataset_observation/${datasetObservationId}`);
    expect(getRes.body).toBeNull();
  });
});
