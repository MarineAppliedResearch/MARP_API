/**
 * Happy-path smoke tests for read-only / list endpoints that don't have a
 * corresponding create endpoint (per the MARP API test plan, these don't
 * need CRUD completion — just coverage that they respond correctly today).
 *
 * Runs against the app exported by app.js via Supertest, in-process,
 * against the real dev Postgres database (see jest.config.js). No data is
 * created here — each test reuses whatever already exists in the dev
 * database and asserts response shape/type only, never exact content.
 *
 * @fileoverview Happy-path tests for Tier 1 read-only /api endpoints.
 * @author Isaac Travers
 * @module tests/readonly-endpoints
 */

const request = require('supertest');
const app = require('../app');

/**
 * GET /api/tasks should list every task record.
 */
describe('GET /api/tasks', () => {
  it('returns 200 with an array of task records', async () => {
    const res = await global.api.get('/api/v2/tasks');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * GET /api/users and its id-based lookups should list users and resolve a
 * display name for a real user id.
 */
describe('User read endpoints', () => {

  /**
   * Returns 200 with an array of user records.
   */
  it('GET /api/v2/processors returns 200 with an array', async () => {
    const res = await global.api.get('/api/v2/processors');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * The name lookup throws (and the route has no .catch()) when no user matches
   * the id, so this test looks up a real user id from the list endpoint first
   * rather than risking a hang on a made-up id.
   */
  it('GET /api/v2/processors/:userID/name returns the name for a real user', async () => {
    const listRes = await global.api.get('/api/v2/processors');
    if (listRes.body.length === 0) {
      return;
    }

    const realUserId = listRes.body[0].user_id;
    const res = await global.api.get(`/api/v2/processors/${realUserId}/name`);

    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });
});

/**
 * GET /api/projects and its user-scoped lookup should list projects.
 */
describe('Project read endpoints', () => {

  /**
   * Returns 200 with an array of project records.
   */
  it('GET /api/projects returns 200 with an array', async () => {
    const res = await global.api.get('/api/v2/projects');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/projects/user/:userID tolerates a user with no
   * sessions/projects by resolving to an empty array, so a real user id
   * is used here for a more meaningful check without risk of failure.
   */
  it('GET /api/projects/user/:userID returns 200 with an array', async () => {
    const listRes = await global.api.get('/api/v2/processors');
    if (listRes.body.length === 0) {
      return;
    }

    const realUserId = listRes.body[0].user_id;
    const res = await global.api.get(`/api/v2/projects/user/${realUserId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * GET /api/sessions and its user+project-scoped lookup should list
 * sessions.
 */
describe('Session read endpoints', () => {

  /**
   * Returns 200 with an array of session records.
   */
  it('GET /api/sessions returns 200 with an array', async () => {
    const res = await global.api.get('/api/v2/sessions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/sessions/user/:userID/project/:projectID tolerates a
   * combination with no matches by resolving to an empty array, so real
   * ids are used here for a more meaningful check without risk of
   * failure.
   */
  it('GET /api/sessions/user/:userID/project/:projectID returns 200 with an array', async () => {
    const usersRes = await global.api.get('/api/v2/processors');
    const projectsRes = await global.api.get('/api/v2/projects');
    if (usersRes.body.length === 0 || projectsRes.body.length === 0) {
      return;
    }

    const realUserId = usersRes.body[0].user_id;
    const realProjectId = projectsRes.body[0].project_id;
    const res = await global.api.get(
      `/api/v2/sessions/user/${realUserId}/project/${realProjectId}`
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * GET /api/species/by-comname/:comname should resolve a real species'
 * common name to its record.
 */
describe('GET /api/species/by-comname/:comname', () => {
  it('returns 200 with the matching species record for a real comname', async () => {
    const listRes = await global.api.get('/api/v2/species');
    const withComname = listRes.body.find((s) => s.comname);
    if (!withComname) {
      return;
    }

    const res = await global.api.get(
      `/api/v2/species/by-comname/${encodeURIComponent(withComname.comname)}`
    );

    expect(res.status).toBe(200);
    expect(res.body.comname).toBe(withComname.comname);
  });
});

/**
 * GET /api/ml_models should list every ML model record.
 */
describe('GET /api/ml_models', () => {
  it('returns 200 with an array of ML model records', async () => {
    const res = await global.api.get('/api/v2/ml_models');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * GET /api/dataset should list every dataset record.
 */
describe('GET /api/dataset', () => {
  it('returns 200 with an array of dataset records', async () => {
    const res = await global.api.get('/api/v2/dataset');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * GET /api/metaInfo/dbName is a health-check-style endpoint reusing the
 * metaInfo table/model; it's not a CRUD resource, so this is a smoke test
 * only.
 */
describe('GET /api/metaInfo/dbName', () => {
  it('returns 200 with the current database name', async () => {
    const res = await global.api.get('/api/v2/metaInfo/dbName');

    expect(res.status).toBe(200);
  });
});

/**
 * PUT /api/metaInfo/dbName mutates the single shared metaInfo row that the
 * running app treats as real configuration, so this test reads the current
 * value first and restores it afterward rather than leaving a disposable
 * test value in place.
 */
describe('PUT /api/metaInfo/dbName', () => {
  it('updates the database name and restores the original value afterward', async () => {
    const before = await global.api.get('/api/v2/metaInfo/dbName');
    const originalName = before.body[0].name;

    try {
      const putRes = await global.api
        .put('/api/v2/metaInfo/dbName')
        .send({ name: 'Test DB Name' });

      expect(putRes.status).toBe(200);
      expect(putRes.body[0].name).toBe('Test DB Name');

      const after = await global.api.get('/api/v2/metaInfo/dbName');
      expect(after.body[0].name).toBe('Test DB Name');
    } finally {
      await global.api
        .put('/api/v2/metaInfo/dbName')
        .send({ name: originalName });
    }
  });

  it('returns 400 when name is missing from the request body', async () => {
    const res = await global.api.put('/api/v2/metaInfo/dbName').send({});

    expect(res.status).toBe(400);
  });
});
