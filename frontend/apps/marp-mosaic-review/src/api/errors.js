/**
 * Why a call failed, as something the interface can branch on.
 *
 * **A4: refused, expired and failed are three different states on screen**, and #68 names
 * this explicitly. The fixture cannot model any of them, so before this file the client
 * had exactly one failure — "the commit could not be saved" — and the three genuinely
 * different situations behind it were indistinguishable:
 *
 * - **expired (401)** — the seven-day cookie lapsed. Re-authenticating fixes it, and the
 *   reviewer's uncommitted marks are still on screen and still valid, so the panel that
 *   says so must not navigate away. Marks are deliberately not persisted (the app's
 *   `CLAUDE.md`, *The question persists; the work in progress does not*), so a reload here
 *   loses the page — which is exactly why re-authentication happens in place.
 * - **refused (403)** — the account lacks the permission. It will never work, and offering
 *   a retry is cruel; the useful thing is to name the permission.
 * - **failed (transport)** — a dropped socket, a 5xx, DNS. Try again.
 *
 * Two more exist and are not reviewer-facing states: a **request** error (400) is a defect
 * in this client, and an **abort** is the reviewer having moved on (A16) and is not a
 * failure at all.
 *
 * No DOM and no `fetch` here: this is the vocabulary, so `model/` and the UI can both
 * import it without importing the network.
 */

/** The five kinds. `kind` is what the UI branches on; the classes are for `instanceof`. */
export const FAILURE = {
  EXPIRED: 'expired',
  REFUSED: 'refused',
  FAILED: 'failed',
  REQUEST: 'request',
  ABORTED: 'aborted'
};

/** Anything this seam throws deliberately. */
export class ApiError extends Error {
  constructor(kind, message, { status = null, permission = null, cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    /* Which permission the route wanted, when the server said. Named on screen, because
       "you are not allowed to do that" without saying what is missing sends the reviewer
       to ask somebody who then has to guess too. */
    this.permission = permission;
    this.cause = cause;
  }
}

export const expired = (message, opts) => new ApiError(FAILURE.EXPIRED, message, { status: 401, ...opts });
export const refused = (message, opts) => new ApiError(FAILURE.REFUSED, message, { status: 403, ...opts });
export const failed = (message, opts) => new ApiError(FAILURE.FAILED, message, opts);
export const badRequest = (message, opts) => new ApiError(FAILURE.REQUEST, message, { status: 400, ...opts });

/**
 * Is this the reviewer having superseded the question, rather than something breaking?
 *
 * A16's cost, and the reason it is a named function rather than a `catch` at each call
 * site: **an aborted `fetch` rejects**, so without this a page change would report a
 * transport error to the reviewer — which is precisely the confusion A4 exists to remove.
 * `DOMException` named `AbortError` is what the platform throws; the fixture throws the
 * same name, so one test covers both backings.
 */
export const isAbort = (err) =>
  Boolean(err) && (err.name === 'AbortError' || err.kind === FAILURE.ABORTED);

/**
 * What kind of failure this is, for anything that has to branch on one.
 *
 * Anything that is not one of ours is a transport failure: a `TypeError` from `fetch` is
 * how the browser reports a dropped connection, and treating an unrecognised error as
 * "try again" is the safe reading — the alternative is telling a reviewer their session
 * expired because a JSON body was malformed.
 */
export function failureKind(err) {
  if (isAbort(err)) return FAILURE.ABORTED;
  if (err instanceof ApiError) return err.kind;
  return FAILURE.FAILED;
}
