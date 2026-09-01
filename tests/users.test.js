/**
 * Endpoint tests for the user CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. Runs against the app exported by app.js via Supertest,
 * in-process, against the real dev Postgres database (see jest.config.js).
 * Users are standalone (no foreign-key dependencies), so no parent chain
 * needs to be built.
 *
 * This also exercises the PUT /api/user and DELETE /api/user/:id routes,
 * which were previously broken by a method-name typo in
 * service/user.service.js (fixed alongside this test).
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/user(s).
 * @author Isaac Travers
 * @module tests/users
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a user
 * record.
 */
describe('User lifecycle', () => {

  /**
   * Unique per test run so it doesn't collide with the unique constraint
   * on users.name (see model/user.model.js).
   *
   * @constant
   * @type {string}
   */
  const userName = `jest-pilot-user-${Date.now()}`;

  /**
   * user_id of the row created below, used by the update/get/delete steps
   * and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let userId;

  /**
   * Deletes the user record created by this suite, in case the "deletes
   * the user" test below didn't already remove it.
   */
  afterAll(async () => {
    if (userId) {
      await global.api.delete(`/api/v2/processors/${userId}`);
    }
  });

  /**
   * POST /api/user/createUserByName/:userName should insert a new users
   * row and return it.
   */
  it('creates a user', async () => {
    const res = await global.api.post(
      `/api/v2/processors/by-name/${userName}`
    );

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(userName);
    expect(res.body.user_id).toEqual(expect.any(Number));

    userId = res.body.user_id;
  });

  /**
   * PUT /api/user should update the user's fields by user_id, now that
   * the updateUser -> updateUsers typo is fixed.
   */
  it('updates the user', async () => {
    const updatedName = `${userName}-updated`;
    const res = await global.api
      .put('/api/v2/processors')
      .send({ user: { user_id: userId, name: updatedName } });

    expect(res.status).toBe(200);
  });

  /**
   * GET /api/users/:id should return the user, reflecting the update
   * above.
   */
  it('gets the user by id', async () => {
    const res = await global.api.get(`/api/v2/processors/${userId}`);

    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(userId);
    expect(res.body.name).toBe(`${userName}-updated`);
  });

  /**
   * DELETE /api/user/:id should remove the user, now that the
   * deleteUser -> deleteUsers typo is fixed.
   */
  it('deletes the user', async () => {
    const res = await global.api.delete(`/api/v2/processors/${userId}`);

    expect(res.status).toBe(200);

    const getRes = await global.api.get(`/api/v2/processors/${userId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
