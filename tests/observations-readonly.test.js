/**
 * Happy-path smoke tests for the observation domain's read-only /
 * complex-query endpoints — the ones that don't have a create counterpart
 * and so don't get CRUD completion or a lifecycle test (per the MARP API
 * test plan). This is the final batch deferred from the Tier 1 read-only
 * pass in tests/readonly-endpoints.test.js.
 *
 * Runs against the app exported by app.js via Supertest, in-process,
 * against the real dev Postgres database (see jest.config.js). No data is
 * created here.
 *
 * IMPORTANT: GET /api/observations (no pagination) is known to be very
 * slow against the real dev database (~450k rows, 50+ seconds) — the user
 * plans to add pagination later but is deliberately leaving it alone for
 * now. None of these tests call it, even indirectly for sampling real
 * values, to avoid tying up the shared Sequelize connection pool for the
 * rest of the suite. Sample ids/names come from the small projects and
 * sessions tables instead; video/comname-based queries use placeholder
 * values that are safe to query (these endpoints tolerate no match by
 * resolving to an empty array, per repository/observation.repository.js).
 *
 * @fileoverview Happy-path tests for observation complex-query /api endpoints.
 * @author Isaac Travers
 * @module tests/observations-readonly
 */

const request = require('supertest');
const app = require('../app');

/**
 * Video-based observation queries. Exercised with placeholder values
 * rather than real ones sampled from observations (see file header) —
 * these endpoints tolerate no match by resolving to an empty array, so
 * this still verifies each route responds correctly.
 */
describe('Video-based observation read endpoints', () => {

  /**
   * A real project name, looked up from the small projects table, used
   * only by the video+project combined lookup below.
   *
   * @type {string|undefined}
   */
  let projectName;

  /**
   * Looks up a real project name for use in this describe block's tests.
   */
  beforeAll(async () => {
    const projectsRes = await global.api.get('/api/v2/projects');
    projectName = projectsRes.body.length > 0 ? projectsRes.body[0].name : undefined;
  });

  /**
   * GET /api/getObservationsByVideo?videoName=... tolerates no match by
   * resolving to an empty array.
   */
  it('GET /api/getObservationsByVideo returns 200 with an array', async () => {
    const res = await global.api
      .get('/api/v2/getObservationsByVideo')
      .query({ videoName: 'jest-nonexistent-video' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/getObservationsByVideoAndComnames tolerates no match by
   * resolving to an empty array.
   */
  it('GET /api/getObservationsByVideoAndComnames returns 200 with an array', async () => {
    const res = await global.api
      .get('/api/v2/getObservationsByVideoAndComnames')
      .query({ videoName: 'jest-nonexistent-video', comnameList: 'jest-nonexistent-species' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/getObservationsByVideoAndProject/:videoName/:projectName
   * tolerates no match by resolving to an empty array.
   */
  it('GET /api/getObservationsByVideoAndProject/:videoName/:projectName returns 200 with an array', async () => {
    if (!projectName) {
      return;
    }

    const res = await global.api.get(
      `/api/v2/getObservationsByVideoAndProject/jest-nonexistent-video/${encodeURIComponent(projectName)}`
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/getObservationsWithKeyframesByComnames tolerates no match by
   * resolving to an empty array.
   */
  it('GET /api/getObservationsWithKeyframesByComnames returns 200 with an array', async () => {
    const res = await global.api
      .get('/api/v2/getObservationsWithKeyframesByComnames')
      .query({ comnameList: 'jest-nonexistent-species' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/observation/getMaxObservationFromVideo/:video_source
   * tolerates no match by resolving to an empty array.
   */
  it('GET /api/observation/getMaxObservationFromVideo/:video_source returns 200 with an array', async () => {
    const res = await global.api.get(
      '/api/v2/observation/getMaxObservationFromVideo/jest-nonexistent-video'
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * GET /api/getDistinctComnamesWithKeyframes takes no parameters.
 */
describe('GET /api/getDistinctComnamesWithKeyframes', () => {
  it('returns 200 with an array of distinct common names', async () => {
    const res = await global.api.get('/api/v2/getDistinctComnamesWithKeyframes');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * Project/session-scoped observation read endpoints, exercised with real
 * ids pulled from the small projects and sessions tables (not the large
 * observations table — see file header).
 */
describe('Project and session-scoped observation read endpoints', () => {

  /**
   * A real project_id found in the dev database, or undefined if none
   * exists.
   *
   * @type {number|undefined}
   */
  let projectId;

  /**
   * A real session_id found in the dev database, or undefined if none
   * exists.
   *
   * @type {number|undefined}
   */
  let sessionId;

  /**
   * Looks up a real project_id and session_id for use across this
   * describe block's tests.
   */
  beforeAll(async () => {
    const projectsRes = await global.api.get('/api/v2/projects');
    projectId = projectsRes.body.length > 0 ? projectsRes.body[0].project_id : undefined;

    const sessionsRes = await global.api.get('/api/v2/sessions');
    sessionId = sessionsRes.body.length > 0 ? sessionsRes.body[0].session_id : undefined;
  });

  /**
   * GET /api/getVideoSummaries/:project_id returns 200 with an array for
   * a real project id.
   */
  it('GET /api/getVideoSummaries/:project_id returns 200 with an array', async () => {
    if (!projectId) {
      return;
    }

    const res = await global.api.get(`/api/v2/getVideoSummaries/${projectId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/observation/getLastVideoInfo/:session_id returns 200 for a
   * real session id.
   */
  it('GET /api/observation/getLastVideoInfo/:session_id returns 200', async () => {
    if (!sessionId) {
      return;
    }

    const res = await global.api.get(`/api/v2/observation/getLastVideoInfo/${sessionId}`);

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/observations/bySessionID/:session_id returns 200 with an
   * array for a real session id. Scoped to one session, so this stays
   * fast even though the underlying observations table is large.
   */
  it('GET /api/observations/bySessionID/:session_id returns 200 with an array', async () => {
    if (!sessionId) {
      return;
    }

    const res = await global.api.get(`/api/v2/observations/bySessionID/${sessionId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * Dashboard-style aggregate endpoints, which accept optional date-range
 * query parameters. A narrow, far-future range is used so the underlying
 * query matches (near) zero rows and stays fast, rather than a wide range
 * that would scan a meaningful fraction of the large observations table.
 */
describe('Dashboard aggregate read endpoints', () => {

  /**
   * GET /api/dashboardData returns 200 with an object body. Note: per its
   * own @openapi description, this endpoint doesn't actually apply the
   * start/end filter internally, so it always processes the full table —
   * kept in this describe block for grouping, not because the date range
   * narrows its cost.
   */
  it('GET /api/dashboardData returns 200', async () => {
    const res = await global.api
      .get('/api/v2/dashboardData')
      .query({ start: '2099-01-01', end: '2099-01-02' });

    expect(res.status).toBe(200);
  }, 30000);

  /**
   * GET /api/getProjectTimeByDateAndUser returns 200 with an object body.
   */
  it('GET /api/getProjectTimeByDateAndUser returns 200', async () => {
    const res = await global.api
      .get('/api/v2/getProjectTimeByDateAndUser')
      .query({ start: '2099-01-01', end: '2099-01-02' });

    expect(res.status).toBe(200);
  });
});
