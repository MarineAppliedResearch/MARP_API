/**
 * Endpoint tests for browsing sessions by project.
 *
 * `GET /api/sessions/project/:projectID` is what lets a reviewer find a
 * session by the dive it belongs to instead of by who processed it (see
 * issue #43). It answers with more than the sessions table holds: the
 * processor comes from a join, and the observation count and video sources
 * are derived from the session's observations, so those need a real chain
 * of records underneath them to be worth testing.
 *
 * Runs against the app exported by app.js via Supertest, in-process,
 * against the real dev Postgres database (see jest.config.js). Everything
 * this suite creates -- a project, a processor, three sessions and three
 * observations -- is torn down in reverse order afterward.
 *
 * @fileoverview Endpoint tests for GET /api/sessions/project/:projectID.
 * @author Isaac Travers
 * @module tests/sessions-by-project
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies that a project's sessions come back ordered, scoped to that
 * project, and carrying the processor, observation count and video
 * sources the session browser lists.
 */
describe('Sessions by project', () => {

  /**
   * Unique per test run, so a suite left half-cleaned by an earlier
   * failure cannot collide with this one in the dev database.
   *
   * @constant
   * @type {number}
   */
  const runId = Date.now();

  /**
   * Ceiling for the fixture chain in beforeAll. Deliberately not enormous:
   * a setup that takes longer than this against the dev database is a
   * problem worth seeing, not one to wait out.
   *
   * @constant
   * @type {number}
   */
  const SETUP_TIMEOUT_MS = 30000;

  /** @constant @type {string} */
  const projectName = `jest-dive-browser-project-${runId}`;

  /** @constant @type {string} */
  const processorName = `jest-dive-browser-processor-${runId}`;

  /**
   * project_id of the disposable project every session below belongs to.
   *
   * @type {number|undefined}
   */
  let projectId;

  /**
   * user_id of the disposable processor, expected back on every session
   * as the joined `user`.
   *
   * @type {number|undefined}
   */
  let userId;

  /**
   * session_ids of the three disposable sessions, keyed by the label used
   * in the assertions below.
   *
   * @type {Object<string, number>}
   */
  const sessionIds = {};

  /**
   * observation_ids created against `dive1LineT1Fish`, cleaned up first
   * since they reference it.
   *
   * @type {Array<number>}
   */
  const observationIds = [];

  /**
   * Builds the project, processor, three sessions and three observations
   * this suite reads back.
   *
   * The sessions are deliberately created out of order -- Dive 002 first
   * -- so that a passing ordering assertion cannot just be insertion
   * order showing through.
   *
   * Given an explicit timeout because this is eight round trips to the dev
   * database before a single assertion runs, which is more than the 10s
   * config-wide default leaves room for.
   */
  beforeAll(async () => {
    const projectRes = await request(app).post(`/api/project/createProjectByName/${projectName}`);
    projectId = projectRes.body.project_id;

    const userRes = await request(app).post(`/api/user/createUserByName/${processorName}`);
    userId = userRes.body.user_id;

    /**
     * Creates one disposable session in the test project and records its id.
     *
     * @param {string} label - Key to store the new session_id under.
     * @param {string} dive - Dive identifier for the session.
     * @param {string} line - Transect line for the session.
     * @param {string} type - Session type.
     * @returns {Promise<void>}
     */
    async function createSession(label, dive, line, type) {
      const res = await request(app)
        .post('/api/session')
        .send({
          session: {
            project_id: projectId,
            user_id: userId,
            dive,
            line,
            lineId: `jest-${label}-${runId}`,
            type,
          },
        });
      sessionIds[label] = res.body.session_id;
    }

    await createSession('dive2LineT2Fish', 'Dive 002', 'Line T2', 'Fish');
    await createSession('dive1LineT1Invert', 'Dive 001', 'Line T1', 'Invert');
    await createSession('dive1LineT1Fish', 'Dive 001', 'Line T1', 'Fish');

    // Two observations on one video and one on another, so the response
    // has to both count them and collapse the duplicate video source.
    // Created one at a time rather than in parallel: createObservation
    // derives obsID from the session's current highest, so concurrent
    // inserts would hand out the same one.
    for (const videoSource of ['jest-video-a.mp4', 'jest-video-a.mp4', 'jest-video-b.mp4']) {
      const res = await request(app)
        .post('/api/observation')
        .send({
          observation: {
            session_id: sessionIds.dive1LineT1Fish,
            project_id: projectId,
            user_id: userId,
            comname: 'Jest Dive Browser Fish',
            video_source: videoSource,
          },
        });
      observationIds.push(res.body.observation_id);
    }
  }, SETUP_TIMEOUT_MS);

  /**
   * Removes everything this suite created, children first, so no foreign
   * key is left dangling in the dev database.
   */
  afterAll(async () => {
    for (const observationId of observationIds) {
      await request(app).delete(`/api/observation/${observationId}`);
    }
    for (const sessionId of Object.values(sessionIds)) {
      await request(app).delete(`/api/session/${sessionId}`);
    }
    if (projectId) {
      await request(app).delete(`/api/project/${projectId}`);
    }
    if (userId) {
      await request(app).delete(`/api/user/${userId}`);
    }
  });

  /**
   * The endpoint should return this project's sessions and nothing else,
   * ordered by dive, then line, then type -- the order a client needs to
   * group them under their dive without sorting first.
   */
  it('returns the project sessions ordered by dive, line, then type', async () => {
    const res = await request(app).get(`/api/sessions/project/${projectId}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((session) => session.session_id)).toEqual([
      sessionIds.dive1LineT1Fish,
      sessionIds.dive1LineT1Invert,
      sessionIds.dive2LineT2Fish,
    ]);
    expect(res.body.every((session) => session.project_id === projectId)).toBe(true);
  });

  /**
   * The processor is the whole point of the endpoint: the browser lists
   * sessions from several processors side by side, so each row has to say
   * who did it without the caller looking the user up separately.
   */
  it('carries the processor on every session', async () => {
    const res = await request(app).get(`/api/sessions/project/${projectId}`);

    expect(res.status).toBe(200);
    for (const session of res.body) {
      expect(session.user).toBeTruthy();
      expect(session.user.user_id).toBe(userId);
      expect(session.user.name).toBe(processorName);
    }
  });

  /**
   * Observation counts are derived, not stored, so a session that was
   * opened but never annotated has to report zero rather than be missing
   * the field.
   */
  it('counts the observations on each session', async () => {
    const res = await request(app).get(`/api/sessions/project/${projectId}`);
    const bySessionId = new Map(res.body.map((session) => [session.session_id, session]));

    expect(bySessionId.get(sessionIds.dive1LineT1Fish).observationCount).toBe(3);
    expect(bySessionId.get(sessionIds.dive1LineT1Invert).observationCount).toBe(0);
    expect(bySessionId.get(sessionIds.dive2LineT2Fish).observationCount).toBe(0);
  });

  /**
   * video_source is a column on observations, not sessions, so it can
   * only be derived. Three observations naming two distinct videos should
   * collapse to those two, sorted; a session with no observations should
   * report an empty list rather than null.
   */
  it('reports the distinct videos a session observations name', async () => {
    const res = await request(app).get(`/api/sessions/project/${projectId}`);
    const bySessionId = new Map(res.body.map((session) => [session.session_id, session]));

    expect(bySessionId.get(sessionIds.dive1LineT1Fish).video_sources)
      .toEqual(['jest-video-a.mp4', 'jest-video-b.mp4']);
    expect(bySessionId.get(sessionIds.dive2LineT2Fish).video_sources).toEqual([]);
  });

  /**
   * A project with no sessions is a normal state, not an error, and the
   * GUI shows it as an empty list.
   */
  it('returns an empty array for a project with no sessions', async () => {
    const emptyProjectRes = await request(app)
      .post(`/api/project/createProjectByName/${projectName}-empty`);
    const emptyProjectId = emptyProjectRes.body.project_id;

    try {
      const res = await request(app).get(`/api/sessions/project/${emptyProjectId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    } finally {
      await request(app).delete(`/api/project/${emptyProjectId}`);
    }
  });
});
