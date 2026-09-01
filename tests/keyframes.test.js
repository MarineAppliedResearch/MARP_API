/**
 * Endpoint tests for the keyframe CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Keyframes require an existing observation_id
 * (model/keyframe.model.js), which itself only needs a session to exist
 * predictably (see tests/observations.test.js), so this suite builds a
 * disposable session -> observation -> keyframe chain and tears it all
 * down afterward, in reverse order.
 *
 * This also exercises the previously-broken updateKeyframe repository
 * method (its update logic was commented out and referenced the wrong
 * model), rewritten alongside this test.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/keyframe(s).
 * @author Isaac Travers
 * @module tests/keyframes
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * keyframe record.
 */
describe('Keyframe lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const lineId = `jest-pilot-keyframe-line-${Date.now()}`;

  /**
   * session_id of the disposable parent session created in beforeAll.
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
   * keyframe_id of the row created below, used by the update/get/delete
   * steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let keyframeId;

  /**
   * Creates the disposable parent session and observation the keyframe
   * will reference.
   */
  beforeAll(async () => {
    const sessionRes = await request(app)
      .post('/api/session')
      .send({ session: { dive: 'Dive 1', line: 'Line A', lineId, type: 'ROV' } });
    sessionId = sessionRes.body.session_id;

    const observationRes = await request(app)
      .post('/api/observation')
      .send({ observation: { session_id: sessionId, comname: 'Jest Keyframe Parent' } });
    observationId = observationRes.body.observation_id;
  });

  /**
   * Deletes the keyframe, observation, and session created by this suite,
   * in case the "deletes the keyframe" test below didn't already remove
   * the keyframe.
   */
  afterAll(async () => {
    if (keyframeId) {
      await request(app).delete(`/api/keyframe/${keyframeId}`);
    }
    if (observationId) {
      await request(app).delete(`/api/observation/${observationId}`);
    }
    if (sessionId) {
      await request(app).delete(`/api/session/${sessionId}`);
    }
  });

  /**
   * POST /api/keyframe (bulk) should insert a new keyframes row and
   * return it.
   */
  it('creates a keyframe', async () => {
    const res = await request(app)
      .post('/api/keyframe')
      .send([
        {
          observation_id: observationId,
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          subset: 'train',
          type: 'start',
          comname: 'Jest Test Fish',
          framenum: 1,
        },
      ]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].keyframe_id).toEqual(expect.any(Number));

    keyframeId = res.body[0].keyframe_id;
  });

  /**
   * PUT /api/keyframe/:keyframe_id should update the keyframe's fields by
   * keyframe_id.
   */
  it('updates the keyframe', async () => {
    const res = await request(app)
      .put(`/api/keyframe/${keyframeId}`)
      .send({ keyframe: { framenum: 2 } });

    expect(res.status).toBe(200);
    expect(res.body.framenum).toBe(2);
  });

  /**
   * An update must not be able to move a keyframe onto a different
   * observation, or into a different subset. Those identify what the
   * annotation belongs to; only the box, its kind and its frame may change.
   */
  it('ignores fields an update is not allowed to change', async () => {
    const before = await request(app).get(`/api/keyframe/${keyframeId}`);
    const originalObservationId = before.body.observation_id;
    const originalSubset = before.body.subset;

    const res = await request(app)
      .put(`/api/keyframe/${keyframeId}`)
      .send({
        keyframe: {
          // Allowed, and should take effect.
          x: 42,
          // Not allowed, and should be ignored rather than reassigning the
          // keyframe to some other observation.
          observation_id: originalObservationId + 1,
          subset: 'not-the-original-subset',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.x).toBe(42);
    expect(res.body.observation_id).toBe(originalObservationId);
    expect(res.body.subset).toBe(originalSubset);
  });

  /**
   * An update carrying nothing updatable is not the same as no such
   * keyframe, but both currently answer null. Recorded so the behaviour is
   * deliberate rather than incidental.
   */
  it('returns null when no updatable field is given', async () => {
    const res = await request(app)
      .put(`/api/keyframe/${keyframeId}`)
      .send({ keyframe: { observation_id: 999999 } });

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  /**
   * GET /api/keyframe/:keyframe_id should return the keyframe, reflecting
   * the update above.
   */
  it('gets the keyframe by id', async () => {
    const res = await request(app).get(`/api/keyframe/${keyframeId}`);

    expect(res.status).toBe(200);
    expect(res.body.keyframe_id).toBe(keyframeId);
    expect(res.body.framenum).toBe(2);
    expect(res.body.x).toBe(42);
  });

  /**
   * DELETE /api/keyframe/:keyframe_id should remove the keyframe, leaving
   * no trace in the dev database.
   */
  it('deletes the keyframe', async () => {
    const res = await request(app).delete(`/api/keyframe/${keyframeId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/keyframe/${keyframeId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
