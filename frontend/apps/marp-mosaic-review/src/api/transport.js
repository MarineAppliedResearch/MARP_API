/**
 * The one place that knows `fetch`, a URL, a header and an HTTP status (R1).
 *
 * Everything else in `src/api/` asks this for JSON. Nothing above `src/api/` contains any
 * of the four, which is R1 stated as a grep: `grep -nE "/api/|fetch\(|[0-9]{3} status"`
 * over `src/` outside `src/api/` finds nothing.
 *
 * Three decisions are load-bearing and each is grounded rather than chosen.
 *
 * **`credentials: 'same-origin'`, and no scheme invented** (A3). The app is served from
 * this API's own origin, `middleware/resolve-principal.middleware.js` populates
 * `req.principal` from the Passport session *before* it looks for a bearer token, and the
 * cookie is `httpOnly` / `sameSite: 'lax'` — so a same-origin request is authorised with
 * the cookie the reviewer already has. No signed URL, no token in a query string, and
 * nothing for this client to store. It is also what makes a plain `<img src>` work for a
 * tile (R10), which is the whole reason a per-tile blob fetch is not needed.
 *
 * **Nothing is retried here.** Which failures are worth retrying is a product question
 * (A4), and a transport that retries a 403 turns "you are not allowed" into a hang.
 *
 * **An abort is not a failure** (A16). It rejects — `fetch` gives no choice — and
 * `errors.isAbort` is how every caller tells the two apart. Reporting a superseded page
 * change as a transport error is exactly the confusion A4 exists to remove.
 */

import { expired, refused, failed, badRequest } from './errors.js';

/** Where the API is, relative to wherever the app is served from. */
const BASE = '/api/v2';

/**
 * The error envelope's message, when the response carries one.
 *
 * `middleware/error-contract.middleware.js` answers `{ error: { code, message, status,
 * requestId } }`. Read defensively: a proxy in front of the API can answer with HTML, and
 * a client that throws while working out what went wrong tells the reviewer nothing.
 */
async function problem(res) {
  try {
    const body = await res.json();
    const err = body && body.error;
    if (err && err.message) return { message: String(err.message), code: err.code || null };
  } catch { /* not JSON, or an empty body */ }
  return { message: `${res.status} ${res.statusText || ''}`.trim(), code: null };
}

/**
 * Which permission a 403 was about, when the message says.
 *
 * `requirePermission` answers with the key in its message, and naming it on screen is the
 * difference between a reviewer who can ask for the right thing and one who cannot.
 * Best-effort by design: a missing name costs a sentence, never the error.
 */
const permissionIn = (message) => {
  const m = /([a-z_]+:[a-z_]+)/.exec(String(message || ''));
  return m ? m[1] : null;
};

/**
 * One request, and the taxonomy A4 settles.
 *
 * @param {string} path - Below `/api/v2`, e.g. `/mosaic/observations/pages`.
 * @param {Object} [options]
 * @param {string} [options.method='GET']
 * @param {*} [options.body] - Serialised as JSON when present.
 * @param {AbortSignal} [options.signal] - A16.
 * @returns {Promise<*>} The parsed body, or null for a 204.
 */
export async function request(path, { method = 'GET', body, signal } = {}) {
  let res;

  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      /* Same-origin, so the session cookie travels. See the file comment: this is A3's
         answer to #120's browser question, and it is why no token is stored here. */
      credentials: 'same-origin',
      headers: body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
  } catch (err) {
    /* An abort rejects here too, and it is not a failure. Rethrown unchanged so
       `isAbort` still recognises it — wrapping it would lose the name. */
    if (err && err.name === 'AbortError') throw err;
    throw failed(
      'The API could not be reached. Your marks are still here — try again.',
      { cause: err }
    );
  }

  if (res.ok) {
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw failed('The API answered with something that is not JSON.', { cause: err });
    }
  }

  const { message } = await problem(res);

  if (res.status === 401) {
    throw expired('Your session has expired. Sign in again to carry on — nothing you have marked is lost.');
  }
  if (res.status === 403) {
    throw refused(message, { permission: permissionIn(message) });
  }
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    throw badRequest(message, { status: res.status });
  }

  /* 5xx and anything else: the server broke rather than refused, so trying again is the
     honest advice. */
  throw failed(message, { status: res.status });
}

/**
 * The address of one observation's picture (R10, F7).
 *
 * A **URL and not a fetch**: the tile draws `<img src>`, which carries the session cookie
 * on a same-origin request and lets the browser cache and revalidate against the route's
 * ETag. A blob fetch per tile would be 45 requests this file has to hold in memory, for a
 * picture the platform already knows how to cache.
 *
 * The row deliberately carries no `thumb` — "the address is derivable from a key this row
 * already carries, so no second field repeats a URL 45 times a page" — and the row-shape
 * tripwire asserts its absence. So this is where the derivation lives, once.
 */
export const thumbnailUrl = (observationId) =>
  `${BASE}/observations/${observationId}/thumbnail`;
