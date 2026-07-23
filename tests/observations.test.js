/**
 * Endpoint tests for the observation CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Also exercises the two GET-wired
 * updateObservationWithCount/updateObservationWithSize endpoints, a known
 * REST-verb bug left as-is (see the plan) rather than re-wired. Runs
 * against the app exported by app.js via Supertest, in-process, against
 * the real dev Postgres database (see jest.config.js). Observations can be
 * created standalone since session_id/project_id/user_id are all nullable
 * (model/observation.model.js), but createObservation's internal logic
 * behaves most predictably with a real session_id, so this suite builds
 * one disposable parent session and tears it down afterward.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/observation(s).
 * @author Isaac Travers
 * @module tests/observations
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for an
 * observation record, plus the count/size update endpoints.
 */
describe('Observation lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const lineId = `jest-pilot-obs-line-${Date.now()}`;

  /**
   * session_id of the disposable parent session created in beforeAll,
   * used as the observation's session_id and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let sessionId;

  /**
   * observation_id of the row created below, used by the update/get/
   * delete steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let observationId;

  /**
   * obsID (the per-session sequential identifier, distinct from
   * observation_id) of the row created below, needed by the count/size
   * update endpoints which match on session_id + obsID rather than the
   * primary key.
   *
   * @type {number|undefined}
   */
  let obsID;

  /**
   * Creates a disposable parent session for the observation to reference.
   */
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/session')
      .send({
        session: { dive: 'Dive 1', line: 'Line A', lineId, type: 'ROV' },
      });
    sessionId = res.body.session_id;
  });

  /**
   * Deletes the observation and parent session created by this suite, in
   * case the "deletes the observation" test below didn't already remove
   * the observation.
   */
  afterAll(async () => {
    if (observationId) {
      await request(app).delete(`/api/observation/${observationId}`);
    }
    if (sessionId) {
      await request(app).delete(`/api/session/${sessionId}`);
    }
  });

  /**
   * POST /api/observation should insert a new observations row (computing
   * observation_id/obsID server-side) and return it.
   */
  it('creates an observation', async () => {
    const res = await request(app)
      .post('/api/observation')
      .send({ observation: { session_id: sessionId, comname: 'Jest Test Fish' } });

    expect(res.status).toBe(200);
    expect(res.body.observation_id).toEqual(expect.any(Number));
    expect(res.body.obsID).toEqual(expect.any(Number));

    observationId = res.body.observation_id;
    obsID = res.body.obsID;
  });

  /**
   * PUT /api/observation should update the observation's fields by
   * observation_id.
   */
  it('updates the observation', async () => {
    const res = await request(app)
      .put('/api/observation')
      .send({ observation: { observation_id: observationId, comname: 'Updated Jest Fish' } });

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/observation/:id should return the observation, reflecting
   * the update above.
   */
  it('gets the observation by id', async () => {
    const res = await request(app).get(`/api/observation/${observationId}`);

    expect(res.status).toBe(200);
    expect(res.body.observation_id).toBe(observationId);
    expect(res.body.comname).toBe('Updated Jest Fish');
  });

  /**
   * GET /api/observation/updateObservationWithCount/:session_id/:observation_id/:count
   * (observation_id here is actually matched against obsID) should update
   * the observation's count field.
   */
  it('updates the observation count via the count endpoint', async () => {
    const res = await request(app).get(
      `/api/observation/updateObservationWithCount/${sessionId}/${obsID}/7`
    );

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/observation/${observationId}`);
    expect(getRes.body.count).toBe(7);
  });

  /**
   * GET /api/observation/updateObservationWithSize/:session_id/:observation_id/:size
   * (observation_id here is actually matched against obsID) should update
   * the observation's coarsesize field.
   */
  it('updates the observation size via the size endpoint', async () => {
    const res = await request(app).get(
      `/api/observation/updateObservationWithSize/${sessionId}/${obsID}/3`
    );

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/observation/${observationId}`);
    expect(getRes.body.coarsesize).toBe(3);
  });

  /**
   * DELETE /api/observation/:id should remove the observation, leaving no
   * trace in the dev database.
   */
  it('deletes the observation', async () => {
    const res = await request(app).delete(`/api/observation/${observationId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/observation/${observationId}`);
    expect(getRes.body).toBeNull();
  });
});
