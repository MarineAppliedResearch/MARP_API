/**
 * Gives every test file an authenticated Supertest agent, as `global.api`.
 *
 * Every route now requires a permission (see #50), so a suite that calls the API
 * anonymously gets 401 and nothing else. Rather than have twenty test files each
 * build their own fixture user, log in, and clean up afterwards, this runs once per
 * test file from `setupFilesAfterEach` and leaves the agent on `global.api`.
 *
 * The fixture holds **every** permission in the catalog. That is deliberate: these
 * suites test what a route does, not who may call it. The permission boundaries
 * themselves are tested in `tests/v2_species.test.js`, which builds its own users
 * with deliberately narrow grants — that is the file to extend when a gate needs
 * checking, not this one.
 *
 * A per-file user rather than a shared one, because `npm test` runs with
 * `--runInBand` but nothing guarantees that forever, and two files racing to
 * create the same username would fail confusingly.
 *
 * @fileoverview Provides global.api, an authenticated Supertest agent, to every test file.
 * @author Isaac Travers
 * @module tests/setup/authenticated-agent
 */

const argon2 = require('argon2');
const request = require('supertest');

const app = require('../../app');
const db = require('../../model');

/**
 * Ceiling for building the fixture. Argon2 hashing is deliberately slow, and this
 * also grants around twenty permissions, so it is not instant -- but a minute
 * means something is wrong rather than busy.
 *
 * @constant
 * @type {number}
 */
const SETUP_TIMEOUT_MS = 60000;

/**
 * Identifies this test file's fixture user. Includes the worker id so parallel
 * workers cannot collide if `--runInBand` is ever dropped.
 *
 * @constant
 * @type {string}
 */
const fixtureName = `jest-api-${process.env.JEST_WORKER_ID || '0'}-${Date.now()}`;

/** Set in beforeAll, removed in afterAll. @type {number|undefined} */
let fixtureUserId;

beforeAll(async () => {
  const user = await db.users.create({
    name: fixtureName,
    username: fixtureName,
    status: 'active',
  });

  fixtureUserId = user.user_id;

  await db.auth_identities.create({
    user_id: user.user_id,
    provider: 'local',
    provider_subject: null,
    password_hash: await argon2.hash(fixtureName),
  });

  // Everything in the catalog, including admin. A test asserting behaviour should
  // never fail because of a permission it did not think about.
  const permissions = await db.permissions.findAll();

  await db.user_permissions.bulkCreate(
    permissions.map((permission) => ({
      user_id: user.user_id,
      permission_id: permission.permission_id,
      granted_by_user_id: null,
    }))
  );

  const agent = request.agent(app);
  const login = await agent.post('/api/v2/auth/login').send({
    username: fixtureName,
    password: fixtureName,
  });

  if (login.status !== 200) {
    throw new Error(
      `Test fixture login failed for ${fixtureName}: ${JSON.stringify(login.body)}. `
      + 'Has the auth migration run?'
    );
  }

  global.api = agent;
}, SETUP_TIMEOUT_MS);

/**
 * Removes the fixture. Grants and credentials reference the user, so they go
 * first.
 */
afterAll(async () => {
  if (!fixtureUserId) {
    return;
  }

  await db.user_permissions.destroy({ where: { user_id: fixtureUserId } });
  await db.auth_identities.destroy({ where: { user_id: fixtureUserId } });
  await db.users.destroy({ where: { user_id: fixtureUserId } });
});
