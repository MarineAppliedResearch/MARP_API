/**
 * The seam everything above `api/` calls. **There is one backing, and it is `src/api/`.**
 *
 * This file used to hold one of two and let `useBackend` swap them, because `src/data.js`
 * was a second implementation of the same method set. #157 deleted the fixture, so the
 * choice is gone -- what stays is the seam itself, and it stays for two reasons rather
 * than out of habit:
 *
 * - **It is what the browser tier spies on.** `tests/api/render-prefetch.spec.mjs`
 *   replaces `MarpBackend.queryPages` with a wrapper to count the calls the scheduler
 *   makes, and `tests/api/check-kit.mjs` drives `MarpBackend.commitPage` the way the
 *   application does. Both need the methods to be assignable *properties* of one object,
 *   which a re-exported module reference is not.
 * - **It names the method set in one place.** A caller invoking something the backing
 *   lacks fails here, with its own name, rather than at the call site with a `TypeError`
 *   about `undefined`.
 *
 * `store.js` and `ui/tile.js` hold `MarpBackend` for the life of the page; nothing
 * re-imports.
 */

import { MarpApi } from './api/index.js';

/**
 * The methods the seam presents, written out rather than proxied.
 *
 * A `Proxy` would forward anything, which is the property being refused: the list is what
 * makes a missing method a named failure. It was also the substitutability claim while
 * there were two backings, and it is the spy surface now that there is one.
 */
const METHODS = [
  'load', 'whoami',
  'query', 'queryPages', 'counts', 'facets',
  'commitPage', 'setSpecies',
  'retryThumbnails', 'requestThumbnailReplacement', 'thumbnailUrl',
  'requestFullFrame', 'fullFrameUrl',
  'searchSpecies'
];

const impl = MarpApi;

export const MarpBackend = Object.fromEntries(METHODS.map((name) => [
  name,
  (...args) => {
    const fn = impl[name];
    if (typeof fn !== 'function') {
      throw new TypeError(`the api backing has no ${name}()`);
    }
    return fn.apply(impl, args);
  }
]));

/**
 * Which backing is installed. One answer, and it is still asked.
 *
 * `index.html` stamps it onto `documentElement.dataset.backing` and every check in
 * `tests/api/` asserts it reads `api` -- a tier that cannot grade the wrong thing is
 * worth keeping unable to, even now that the wrong thing has been deleted.
 */
export const backendName = () => 'api';
