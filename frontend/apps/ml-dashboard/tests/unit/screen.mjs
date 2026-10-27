/**
 * Draw one dashboard screen in jsdom, against answers the test controls.
 *
 * **Extracted at the third user, not the second.** `expandable-rows` and
 * `models-training-dataset` want exactly this and nothing more; `datasets-poll` keeps its
 * own copy because it also replaces the clock, and folding that in would make this a
 * thing with modes rather than a function. If a fourth test wants the clock too, that is
 * when the clock moves here.
 *
 * Not a page object and not a framework: it boots the real `screens.js` over the real
 * markup and hands back the window. Everything a test wants to know it asks the DOM.
 *
 * @author Isaac Travers
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

/** The application root, two levels up from `tests/unit`. */
export const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Boot a screen and let its renders settle.
 *
 * `window.MarpApi` is the app's own seam -- `api.js` is what normally stands there -- so
 * `answers` is a map of the methods this screen should get, and anything it reaches for
 * that is not named answers 404, which every screen is already written to survive.
 *
 * `navigations` on the result counts the times the page tried to leave. jsdom does not
 * implement navigation and reports each attempt, which is how a test watches for a
 * redirect without the page having to be written to be watched -- `window.location` and
 * its methods cannot be reassigned or redefined in jsdom, so there is no other seam.
 *
 * `realApi` loads `api.js` instead of standing `answers` in its place, for the few tests
 * that are about the data layer itself rather than about a screen. Those stub
 * `window.fetch` instead, which is one layer lower and the only way to exercise what
 * `request` does with a status.
 *
 * @param {string} page - The HTML file, e.g. `models.html`.
 * @param {Object} answers - Keyed by `MarpApi` method name. Ignored with `realApi`.
 * @param {Object} [options] - `{search, realApi}`.
 * @returns {Promise<{window: Object, document: Object, navigations: string[], close: Function}>}
 */
export async function drawScreen(page, answers, options = {}) {
  const { search = '', realApi = false } = options;
  const html = readFileSync(join(APP, page), 'utf8')
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');

  const navigations = [];
  const virtualConsole = new VirtualConsole();

  virtualConsole.on('jsdomError', (error) => {
    if (/navigation/i.test(error.message)) navigations.push(error.message);
  });

  const dom = new JSDOM(html, {
    url: `http://localhost/apps/ml-dashboard/${page}${search}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });

  const { window } = dom;

  /* What jsdom does not implement. Five are things a screen does *to* a browser rather
     than things it asks one, so a no-op is the honest stand-in; `CSS.escape` is a real
     function with a real answer and gets a real enough one. */
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, finish() {} });
  window.scrollTo = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.CSS = { escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`) };

  const run = (file) => {
    const script = window.document.createElement('script');
    script.textContent = readFileSync(join(APP, file), 'utf8');
    window.document.body.appendChild(script);
  };

  if (realApi) run('api.js');
  else {
    /* **`freshness` is chrome, not a route**, so it is answered by default rather than
       left to every test to stub. It is read by the top bar on every screen and it is
       synchronous, so the usual "throw an async 404" fallback would both throw at the
       wrong moment and make a test about a table fail for a reason about a clock. */
    const chrome = {
      freshness: () => ({ at: Date.now(), failed: null, inFlight: 0 }),
      /* **The real clock, because the fixture one was the defect.** `now()` is the
         present anything measuring "how long ago" reads. It used to be the corpus's
         fixed 2026-10-14, which is older than everything the API returns, so every
         elapsed time came out negative, clamped at zero, and the Workers page said
         "0s ago" about every machine for ever. A stub that froze it would hide exactly
         that class of bug from this tier. */
      now: () => Date.now(),
    };

    window.MarpApi = new Proxy(answers, {
      get(target, name) {
        if (name in target) return target[name];
        if (name in chrome) return chrome[name];
        if (typeof name !== 'string') return undefined;
        return async () => { throw Object.assign(new Error(`no stub for ${name}`), { status: 404 }); };
      },
    });
  }

  run('screens.js');

  /* The renders are promise chains rather than timers; a few turns of the loop settles
     them, and a screen that is still loading fails its own assertions loudly. */
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  return { window, document: window.document, navigations, close: () => window.close() };
}
