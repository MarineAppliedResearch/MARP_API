/**
 * Sign in to a running MARP API and leave the session where Playwright can load it.
 *
 * Only used when a run is pointed at the API rather than at `tools/serve.mjs` — see
 * `MARP_API_BASE` in `playwright.config.mjs`. The static server needs none of this.
 *
 * **Why a global setup rather than a first scene.** `/apps/marp-mosaic-review` is gated in
 * `app.js` on `observations:read`, so the app is not even served without a session — and the
 * walkthrough runner opens the page *before* the first scene runs, to let the grid settle.
 * There is no scene early enough to log in from. A storage state, loaded by the browser
 * context, is the only thing that is in place before that first navigation.
 *
 * **The session is a credential**, so nothing about it is written into a tracked file: the
 * username and password are read from the environment, and the cookie lands under the
 * git-ignored `demo/`.
 *
 * It throws rather than skipping. A run that quietly carried on with no session would meet
 * the sign-in page, fail to find a tile, and report that as the application being broken.
 */

import { request } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Where the signed-in state is left. Under `demo/`, which is git-ignored. */
export const SESSION_FILE = 'demo/.api-session.json';

export default async function signIn() {
  const base = String(process.env.MARP_API_BASE || '').replace(/\/+$/, '');
  const username = process.env.MARP_REVIEW_USERNAME;
  const password = process.env.MARP_REVIEW_PASSWORD;

  if (!username || !password) {
    throw new Error('MARP_API_BASE needs MARP_REVIEW_USERNAME and MARP_REVIEW_PASSWORD too.\n'
      + 'Create the login with: node scripts/create-review-user.js --username <name>');
  }

  const api = await request.newContext({ baseURL: base });
  const res = await api.post('/api/v2/auth/login', { data: { username, password } });

  if (!res.ok()) {
    /* 429 is the one refusal that is not about the credentials: the login route is limited
       to ten attempts per fifteen minutes per address, which one recording never reaches
       and half a dozen retakes does. The limiter is in memory, so restarting the API
       clears it. */
    const hint = res.status() === 429
      ? '\nThat is the login limiter, not the password. Restart the API to clear it.' : '';
    throw new Error(`${base} refused the sign-in: ${res.status()} ${await res.text()}${hint}`);
  }

  /* The permissions come back on the login response, so a missing one is reported here
     rather than as an unexplained empty mosaic twenty seconds into a recording. */
  const { user } = await res.json();
  const held = new Set((user && user.permissions) || []);
  const needed = ['observations:read', 'observations:write', 'species:read'];
  const missing = needed.filter((key) => !held.has(key));
  if (missing.length) {
    throw new Error(`'${username}' cannot use the reviewer: missing ${missing.join(', ')}.\n`
      + 'Grant them with: node scripts/create-review-user.js --username ' + username);
  }

  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  await api.storageState({ path: SESSION_FILE });
  await api.dispose();

  console.log(`signed in to ${base} as ${username} (user ${user.user_id})`);
}
