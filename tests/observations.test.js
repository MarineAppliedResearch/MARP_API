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
    const res = await global.api
      .post('/api/v2/session')
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
      await global.api.delete(`/api/v2/observation/${observationId}`);
    }
    if (sessionId) {
      await global.api.delete(`/api/v2/session/${sessionId}`);
    }
  });

  /**
   * POST /api/observation should insert a new observations row (computing
   * observation_id/obsID server-side) and return it.
   */
  it('creates an observation', async () => {
    const res = await global.api
      .post('/api/v2/observation')
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
    const res = await global.api
      .put('/api/v2/observation')
      .send({ observation: { observation_id: observationId, comname: 'Updated Jest Fish' } });

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/observation/:id should return the observation, reflecting
   * the update above.
   */
  it('gets the observation by id', async () => {
    const res = await global.api.get(`/api/v2/observation/${observationId}`);

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
    const res = await global.api.get(
      `/api/v2/observation/updateObservationWithCount/${sessionId}/${obsID}/7`
    );

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/observation/${observationId}`);
    expect(getRes.body.count).toBe(7);
  });

  /**
   * GET /api/observation/updateObservationWithSize/:session_id/:observation_id/:size
   * (observation_id here is actually matched against obsID) should update
   * the observation's coarsesize field.
   */
  it('updates the observation size via the size endpoint', async () => {
    const res = await global.api.get(
      `/api/v2/observation/updateObservationWithSize/${sessionId}/${obsID}/3`
    );

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/observation/${observationId}`);
    expect(getRes.body.coarsesize).toBe(3);
  });

  /**
   * DELETE /api/observation/:id should remove the observation, leaving no
   * trace in the dev database.
   */
  it('deletes the observation', async () => {
    const res = await global.api.delete(`/api/v2/observation/${observationId}`);

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/observation/${observationId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});

/**
 * The database assigns `observation_id`, and its sequence stays correct (#62).
 *
 * The repository used to read `max(observation_id)` and add one. That is a read
 * and a write with no lock between them -- two overlapping creates computed the
 * same maximum and the second collided -- and it meant the column's own sequence
 * was never consulted, so it drifted further behind the table for ever. It reached
 * **10,478 behind**, which broke 141 of 274 mosaic tests and every test in the
 * dataset cascade suite, both of which insert with the column default.
 *
 * At the HTTP tier because that is the path the annotation GUI actually takes, and
 * the defect was in what the repository sent rather than in what the model declared
 * -- the model has carried `autoIncrement` all along.
 */
describe('Who assigns an observation id (#62)', () => {
    const { QueryTypes } = require('sequelize');
    const db = require('../model');

    let sessionId;
    const created = [];

    beforeAll(async () => {
        const session = await global.api
            .post('/api/v2/session')
            .send({ session: { dive: 'jest-62', line: '62', lineId: '62', type: 'Invert' } });

        sessionId = session.body.session_id || session.body.id;
    });

    afterAll(async () => {
        if (created.length > 0) {
            await db.sequelize.query(
                'DELETE FROM keyframes WHERE observation_id IN (:ids)',
                { replacements: { ids: created } }
            );
            await db.sequelize.query(
                'DELETE FROM observations WHERE observation_id IN (:ids)',
                { replacements: { ids: created } }
            );
        }

        if (sessionId) {
            await global.api.delete(`/api/v2/session/${sessionId}`);
        }
    });

    /**
     * The tripwire. Before the fix the sequence stood still while the table grew,
     * so the gap widened by one on every create; now it moves with the row.
     */
    it('takes the id from the sequence, so the two stay together', async () => {
        const [before] = await db.sequelize.query(
            'SELECT last_value FROM observations_observation_id_seq',
            { type: QueryTypes.SELECT }
        );

        const res = await global.api
            .post('/api/v2/observation')
            .send({ observation: { session_id: sessionId, comname: 'Jest 62 Subject' } });

        expect(res.status).toBe(200);
        created.push(res.body.observation_id);

        const [after] = await db.sequelize.query(
            'SELECT last_value FROM observations_observation_id_seq',
            { type: QueryTypes.SELECT }
        );

        // The row got the number the sequence just handed out.
        expect(Number(after.last_value)).toBeGreaterThan(Number(before.last_value));
        expect(res.body.observation_id).toBe(Number(after.last_value));
    });

    /**
     * And the sequence is never behind the table, which is the state that broke
     * everything inserting with the column default.
     */
    it('leaves the sequence at or ahead of the table maximum', async () => {
        const [row] = await db.sequelize.query(
            `SELECT (SELECT max(observation_id) FROM observations) AS max_id,
                    (SELECT last_value FROM observations_observation_id_seq) AS seq`,
            { type: QueryTypes.SELECT }
        );

        expect(Number(row.seq)).toBeGreaterThanOrEqual(Number(row.max_id));
    });

    /**
     * A caller supplying an id is ignored rather than trusted. The GUI has never
     * sent one, but an endpoint that did would reintroduce the whole defect.
     */
    it('ignores an observation_id the caller supplies', async () => {
        const res = await global.api
            .post('/api/v2/observation')
            .send({
                observation: {
                    observation_id: 999000062,
                    session_id: sessionId,
                    comname: 'Jest 62 Imposter',
                },
            });

        expect(res.status).toBe(200);
        created.push(res.body.observation_id);
        expect(res.body.observation_id).not.toBe(999000062);
    });

    /**
     * Two creates at once. Under `max(observation_id) + 1` both computed the same
     * maximum and the second collided; a sequence hands out two distinct numbers.
     */
    it('gives two simultaneous creates different ids', async () => {
        const body = (name) => ({ observation: { session_id: sessionId, comname: name } });

        const [one, two] = await Promise.all([
            global.api.post('/api/v2/observation').send(body('Jest 62 Race A')),
            global.api.post('/api/v2/observation').send(body('Jest 62 Race B')),
        ]);

        expect(one.status).toBe(200);
        expect(two.status).toBe(200);

        created.push(one.body.observation_id, two.body.observation_id);
        expect(one.body.observation_id).not.toBe(two.body.observation_id);
    });
});
