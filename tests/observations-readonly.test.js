/**
 * Happy-path smoke tests for the observation domain's read-only /
 * complex-query endpoints — the ones that don't have a create counterpart
 * and so don't get CRUD completion or a lifecycle test (per the MARP API
 * test plan). This is the final batch deferred from the Tier 1 read-only
 * pass in tests/readonly-endpoints.test.js.
 *
 * Runs against the app exported by app.js via Supertest, in-process,
 * against the real dev Postgres database (see jest.config.js). No data is
 * created here — each test reuses whatever already exists in the dev
 * database (looked up dynamically from list endpoints) and asserts
 * response shape/type only, never exact content.
 *
 * @fileoverview Happy-path tests for observation complex-query /api endpoints.
 * @author Isaac Travers
 * @module tests/observations-readonly
 */

const request = require('supertest');
const app = require('../app');

/**
 * GET /api/observations should list every observation record.
 */
describe('GET /api/observations', () => {
  it('returns 200 with an array of observation records', async () => {
    const res = await request(app).get('/api/observations');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * Video-based observation queries, exercised with a real video_source
 * pulled from the observations list so the lookups have a realistic
 * chance of matching.
 */
describe('Video-based observation read endpoints', () => {

  /**
   * A real video_source value found on an existing observation, or
   * undefined if none exists in the dev database.
   *
   * @type {string|undefined}
   */
  let videoSource;

  /**
   * A real comname value found on an existing observation, or undefined
   * if none exists.
   *
   * @type {string|undefined}
   */
  let comname;

  /**
   * A real project name found via getVideoSummaries' parent project, or
   * undefined if none exists.
   *
   * @type {string|undefined}
   */
  let projectName;

  /**
   * Looks up a real video_source/comname from the observations list and a
   * real project name from the projects list, for use across this
   * describe block's tests.
   */
  beforeAll(async () => {
    const obsRes = await request(app).get('/api/observations');
    const withVideo = obsRes.body.find((o) => o.video_source);
    videoSource = withVideo ? withVideo.video_source : undefined;
    const withComname = obsRes.body.find((o) => o.comname);
    comname = withComname ? withComname.comname : undefined;

    const projectsRes = await request(app).get('/api/projects');
    projectName = projectsRes.body.length > 0 ? projectsRes.body[0].name : undefined;
  });

  /**
   * GET /api/getObservationsByVideo?videoName=... should return an array,
   * whether or not videoName matches anything.
   */
  it('GET /api/getObservationsByVideo returns 200 with an array', async () => {
    const res = await request(app)
      .get('/api/getObservationsByVideo')
      .query({ videoName: videoSource || 'nonexistent-video' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/getObservationsByVideoAndComnames tolerates no match by
   * resolving to an empty array.
   */
  it('GET /api/getObservationsByVideoAndComnames returns 200 with an array', async () => {
    const res = await request(app)
      .get('/api/getObservationsByVideoAndComnames')
      .query({ videoName: videoSource || 'nonexistent-video', comnameList: comname || 'nonexistent-species' });

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

    const res = await request(app).get(
      `/api/getObservationsByVideoAndProject/${encodeURIComponent(videoSource || 'nonexistent-video')}/${encodeURIComponent(projectName)}`
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/getObservationsWithKeyframesByComnames tolerates no match by
   * resolving to an empty array.
   */
  it('GET /api/getObservationsWithKeyframesByComnames returns 200 with an array', async () => {
    const res = await request(app)
      .get('/api/getObservationsWithKeyframesByComnames')
      .query({ comnameList: comname || 'nonexistent-species' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  /**
   * GET /api/observation/getMaxObservationFromVideo/:video_source
   * tolerates no match by resolving to an empty array.
   */
  it('GET /api/observation/getMaxObservationFromVideo/:video_source returns 200 with an array', async () => {
    const res = await request(app).get(
      `/api/observation/getMaxObservationFromVideo/${encodeURIComponent(videoSource || 'nonexistent-video')}`
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
    const res = await request(app).get('/api/getDistinctComnamesWithKeyframes');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * Project/session-scoped observation read endpoints, exercised with real
 * ids pulled from the projects and sessions lists.
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
    const projectsRes = await request(app).get('/api/projects');
    projectId = projectsRes.body.length > 0 ? projectsRes.body[0].project_id : undefined;

    const sessionsRes = await request(app).get('/api/sessions');
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

    const res = await request(app).get(`/api/getVideoSummaries/${projectId}`);

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

    const res = await request(app).get(`/api/observation/getLastVideoInfo/${sessionId}`);

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/observations/bySessionID/:session_id returns 200 with an
   * array for a real session id.
   */
  it('GET /api/observations/bySessionID/:session_id returns 200 with an array', async () => {
    if (!sessionId) {
      return;
    }

    const res = await request(app).get(`/api/observations/bySessionID/${sessionId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/**
 * Dashboard-style aggregate endpoints, which accept optional date-range
 * query parameters.
 */
describe('Dashboard aggregate read endpoints', () => {

  /**
   * GET /api/dashboardData returns 200 with an object body.
   */
  it('GET /api/dashboardData returns 200', async () => {
    const res = await request(app)
      .get('/api/dashboardData')
      .query({ start: '2020-01-01', end: '2030-01-01' });

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/getProjectTimeByDateAndUser returns 200 with an object body.
   */
  it('GET /api/getProjectTimeByDateAndUser returns 200', async () => {
    const res = await request(app)
      .get('/api/getProjectTimeByDateAndUser')
      .query({ start: '2020-01-01', end: '2030-01-01' });

    expect(res.status).toBe(200);
  });
});
