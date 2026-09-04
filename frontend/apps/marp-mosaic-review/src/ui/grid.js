/**
 * The mosaic grid, and the layout maths behind it.
 *
 * The grid fills the field rather than sitting in it, and a page holds exactly the
 * tiles that fit — so page size follows the viewport, per #68.
 */
import { state, actions } from '../store.js';
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

export function renderGrid() {
  const grid = $('#grid');
  if (state.loading) {
    grid.innerHTML = Array.from({ length: state.pageSize },
      () => '<div class="tile skeleton"></div>').join('');
    return;
  }
  grid.innerHTML = state.rows.map(tile).join('');
}
