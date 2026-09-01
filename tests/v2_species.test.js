/**
 * Endpoint tests for the authenticated V2 species routes.
 *
 * Every species route now exists twice: unchanged at `/api/species/...` with no
 * gate, and at `/api/v2/species/...` behind a permission. Both are served by the
 * same handler through `routes/lib/register-versioned-route.js`, so what is worth
 * testing is not the behaviour a second time -- `tests/species-lists.test.js`
 * covers that -- but the gate:
 *
 * - an anonymous caller is refused
 * - a caller holding the wrong permission is refused
 * - a caller holding the right one gets the same answer as V1
 * - `species:read` does not grant writing
 *
 * The last one matters most. A read/write split that silently lets a reader write
 * is worse than no split at all, because it reads as protection.
 *
 * Runs against the app exported by app.js via Supertest, in-process, against the
 * real dev Postgres database (see jest.config.js). Every fixture user, credential
 * and grant is removed afterwards.
 *
 * @fileoverview Endpoint tests for the permission gate on V2 species routes.
 * @author Isaac Travers
 * @module tests/v2_species
 */

const argon2 = require('argon2');
const request = require('supertest');

const app = require('../app');
const db = require('../model');

/**
 * Unique per run, so a suite left half-cleaned by an earlier failure cannot
 * collide with this one.
 *
 * @constant
 * @type {number}
 */
const runId = Date.now();

/**
 * Creates an active user with a real Argon2 credential, grants it exactly the
 * named permissions, and logs in to get an authenticated agent.
 *
 * Logs in through the real endpoint rather than forging a session, so the test
 * exercises the same path a client would.
 *
 * @param {string} label - Distinguishes this fixture in the database.
 * @param {Array<string>} permissionKeys - Permissions to grant. May be empty.
 * @returns {Promise<{userId: number, agent: Object}>}
 */
async function createUserWithPermissions(label, permissionKeys) {
  const username = `jest-${label}-${runId}`;
  const password = `pw-${label}-${runId}`;

  const user = await db.users.create({ name: username, username, status: 'active' });

  await db.auth_identities.create({
    user_id: user.user_id,
    provider: 'local',
    provider_subject: null,
    password_hash: await argon2.hash(password),
  });

  for (const key of permissionKeys) {
    const permission = await db.permissions.findOne({ where: { key } });

    if (!permission) {
      throw new Error(
        `Permission "${key}" is not in the catalog. `
        + 'Has migrations/20260901130000-seed-resource-permissions.js run?'
      );
    }

    await db.user_permissions.create({
      user_id: user.user_id,
      permission_id: permission.permission_id,
      granted_by_user_id: null,
    });
  }

  const agent = request.agent(app);
  const login = await agent.post('/api/v2/auth/login').send({ username, password });

  if (login.status !== 200) {
    throw new Error(`Fixture login failed for ${username}: ${JSON.stringify(login.body)}`);
  }

  return { userId: user.user_id, agent };
}

describe('V2 species routes require a permission', () => {

  /** A caller holding `species:read` and nothing else. @type {Object} */
  let reader;

  /** A caller holding `species:write` as well. @type {Object} */
  let writer;

  /** A caller holding an unrelated permission, to prove the gate checks the right one. @type {Object} */
  let outsider;

  /** Every fixture user id, removed in afterAll. @type {Array<number>} */
  const userIds = [];

  beforeAll(async () => {
    reader = await createUserWithPermissions('species-reader', ['species:read']);
    writer = await createUserWithPermissions('species-writer', ['species:read', 'species:write']);
    outsider = await createUserWithPermissions('species-outsider', ['projects:read']);

    userIds.push(reader.userId, writer.userId, outsider.userId);
  }, 30000);

  /**
   * Removes the grants, credentials and users. Grants and identities have foreign
   * keys onto the user, so they go first.
   */
  afterAll(async () => {
    for (const userId of userIds) {
      await db.user_permissions.destroy({ where: { user_id: userId } });
      await db.auth_identities.destroy({ where: { user_id: userId } });
      await db.users.destroy({ where: { user_id: userId } });
    }
  });

  /**
   * The point of the exercise: no credential, no answer.
   */
  it('refuses an anonymous caller', async () => {
    const res = await request(app).get('/api/v2/species/lists');

    expect(res.status).toBe(401);
  });

  /**
   * Holding *a* permission is not holding *the* permission. Without this, a gate
   * that checked merely "is authenticated" would pass every other test here.
   */
  it('refuses a caller holding an unrelated permission', async () => {
    const res = await outsider.agent.get('/api/v2/species/lists');

    expect(res.status).toBe(403);
  });

  it('allows a caller holding species:read', async () => {
    const res = await reader.agent.get('/api/v2/species/lists');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  /**
   * Same handler, so the same answer. If these ever differ, the two versions have
   * drifted and the helper is not doing its job.
   */
  it('returns exactly what the V1 route returns', async () => {
    const v1 = await request(app).get('/api/species/list/Fish');
    const v2 = await reader.agent.get('/api/v2/species/list/Fish');

    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    expect(v2.body).toEqual(v1.body);
  });

  /**
   * The one that matters. A read/write split where a reader can still write is
   * worse than no split, because it looks like protection.
   */
  it('does not let species:read write', async () => {
    const list = await reader.agent.get('/api/v2/species/list/Fish');
    const someSpeciesId = list.body[0].id;

    const update = await reader.agent
      .put(`/api/v2/species/${someSpeciesId}`)
      .send({ species: { comname: 'Should Not Be Written' } });

    expect(update.status).toBe(403);

    const remove = await reader.agent.delete(`/api/v2/species/${someSpeciesId}`);

    expect(remove.status).toBe(403);
  });

  /**
   * And the write permission does grant writing. Restores the value afterwards so
   * the list is left as it was found.
   */
  it('lets species:write update an entry', async () => {
    const list = await writer.agent.get('/api/v2/species/list/Fish');
    const entry = list.body[0];
    const originalComname = entry.comname;

    const update = await writer.agent
      .put(`/api/v2/species/${entry.id}`)
      .send({ species: { comname: 'Jest V2 Write Probe' } });

    expect(update.status).toBe(200);
    expect(update.body.comname).toBe('Jest V2 Write Probe');

    const restore = await writer.agent
      .put(`/api/v2/species/${entry.id}`)
      .send({ species: { comname: originalComname } });

    expect(restore.status).toBe(200);
    expect(restore.body.comname).toBe(originalComname);
  });

  /**
   * The V1 routes are untouched by this change, and something has to say so --
   * the annotation GUI, the dashboard and the entry app all still use them.
   */
  it('leaves the V1 routes ungated', async () => {
    const lists = await request(app).get('/api/species/lists');
    const fish = await request(app).get('/api/species/list/Fish');

    expect(lists.status).toBe(200);
    expect(fish.status).toBe(200);
  });

  /**
   * Pictures are served as bytes rather than JSON, and go through the same gate.
   */
  it('gates picture bytes as well as JSON', async () => {
    const list = await reader.agent.get('/api/v2/species/list/Fish');
    const withPicture = list.body.find((entry) => entry.pictures.length > 0);

    expect(withPicture).toBeTruthy();

    const pictureId = withPicture.pictures[0].id;

    const anonymous = await request(app).get(`/api/v2/species/pictures/${pictureId}`);
    expect(anonymous.status).toBe(401);

    const authorised = await reader.agent.get(`/api/v2/species/pictures/${pictureId}`);
    expect(authorised.status).toBe(200);
    expect(authorised.headers['content-type']).toMatch(/^image\//);
  });
});
