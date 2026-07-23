/**
 * Endpoint tests for the project-by-name creation and lookup API.
 *
 * Pilot write-endpoint test for the MARP API test suite. Runs against the
 * app exported by app.js via Supertest, in-process, against the real dev
 * Postgres database (see jest.config.js) — there is no isolated test
 * database, so this suite is responsible for cleaning up any row it
 * creates.
 *
 * @fileoverview Endpoint tests for POST /api/project/createProjectByName
 * and GET /api/project/getProjectByName.
 * @author Isaac Travers
 * @module tests/project
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies that a project can be created by name and is then retrievable
 * by that same name.
 */
describe('POST /api/project/createProjectByName/:projectName', () => {

  /**
   * Unique per test run so repeated runs never collide with the unique
   * constraint on projects.name (see model/project.model.js).
   *
   * @constant
   * @type {string}
   */
  const projectName = `jest-pilot-project-${Date.now()}`;

  /**
   * project_id of the row created in the "creates a project record" test
   * below, set once that test runs so afterAll can delete it. Left
   * undefined if creation failed, so cleanup is skipped rather than
   * issuing a DELETE for a nonexistent id.
   *
   * @type {number|undefined}
   */
  let createdProjectId;

  /**
   * Deletes the project record created by this suite so the shared dev
   * database isn't left with leftover test data.
   */
  afterAll(async () => {
    if (createdProjectId) {
      await request(app).delete(`/api/project/${createdProjectId}`);
    }
  });

  /**
   * POST /api/project/createProjectByName/:projectName should insert a new
   * projects row with the given name and return it, including the
   * generated project_id.
   */
  it('creates a project record with the given name', async () => {
    const res = await request(app).post(
      `/api/project/createProjectByName/${projectName}`
    );

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(projectName);
    expect(res.body.project_id).toEqual(expect.any(Number));

    createdProjectId = res.body.project_id;
  });

  /**
   * GET /api/project/getProjectByName/:projectName should return the
   * project created above among its results.
   */
  it('is then retrievable by name', async () => {
    const res = await request(app).get(
      `/api/project/getProjectByName/${projectName}`
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((p) => p.name === projectName)).toBe(true);
  });
});
