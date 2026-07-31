/**
 * Endpoint tests for the V2 user-management surface (`/api/v2/users/*`).
 *
 * Exercises the admin-gated user CRUD, permission catalog/assignment, and
 * password-change endpoints against the app exported by app.js via
 * Supertest, in process, against the real dev Postgres database (see
 * jest.config.js). There is no endpoint that creates the very first admin
 * (same bootstrap chicken-and-egg reason as production -- see the seed
 * migration), so the admin and non-admin fixture principals used to test
 * both the happy path and the 401/403 paths are seeded directly through the
 * Sequelize models.
 *
 * @fileoverview Endpoint tests for V2 user-management/permission endpoints.
 * @author Isaac Travers
 * @module tests/v2_users
 */

const request = require('supertest');
const argon2 = require('argon2');
const app = require('../app');
const db = require('../model');

/**
 * Seeds one active user with a real Argon2-hashed local credential, and
 * logs in via the real endpoint to obtain an authenticated Supertest agent.
 *
 * @param {string} username - Unique username for the fixture user.
 * @param {string} password - Plaintext password for the fixture user.
 * @returns {Promise<{userId: number, authIdentityId: number, agent: Object}>}
 */
async function createLoggedInFixture(username, password) {
  const user = await db.users.create({ name: username, username, status: 'active' });
  const passwordHash = await argon2.hash(password);
  const identity = await db.auth_identities.create({
    user_id: user.user_id,
    provider: 'local',
    provider_subject: null,
    password_hash: passwordHash,
  });

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/v2/auth/login').send({ username, password });

  if (loginRes.status !== 200) {
    throw new Error(`Fixture login failed for ${username}: ${JSON.stringify(loginRes.body)}`);
  }

  return { userId: user.user_id, authIdentityId: identity.auth_identity_id, agent };
}

/**
 * Verifies the admin-gated V2 user-management endpoints: auth boundaries
 * (401/403), the full create/read/update/permissions/password/soft-delete
 * lifecycle, and that a soft-deleted user is locked out of login.
 */
describe('V2 user management', () => {
  const runId = Date.now();
  const adminUsername = `jest-admin-${runId}`;
  const adminPassword = 'jest-admin-password-123';
  const plainUsername = `jest-plain-${runId}`;
  const plainPassword = 'jest-plain-password-123';

  let adminFixture;
  let plainFixture;

  /** user_id created via POST /api/v2/users during the lifecycle test, cleaned up in afterAll. */
  let createdUserId;

  beforeAll(async () => {
    adminFixture = await createLoggedInFixture(adminUsername, adminPassword);
    plainFixture = await createLoggedInFixture(plainUsername, plainPassword);

    const adminPermission = await db.permissions.findOne({ where: { key: 'admin' } });
    await db.user_permissions.create({
      user_id: adminFixture.userId,
      permission_id: adminPermission.permission_id,
      granted_by_user_id: null,
    });
  });

  afterAll(async () => {
    if (createdUserId) {
      await db.auth_identities.destroy({ where: { user_id: createdUserId } });
      await db.user_permissions.destroy({ where: { user_id: createdUserId } });
      await db.users.destroy({ where: { user_id: createdUserId } });
    }

    for (const fixture of [adminFixture, plainFixture]) {
      await db.user_permissions.destroy({ where: { user_id: fixture.userId } });
      await db.auth_identities.destroy({ where: { user_id: fixture.userId } });
      await db.users.destroy({ where: { user_id: fixture.userId } });
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/v2/users');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an authenticated non-admin request with 403', async () => {
    const res = await plainFixture.agent.get('/api/v2/users');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lists the permission catalog, including admin', async () => {
    const res = await adminFixture.agent.get('/api/v2/users/permissions');

    expect(res.status).toBe(200);
    expect(res.body.some((permission) => permission.key === 'admin')).toBe(true);
  });

  it('creates a user with a local credential and no permissions', async () => {
    const username = `jest-created-${runId}`;

    const res = await adminFixture.agent.post('/api/v2/users').send({
      name: 'Jest Created User',
      username,
      password: 'jest-created-password-123',
    });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe(username);
    expect(res.body.status).toBe('active');
    expect(res.body.permissions).toEqual([]);

    createdUserId = res.body.user_id;
  });

  it('rejects creating a user with a duplicate username with 409', async () => {
    const res = await adminFixture.agent.post('/api/v2/users').send({
      name: 'Duplicate Username Attempt',
      username: plainUsername,
      password: 'irrelevant-password-123',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('lists all users, including the newly created one', async () => {
    const res = await adminFixture.agent.get('/api/v2/users');

    expect(res.status).toBe(200);
    expect(res.body.some((user) => user.user_id === createdUserId)).toBe(true);
  });

  it('gets the created user by id', async () => {
    const res = await adminFixture.agent.get(`/api/v2/users/${createdUserId}`);

    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(createdUserId);
    expect(res.body.permissions).toEqual([]);
  });

  it('returns 404 for an unknown user id', async () => {
    const res = await adminFixture.agent.get('/api/v2/users/99999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('updates the created user\'s name', async () => {
    const res = await adminFixture.agent.put(`/api/v2/users/${createdUserId}`).send({
      name: 'Jest Created User (Updated)',
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Jest Created User (Updated)');
  });

  it('grants the admin permission to the created user', async () => {
    const res = await adminFixture.agent.put(`/api/v2/users/${createdUserId}/permissions`).send({
      permissionKeys: ['admin'],
    });

    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(['admin']);
  });

  it('revokes it again by replacing with an empty set', async () => {
    const res = await adminFixture.agent.put(`/api/v2/users/${createdUserId}/permissions`).send({
      permissionKeys: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual([]);
  });

  it('sets a new password for the created user, and it actually works to log in', async () => {
    const newPassword = 'jest-created-new-password-456';

    const setPasswordRes = await adminFixture.agent
      .put(`/api/v2/users/${createdUserId}/password`)
      .send({ password: newPassword });

    expect(setPasswordRes.status).toBe(204);

    const loginRes = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: `jest-created-${runId}`, password: newPassword });

    expect(loginRes.status).toBe(200);
  });

  it('soft-deletes the created user, preserving the row', async () => {
    const res = await adminFixture.agent.delete(`/api/v2/users/${createdUserId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('deleted');

    const getRes = await adminFixture.agent.get(`/api/v2/users/${createdUserId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe('deleted');
  });

  it('rejects login for the soft-deleted user', async () => {
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: `jest-created-${runId}`, password: 'jest-created-new-password-456' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
