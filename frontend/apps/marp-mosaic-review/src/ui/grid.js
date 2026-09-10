/**
 * The mosaic grid, and the layout maths behind it.
 *
 * The grid fills the field rather than sitting in it, and a page holds exactly the
 * tiles that fit — so page size follows the viewport, per #68.
 */
import { state, actions } from '../store.js';
import { pageState } from '../model/modes.js';
import { $ } from './dom.js';
import { tile } from './tile.js';

const GAP = 2;
let lastPageSize = null;

export function computeLayout() {
  const field = $('#field'), grid = $('#grid');
  if (!field || !grid) return;

  /* Never measure mid-load: the skeleton grid feeds a different tile height back
     in, which changes the page size, which starts another load. */
  if (state.loading) return;

  /* Read the column count CSS actually produced rather than predicting it. */
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  if (!cols) return;

  const probe = grid.querySelector('.tile');
  const tileH = probe ? probe.getBoundingClientRect().height : 0;
  if (tileH < 20) return;

  const CHROME = window.matchMedia('(max-width: 760px)').matches ? 40 + 26 + 44 : 44 + 30 + 46;
  const h = Math.max(field.getBoundingClientRect().height, window.innerHeight - CHROME) - 8;
  const rows = Math.max(2, Math.floor((h + GAP) / (tileH + GAP)));

  /* Belt and braces against flapping: refuse a size we have just come back from. */
  const next = cols * rows;
  if (next === lastPageSize) return;
  lastPageSize = state.pageSize;
  actions.setPageSize(next);
}

/**
 * The message for a page with nothing on it.
 *
 * One message, deliberately. "Matches nothing" and "everything here is already reviewed"
 * are indistinguishable from the client -- the default filter hides reviewed work, so a
 * finished dive returns zero rows exactly as a nonsense filter does. Telling them apart
 * would cost a second count query on every empty result, forever, to change one sentence.
 * So it says the true thing that covers both, and offers the way out.
 */
function emptyState() {
  return `
    <div class="pagestate pagestate--empty">
      <div class="pagestate__icon">&#9675;</div>
      <h2>Nothing to review here</h2>
      <p>Either nothing matches these filters, or everything under them has already been
         reviewed.</p>
      <button type="button" class="btn" data-act="clear-filters">Clear the filters</button>
    </div>`;
}

/**
 * A page where every thumbnail failed.
 *
 * Drawn over the tiles rather than instead of them: the observations are still there and
 * still flaggable, and hiding them would be saying they do not exist. A flag raised
 * because nobody could see the picture is a real review decision and reaches the database
 * like any other.
 */
function noImageryBanner(count, retryable) {
  /* **No button where retrying cannot help** (R13, F11). A permanent failure is refused
     by the endpoint rather than re-queued -- an observation with no keyframes has no
     bounding box and can never have a cropped picture -- and offering the button anyway
     would be a way to hammer a shared media server for something that cannot exist. */
  return `
    <div class="pagestate pagestate--banner">
      <div>
        <b>None of these ${count} thumbnails arrived.</b>
        <span>${retryable
          ? `The server refetches missing imagery on its own; you can also ask again now.
             Flagging one records that it could not be seen.`
          : `None of them can be extracted &mdash; these observations have nothing to crop a
             picture from. Flagging one records that it could not be seen.`}</span>
      </div>
      ${retryable
        ? '<button type="button" class="btn" data-act="retry-thumbnails">Ask again</button>'
        : ''}
    </div>`;
}

/**
 * A commit the server refused because the rows had moved (R9).
 *
 * Drawn over the tiles rather than instead of them: nothing was written, the marks are
 * still there, and the way forward is to re-read and commit again. This is **not** a
 * refusal for being second — the last commit wins, and nothing is ever turned away for
 * arriving after somebody else. It fires only where the annotation moved underneath the
 * page the reviewer was looking at.
 */
function conflictBanner(count) {
  return `
    <div class="pagestate pagestate--banner pagestate--conflict">
      <div>
        <b>${count} observation${count === 1 ? '' : 's'} changed while you were looking.</b>
        <span>Nothing was written for ${count === 1 ? 'it' : 'them'} and your marks are still
              here. Re-read the page to see what changed, then commit again.</span>
      </div>
      <button type="button" class="btn" data-act="reread">Re-read the page</button>
    </div>`;
}

export function renderGrid() {
  const grid = $('#grid');
  const field = $('#field');

  if (state.loading) {
    grid.innerHTML = Array.from({ length: state.pageSize },
      () => '<div class="tile skeleton"></div>').join('');
    if (field) field.dataset.state = 'loading';
    return;
  }

  const view = pageState({ rows: state.rows, loading: false, total: state.total });
  if (field) field.dataset.state = view;

  if (view === 'empty' || view === 'filtered-out') {
    grid.innerHTML = emptyState();
    return;
  }

  const broken = state.rows.filter((r) => r.thumbnail_status === 'failed');
  const retryable = broken.some((r) => !r.thumbnail_permanent);
  grid.innerHTML =
    (state.conflicted.length ? conflictBanner(state.conflicted.length) : '')
    + (view === 'no-imagery' ? noImageryBanner(broken.length, retryable) : '')
    + state.rows.map(tile).join('');
}
