/**
 * Endpoint tests for local username/password authentication.
 *
 * Exercises POST /api/v2/auth/login, POST /api/v2/auth/logout, and
 * GET /api/v2/auth/me against the app exported by app.js via Supertest, in
 * process, against the real dev Postgres database (see jest.config.js).
 *
 * There is no API endpoint yet for creating local credentials (that's a
 * later phase -- see the "Deferred" section of
 * docs/auth-phase1-migration-spec.md), so the fixture user and
 * auth_identities row are seeded directly through the Sequelize models
 * instead of through an HTTP request, and cleaned up the same way.
 *
 * @fileoverview Endpoint tests for local login/logout/session endpoints.
 * @author Isaac Travers
 * @module tests/auth
 */

const request = require('supertest');
const argon2 = require('argon2');
const app = require('../app');
const db = require('../model');

/**
 * Verifies login success/failure, session-based /me, and logout behavior
 * for local username/password authentication.
 */
describe('Local authentication', () => {

  /**
   * Unique per test run so it doesn't collide with the unique constraints
   * on users.name/users.username (see model/user.model.js).
   *
   * @constant
   * @type {string}
   */
  const username = `jest-auth-user-${Date.now()}`;

  /**
   * Plaintext password for the fixture identity, verified against the
   * Argon2 hash created in beforeAll.
   *
   * @constant
   * @type {string}
   */
  const password = 'correct horse battery staple';

  /**
   * user_id of the fixture row created below, used by every test and
   * cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let userId;

  /**
   * auth_identity_id of the fixture local credential row, cleaned up in
   * afterAll.
   *
   * @type {number|undefined}
   */
  let authIdentityId;

  /**
   * Seeds one active user and one local auth_identities row with a real
   * Argon2 hash, so login can be exercised against real verification logic
   * rather than a stub.
   */
  beforeAll(async () => {
    const user = await db.users.create({
      name: username,
      username,
      status: 'active',
    });
    userId = user.user_id;

    const passwordHash = await argon2.hash(password);
    const identity = await db.auth_identities.create({
      user_id: userId,
      provider: 'local',
      provider_subject: null,
      password_hash: passwordHash,
    });
    authIdentityId = identity.auth_identity_id;
  });

  /**
   * Removes the fixture auth_identities row and user record.
   */
  afterAll(async () => {
    if (authIdentityId) {
      await db.auth_identities.destroy({ where: { auth_identity_id: authIdentityId } });
    }

    if (userId) {
      await db.users.destroy({ where: { user_id: userId } });
    }
  });

  /**
   * POST /api/v2/auth/login should reject a username with no matching
   * local identity, without revealing that the username itself is unknown.
   */
  it('rejects login with an unknown username', async () => {
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({ username: `${username}-does-not-exist`, password });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.status).toBe(401);
    expect(typeof res.body.error.requestId).toBe('string');
  });

  /**
   * POST /api/v2/auth/login should reject a known username with the wrong
   * password.
   */
  it('rejects login with the wrong password', async () => {
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({ username, password: 'this-is-not-the-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.status).toBe(401);
    expect(typeof res.body.error.requestId).toBe('string');
  });

  /**
   * GET /api/v2/auth/me should reject a request with no session cookie.
   */
  it('rejects /me without an active session', async () => {
    const res = await request(app).get('/api/v2/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.status).toBe(401);
    expect(typeof res.body.error.requestId).toBe('string');
  });

  /**
   * POST /api/v2/auth/logout should succeed even when there is no active
   * session to clear.
   */
  it('logout is idempotent with no active session', async () => {
    const res = await request(app).post('/api/v2/auth/logout');

    expect(res.status).toBe(204);
  });

  /**
   * Full session lifecycle: login establishes a session cookie, /me
   * resolves the authenticated principal from that session, and logout
   * destroys it so a subsequent /me is unauthorized again. Uses a
   * persistent agent so the Set-Cookie from login is replayed on later
   * requests within this test, the same way a real browser session would.
   */
  it('logs in, confirms the session via /me, then logs out and invalidates it', async () => {
    const agent = request.agent(app);

    const loginRes = await agent.post('/api/v2/auth/login').send({ username, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toEqual({
      user_id: userId,
      name: username,
      username,
      status: 'active',
    });

    const meRes = await agent.get('/api/v2/auth/me');

    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toEqual({
      user_id: userId,
      name: username,
      username,
      status: 'active',
    });

    const logoutRes = await agent.post('/api/v2/auth/logout');

    expect(logoutRes.status).toBe(204);

    const meAfterLogoutRes = await agent.get('/api/v2/auth/me');

    expect(meAfterLogoutRes.status).toBe(401);
    expect(meAfterLogoutRes.body.error.code).toBe('UNAUTHORIZED');
  });
});
