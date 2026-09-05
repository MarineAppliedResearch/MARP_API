/**
 * Everything around the mosaic: header, sub-bar, filter rail, pager, action log.
 *
 * The mode tints the chrome and never the image field, so nothing here changes how
 * the organisms look.
 */
import { state, actions, MODES, getLog } from '../store.js';
import { commitCount, statusDimensions } from '../model/modes.js';
import { pageWindow } from '../model/page.js';
import { sortLabel, activeFilterCount } from '../model/filters.js';
import { $ } from './dom.js';

export function renderChrome() {
  document.body.dataset.mode = state.mode;
  document.body.classList.toggle('rail-collapsed', state.railCollapsed);

  const m = MODES[state.mode];
  $('#modeNote').textContent = m.note;
  document.querySelectorAll('.seg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.mode === state.mode));

  const markedCount = state.marks.size;
  const eligible = state.rows.filter((r) => r.thumbnail_status === 'ready').length;
  const willAct = commitCount({ mode: state.mode, rows: state.rows, marks: state.marks });

  $('#shown').textContent = state.loading ? '…' : state.rows.length;
  $('#total').textContent = state.total.toLocaleString();
  $('#markedCount').textContent = markedCount;
  /* This counts marks made here, which is not the same thing as the status filter. */
  $('#markedLabel').title =
    `Tiles you have marked to ${m.verb.toLowerCase()} on this page. `
    + 'Decisions already recorded against these observations are shown on the tiles, '
    + 'and are not counted here.';

  $('#selSpecies').textContent = state.filters.species || 'All species';
  $('#selProject').textContent = state.filters.project || 'All projects';
  $('#sortLabel').textContent = sortLabel(state.sort);
  $('#fcount').textContent = activeFilterCount(state.mode, state.filters);

  const commit = $('#commit');
  commit.innerHTML = `${m.commit} &middot; ${willAct} tiles`;
  commit.title = state.mode === 'delete'
    ? `Permanently deletes the ${markedCount} marked tiles. The ${eligible - markedCount} unmarked tiles are untouched.`
    : `Applies to the ${willAct} eligible tiles you did not mark. The ${markedCount} marked ones stay open.`;

  $('#footCount').textContent = `${markedCount} ${m.mark.toLowerCase()}`;
  $('#markAll').textContent = `${m.verb} all on page`;

  renderStatusFilters();
  renderPager();
}

/**
 * The status filters are mode-specific: scientific review filters on review status,
 * training review on training disposition, and Delete on both — because deleting is
 * irreversible and anything the record already says is a reason to stop. Counts come
 * from the query, so they move as work is committed.
 */
function renderStatusFilters() {
  const dims = statusDimensions(state.mode);

  /* The first dimension keeps the existing label slot; any further one brings its
     own heading, so two groups never read as one long list of unrelated boxes. */
  $('#statusLbl').textContent = dims[0].label;

  $('#statusFilters').innerHTML = dims.map((dim, i) => {
    const active = state.filters[dim.key] || [];
    const heading = i === 0 ? '' : `<div class="lbl sub">${dim.label}</div>`;
    return heading + dim.statuses.map(([value, label]) =>
      `<button class="chk" data-status="${value}" data-key="${dim.key}"
         title="Show ${label.toLowerCase()} observations">
         <span class="box ${active.includes(value) ? 'on' : ''}"></span>${label}
         <span class="n">${(state.counts[value] ?? 0).toLocaleString()}</span></button>`).join('');
  }).join('');

  $('#statusFilters').querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.toggleStatus(b.dataset.key, b.dataset.status);
    }));
}

function renderPager() {
  const chip = (i) => {
    const done = state.committedPages.has(i);
    return `<button class="pg ${done ? 'done' : ''}" data-page="${i}"
      title="${done ? 'Committed this session' : 'Go to page ' + i}">${i}</button>`;
  };
  const out = ['<button class="pg nav" data-page="prev" title="Previous page">&lsaquo; Prev</button>'];
  for (const slot of pageWindow(state.page, state.pageCount)) {
    if (slot === 'gap') out.push('<span class="gap">&hellip;</span>');
    else if (slot === state.page) {
      out.push(`<input class="pg" id="pageInput" value="${slot}" title="Type a page number to jump">`);
    } else out.push(chip(slot));
  }
  out.push('<button class="pg nav" data-page="next" title="Next page">Next &rsaquo;</button>');
  $('#pager').innerHTML = out.join('');
}

/** Every action, as it fires. These are the seams that become API calls. */
export function renderLog() {
  $('#logList').innerHTML = getLog().slice(0, 60).map((e) => {
    const detail = e.detail ? JSON.stringify(e.detail).replace(/[{}"]/g, '').slice(0, 60) : '';
    return `<li><span class="t">${e.at.toTimeString().slice(0, 8)}</span>
      <span class="n">${e.name}</span><span class="d">${detail}</span></li>`;
  }).join('');
}
