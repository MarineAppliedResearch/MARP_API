/**
 * What a requirement check needs, inside the page.
 *
 * `tests/requirements.js` drove the store directly -- `state`, `actions`, and the backing
 * seam -- and named the requirement from #68 each check holds the prototype to. Those
 * checks are about the **rules**, so they have to run where the store runs, which is the
 * browser. What they cannot do any more is run against `src/data.js`: #157 deleted it.
 *
 * Two things changed and nothing else did:
 *
 * - **The bespoke runner is gone.** `tests.html` walked a list of closures and painted
 *   pass/fail into a page, and `contract.spec.mjs` scraped `li.fail` out of it to make the
 *   build red. Each check is a Playwright test now, so it is named, reported and retried
 *   like every other check in this tier -- and, more to the point, it gets its own page
 *   load. That is what replaces `reset()`: against a real server there is no
 *   `MarpData.reload()`, and a fresh page is the only reset that is actually a reset.
 * - **The backing is `src/backend.js`.** A check that drove `MarpData.commitPage` drives
 *   `MarpBackend.commitPage`, which is the application's own seam and now has exactly one
 *   thing behind it.
 *
 * This module is served to the browser like any other file under the app, and a check body
 * opens with one line that imports it. It holds no checks itself.
 *
 * Refs #157.
 *
 * @module tests/api/check-kit
 */

export { state, actions, MODES, subscribe } from '../../src/store.js';
export {
  pendingException, pendingTakeBack, statusDimensions, STATUS_DIMENSIONS
} from '../../src/model/modes.js';
export { MarpBackend } from '../../src/backend.js';

import { state, actions } from '../../src/store.js';
import { STATUS_DIMENSIONS } from '../../src/model/modes.js';
import { MarpBackend } from '../../src/backend.js';

/**
 * What a row's status reads as in the **filter** vocabulary.
 *
 * The row carries `review_decision` / `training_decision`, and the neutral state is
 * **null** -- the absence of a review record -- while the filter vocabulary spells that
 * `'unreviewed'` / `'undecided'`. Comparing a filter value against a row column directly
 * is what these checks used to do, and it worked only while the fixture invented a string
 * for the neutral state (F3).
 *
 * @param {string} key - The status dimension.
 * @param {Object} row - A served row.
 * @returns {string} The filter word for what it says.
 */
export const decidedAs = (key, row) => {
  const dim = STATUS_DIMENSIONS[key];
  const value = row[dim.column];
  return value == null ? dim.neutral : value;
};

/**
 * Commit a page the way the store does: **the rows, carrying their versions** (A7, R7).
 *
 * The three commit routes require `observations: [{observation_id, version}]` and refuse a
 * request that omits a version -- "a missing version is a 400, never an implicit
 * overwrite". Every check that commits by hand goes through this.
 *
 * @param {string} mode - The reviewing mode.
 * @param {Array<Object>} rows - Served rows, each carrying its own version.
 * @param {Map} [marks] - The exception set.
 * @returns {Promise<Object>} The commit report.
 */
export const commitRows = (mode, rows, marks = new Map()) =>
  MarpBackend.commitPage({ mode, rows, marks });

/** Assert two things serialise the same, the way these checks always have. */
export function eq(a, b, msg) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || ''} expected ${B}, got ${A}`);
}

/** Assert something is truthy, the way these checks always have. */
export function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

/** Wait, for the handful of checks that drive an action and then read what it did. */
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Put the store where a check expects to find it.
 *
 * What `reset()` did, minus the half that cannot be done any more. Reloading the fixture
 * is replaced by the page load Playwright already gave this check; emptying the page cache
 * by asking a question nobody asks is replaced by the same thing. What is left is the
 * mode, the page, the question, and the session work -- and that still has to be set,
 * because a check about training review cannot start in scientific.
 *
 * **The question narrows `reviewStatus` to `unreviewed`.** A page arrives with its
 * existing exceptions already marked, and the default question shows flagged rows, so on a
 * real corpus `state.marks` is not empty when a check starts counting it. Dropping
 * `flagged` is what these checks always assumed about page one.
 *
 * @param {string} [mode] - The mode to work in.
 * @param {Object} [narrowed] - Further filter values, e.g. `{line: ['1002']}`.
 * @returns {Promise<void>} Resolves once the page has been re-queried.
 */
export async function prepare(mode = 'scientific', narrowed = {}) {
  state.mode = mode;
  state.page = 1;

  /* Arrays: every set dimension is multi-select, and an empty one means the dimension is
     not filtering rather than matching nothing. */
  state.filters.species = [];
  state.filters.project = [];
  state.filters.dive = [];
  state.filters.line = [];
  state.filters.reviewStatus = ['unreviewed'];
  state.filters.trainingDisposition = ['undecided'];
  Object.assign(state.filters, narrowed);

  state.outcomes.clear();
  state.pageMembers.clear();
  state.committedPages.clear();
  state.marks.clear();
  state.touched.clear();
  state.takenBack.clear();
  state.changed.clear();
  state.picker = null;
  /* The refused accept mark fades on a timer in the application, and these checks run
     faster than that -- so one check's refusal would still be on screen for the next. */
  state.refused = null;

  await actions.refresh();
}
