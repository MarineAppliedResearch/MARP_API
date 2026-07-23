/**
 * Endpoint tests for the session CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Runs against the app exported by app.js via Supertest,
 * in-process, against the real dev Postgres database (see jest.config.js).
 * Sessions can be created standalone here since their project_id/user_id
 * foreign keys are nullable (model/session.model.js), so no parent chain
 * needs to be built.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/session(s).
 * @author Isaac Travers
 * @module tests/sessions
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * session record.
 */
describe('Session lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const lineId = `jest-pilot-line-${Date.now()}`;

  /**
   * session_id of the row created below, used by the update/get/delete
   * steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let sessionId;

  /**
   * Deletes the session record created by this suite, in case the
   * "deletes the session" test below didn't already remove it.
   */
  afterAll(async () => {
    if (sessionId) {
      await request(app).delete(`/api/session/${sessionId}`);
    }
  });

  /**
   * POST /api/session should insert a new sessions row and return it.
   */
  it('creates a session', async () => {
    const res = await request(app)
      .post('/api/session')
      .send({
        session: { dive: 'Dive 1', line: 'Line A', lineId, type: 'ROV' },
      });

    expect(res.status).toBe(200);
    expect(res.body.lineId).toBe(lineId);
    expect(res.body.session_id).toEqual(expect.any(Number));

    sessionId = res.body.session_id;
  });

  /**
   * PUT /api/session should update the session's fields by session_id.
   */
  it('updates the session', async () => {
    const res = await request(app)
      .put('/api/session')
      .send({ session: { session_id: sessionId, type: 'AUV' } });

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/session/:id should return the session, reflecting the
   * update above.
   */
  it('gets the session by id', async () => {
    const res = await request(app).get(`/api/session/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe(sessionId);
    expect(res.body.type).toBe('AUV');
  });

  /**
   * DELETE /api/session/:id should remove the session, leaving no trace
   * in the dev database.
   */
  it('deletes the session', async () => {
    const res = await request(app).delete(`/api/session/${sessionId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/session/${sessionId}`);
    expect(getRes.body).toBeNull();
  });
});
