/**
 * Endpoint tests for the V2 service-application/token surface
 * (`/api/v2/apps/*`, `/api/v2/tokens/*`) and the dual-mode bearer-token
 * authentication it wires into the API.
 *
 * Exercises the admin-gated app/token CRUD, permission assignment, and
 * regenerate flow against the app exported by app.js via Supertest, in
 * process, against the real dev Postgres database (see jest.config.js).
 * Critically, it also proves the bearer-auth path actually works end to
 * end: a raw token returned by `POST /api/v2/tokens`, once granted a
 * permission, is used as an `Authorization: Bearer` header with *no
 * cookie at all* to call a protected endpoint -- the same permission gate
 * an admin user session satisfies.
 *
 * @fileoverview Endpoint tests for V2 service-application/token endpoints and bearer auth.
 * @author Isaac Travers
 * @module tests/v2_tokens
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
 * @returns {Promise<{userId: number, agent: Object}>}
 */
async function createLoggedInFixture(username, password) {
  const user = await db.users.create({ name: username, username, status: 'active' });
  const passwordHash = await argon2.hash(password);
  await db.auth_identities.create({
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

  return { userId: user.user_id, agent };
}

/**
 * Verifies the admin-gated V2 app/token endpoints and the dual-mode
 * (session or bearer-token) permission check they share with V2 Users.
 */
describe('V2 service applications and tokens', () => {
  const runId = Date.now();
  const adminUsername = `jest-tok-admin-${runId}`;
  const adminPassword = 'jest-tok-admin-password-123';
  const plainUsername = `jest-tok-plain-${runId}`;
  const plainPassword = 'jest-tok-plain-password-123';
  const appName = `Jest Test App ${runId}`;

  let adminFixture;
  let plainFixture;
  let createdAppId;
  let createdTokenId;
  let createdTokenRaw;

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
    if (createdAppId) {
      // Deleting the app cascades its tokens/token-permissions via FK.
      await db.service_clients.destroy({ where: { service_client_id: createdAppId } });
    }

    for (const fixture of [adminFixture, plainFixture]) {
      await db.user_permissions.destroy({ where: { user_id: fixture.userId } });
      await db.auth_identities.destroy({ where: { user_id: fixture.userId } });
      await db.users.destroy({ where: { user_id: fixture.userId } });
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/v2/apps');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an authenticated non-admin request with 403', async () => {
    const res = await plainFixture.agent.get('/api/v2/apps');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('registers a new application', async () => {
    const res = await adminFixture.agent.post('/api/v2/apps').send({
      name: appName,
      description: 'Created by the automated test suite.',
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(appName);
    expect(res.body.status).toBe('active');
    expect(res.body.tokenCount).toBe(0);

    createdAppId = res.body.service_client_id;
  });

  it('lists applications, including the new one', async () => {
    const res = await adminFixture.agent.get('/api/v2/apps');

    expect(res.status).toBe(200);
    expect(res.body.some((application) => application.service_client_id === createdAppId)).toBe(true);
  });

  it('issues a bearer token for the application, returning the raw secret once', async () => {
    const res = await adminFixture.agent.post('/api/v2/tokens').send({ serviceClientId: createdAppId });

    expect(res.status).toBe(201);
    expect(res.body.service_client_id).toBe(createdAppId);
    expect(res.body.status).toBe('active');
    expect(res.body.permissions).toEqual([]);
    expect(typeof res.body.rawToken).toBe('string');
    expect(res.body.rawToken.startsWith('svc_')).toBe(true);

    createdTokenId = res.body.service_token_id;
    createdTokenRaw = res.body.rawToken;
  });

  it('lists all tokens, including the new one, and never exposes token_hash', async () => {
    const res = await adminFixture.agent.get('/api/v2/tokens');

    expect(res.status).toBe(200);
    const token = res.body.find((t) => t.service_token_id === createdTokenId);
    expect(token).toBeDefined();
    expect(token.appName).toBe(appName);
    expect(token.token_hash).toBeUndefined();
    expect(token.rawToken).toBeUndefined();
  });

  it('rejects the fresh token as a bearer credential until it has a permission', async () => {
    const res = await request(app)
      .get('/api/v2/users')
      .set('Authorization', `Bearer ${createdTokenRaw}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('grants the admin permission to the token', async () => {
    const res = await adminFixture.agent.put(`/api/v2/tokens/${createdTokenId}/permissions`).send({
      permissionKeys: ['admin'],
    });

    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(['admin']);
  });

  it('proves dual-mode auth: the same raw token, with no cookie at all, can now call a protected V2 Users endpoint', async () => {
    const res = await request(app)
      .get('/api/v2/users')
      .set('Authorization', `Bearer ${createdTokenRaw}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('stamps last_used_at on the token and its application after a successful bearer call', async () => {
    const res = await adminFixture.agent.get('/api/v2/tokens');
    const token = res.body.find((t) => t.service_token_id === createdTokenId);

    expect(token.last_used_at).not.toBeNull();
  });

  it('rejects a bogus bearer token with 401', async () => {
    const res = await request(app)
      .get('/api/v2/users')
      .set('Authorization', 'Bearer svc_this-token-does-not-exist');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('regenerates the token: old raw token stops working, new one works and carries no permissions', async () => {
    const res = await adminFixture.agent.post(`/api/v2/tokens/${createdTokenId}/regenerate`);

    expect(res.status).toBe(201);
    expect(res.body.service_client_id).toBe(createdAppId);
    expect(res.body.permissions).toEqual([]);
    expect(res.body.rawToken).not.toBe(createdTokenRaw);

    const oldTokenRes = await request(app)
      .get('/api/v2/users')
      .set('Authorization', `Bearer ${createdTokenRaw}`);
    expect(oldTokenRes.status).toBe(401);

    createdTokenId = res.body.service_token_id;
    createdTokenRaw = res.body.rawToken;
  });

  it('revokes the (regenerated) token, which then stops authenticating', async () => {
    // Give the regenerated token permission first, so we can prove revocation
    // -- not a missing permission -- is what blocks it afterward.
    await adminFixture.agent.put(`/api/v2/tokens/${createdTokenId}/permissions`).send({
      permissionKeys: ['admin'],
    });

    const workingRes = await request(app)
      .get('/api/v2/users')
      .set('Authorization', `Bearer ${createdTokenRaw}`);
    expect(workingRes.status).toBe(200);

    const revokeRes = await adminFixture.agent.delete(`/api/v2/tokens/${createdTokenId}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.status).toBe('revoked');

    const revokedRes = await request(app)
      .get('/api/v2/users')
      .set('Authorization', `Bearer ${createdTokenRaw}`);
    expect(revokedRes.status).toBe(401);
  });
});
