/**
 * Draw one dashboard screen in jsdom, against answers the test controls.
 *
 * **Extracted at the third user, not the second.** `expandable-rows` and
 * `models-training-dataset` want exactly this and nothing more; `datasets-poll` keeps its
 * own copy because it also replaces the clock, and folding that in would make this a
 * thing with modes rather than a function. If a fourth test wants the clock too, that is
 * when the clock moves here.
 *
 * Not a page object and not a framework: it boots the real `mock.js` over the real
 * markup and hands back the window. Everything a test wants to know it asks the DOM.
 *
 * @author Isaac Travers
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/** The application root, two levels up from `tests/unit`. */
export const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Boot a screen and let its renders settle.
 *
 * `window.MarpApi` is the app's own seam -- `api.js` is what normally stands there -- so
 * `answers` is a map of the methods this screen should get, and anything it reaches for
 * that is not named answers 404, which every screen is already written to survive.
 *
 * @param {string} page - The HTML file, e.g. `models.html`.
 * @param {Object} answers - Keyed by `MarpApi` method name.
 * @returns {Promise<{window: Object, document: Object, close: Function}>}
 */
export async function drawScreen(page, answers) {
  const html = readFileSync(join(APP, page), 'utf8')
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');

  const dom = new JSDOM(html, {
    url: `http://localhost/apps/ml-dashboard/${page}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
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

  window.MarpApi = new Proxy(answers, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== 'string') return undefined;
      return async () => { throw Object.assign(new Error(`no stub for ${name}`), { status: 404 }); };
    },
  });

  const script = window.document.createElement('script');
  script.textContent = readFileSync(join(APP, 'mock.js'), 'utf8');
  window.document.body.appendChild(script);

  /* The renders are promise chains rather than timers; a few turns of the loop settles
     them, and a screen that is still loading fails its own assertions loudly. */
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  return { window, document: window.document, close: () => window.close() };
}
