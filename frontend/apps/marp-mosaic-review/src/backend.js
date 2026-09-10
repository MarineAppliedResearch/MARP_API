/**
 * Which backing the seam has. **The application gets `src/api/`; the fixture is for tests.**
 *
 * A2, answered: `src/data.js` survives, and it survives as a *test* fixture rather than as
 * an alternative the app can be pointed at. That distinction is the whole of this file, and
 * the option it rules out is worth naming: a runtime flag reachable from a browser is how a
 * render test comes to grade a fixture and report it as the API — green, proving nothing,
 * and invisible.
 *
 * So the selection is **per entry point**, not per run:
 *
 * - `index.html` imports the store and nothing else. It never mentions the fixture, so the
 *   application cannot be running against one however it is launched.
 * - `tests.html` — the contract tier — installs the fixture explicitly before anything
 *   queries. Those 58 checks are about the *rules*, they use `failNextCommit`,
 *   `slowNextCommit`, `breakThumbnails` and `reload`, and none of that is expressible
 *   against a real server (F17). Keeping them on the fixture is what keeps them fast and
 *   deterministic.
 * - the unit tier imports `src/data.js` directly, as it always has.
 *
 * The cost A2 named is real and stays: two implementations of one seam can drift. The
 * answer to that is the leak list under R24 — every place where the two disagreed is a
 * finding rather than something an adapter absorbed.
 */

import { MarpApi } from './api/index.js';

/**
 * The seam everything above `api/` calls.
 *
 * A plain object whose methods delegate, rather than a re-exported reference, so
 * `useBackend` can swap the backing after the module graph has been built. `store.js`
 * holds `MarpBackend` for the life of the page and there is no import to re-run.
 *
 * The method list is written out. That is deliberate: a `Proxy` would forward anything,
 * so a caller invoking a method neither backing has would fail at the call site with a
 * `TypeError` about `undefined` rather than here with its own name — and the two backings
 * agreeing on exactly this list is the substitutability claim R2 makes.
 */
const METHODS = [
  'load', 'whoami',
  'query', 'queryPages', 'counts', 'facets',
  'commitPage', 'setSpecies',
  'retryThumbnails', 'thumbnailUrl',
  'searchSpecies'
];

let impl = MarpApi;

export const MarpBackend = Object.fromEntries(METHODS.map((name) => [
  name,
  (...args) => {
    const fn = impl[name];
    if (typeof fn !== 'function') {
      throw new TypeError(`the ${implName()} backing has no ${name}()`);
    }
    return fn.apply(impl, args);
  }
]));

const implName = () => (impl === MarpApi ? 'api' : 'fixture');

/**
 * Point the seam at a different backing. **Tests only.**
 *
 * Returns the previous one so a caller can put it back, which is what makes a check that
 * substitutes a stub safe to run beside one that does not.
 *
 * There is no environment variable and no default that a bare `import` changes: the API is
 * what you get unless somebody wrote this call, and only `tests.html` and the unit tier do.
 */
export function useBackend(next) {
  const previous = impl;
  impl = next;
  return previous;
}

/** Which backing is installed. For a test that wants to assert it is on the right one. */
export const backendName = () => implName();
