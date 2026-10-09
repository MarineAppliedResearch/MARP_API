/**
 * Endpoint tests for the task CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Runs against the app exported by app.js via Supertest,
 * in-process, against the real dev Postgres database (see jest.config.js).
 * Tasks are standalone (no foreign-key dependencies), so no parent chain
 * needs to be built.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/task(s).
 * @author Isaac Travers
 * @module tests/tasks
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a task
 * record.
 */
describe('Task lifecycle', () => {

  /**
   * Unique per test run so repeated runs are easy to distinguish in the
   * dev database while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const taskName = `jest-pilot-task-${Date.now()}`;

  /**
   * id of the row created below, used by the update/get/delete steps and
   * cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let taskId;

  /**
   * Deletes the task record created by this suite, in case the "deletes
   * the task" test below didn't already remove it (e.g. an earlier
   * assertion failed first).
   */
  afterAll(async () => {
    if (taskId) {
      await global.api.delete(`/api/v2/task/${taskId}`);
    }
  });

  /**
   * POST /api/task should insert a new tasks row and return it.
   */
  it('creates a task', async () => {
    const res = await global.api
      .post('/api/v2/task')
      .send({ task: { name: taskName, createdby: 'jest' } });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(taskName);
    expect(res.body.id).toEqual(expect.any(Number));

    taskId = res.body.id;
  });

  /**
   * PUT /api/task should update the task's fields by id.
   */
  it('updates the task', async () => {
    const res = await global.api
      .put('/api/v2/task')
      .send({ task: { id: taskId, description: 'updated by jest' } });

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/task/:id should return the task, reflecting the update above.
   */
  it('gets the task by id', async () => {
    const res = await global.api.get(`/api/v2/task/${taskId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(taskId);
    expect(res.body.description).toBe('updated by jest');
  });

  /**
   * DELETE /api/task/:id should remove the task, leaving no trace in the
   * dev database.
   */
  it('deletes the task', async () => {
    const res = await global.api.delete(`/api/v2/task/${taskId}`);

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/task/${taskId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
