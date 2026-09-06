/**
 * Everything around the mosaic: header, sub-bar, filter rail, pager, action log.
 *
 * The mode tints the chrome and never the image field, so nothing here changes how
 * the organisms look.
 */
import { state, actions, MODES, getLog } from '../store.js';
import { commitCount, statusDimensions, commitOutcome, pageState } from '../model/modes.js';
import { hintFor } from '../model/keys.js';
import { pageWindow } from '../model/page.js';
import { sortLabel, activeFilterCount } from '../model/filters.js';
import { $, ICON } from './dom.js';

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

  /* The dimension labels belong to ui/rail.js, which draws the controls they sit on. */
  $('#sortLabel').textContent = sortLabel(state.sort);
  $('#fcount').textContent = activeFilterCount(state.mode, state.filters);

  const commit = $('#commit');
  const { busy, status } = state.commit;
  commit.classList.toggle('busy', busy);
  commit.classList.toggle('ok', status === 'ok');
  commit.classList.toggle('bad', status === 'failed');
  /* What the commit will really do, split by outcome -- so the button can stop offering
     to act on rows it is about to skip. A commit that would do nothing is disabled and
     says why, rather than looking normal and quietly achieving nothing. */
  const outcome = commitOutcome({ mode: state.mode, rows: state.rows, marks: state.marks });
  const nothingToDo = outcome.acts === 0;

  commit.disabled = busy || nothingToDo;
  commit.innerHTML =
      busy             ? `<span class="spin" aria-hidden="true"></span>Saving&hellip;`
    : status === 'ok'  ? `${ICON.tick}Saved`
    : status === 'failed' ? `${ICON.cross}Failed &mdash; try again`
    : nothingToDo    ? `${m.commit} &middot; nothing to do`
    : `${m.commit} &middot; ${outcome.acts} tiles`;

  commit.title = nothingToDo
    ? (outcome.skips
        ? `Nothing to commit: the ${outcome.skips} tiles here have no imagery, and nothing is marked. `
          + 'Flag one to record that it could not be seen, or retry the thumbnails.'
        : 'Nothing to commit on this page.')
    : state.mode === 'delete'
      ? `Permanently deletes the ${markedCount} marked tiles. The ${eligible - markedCount} unmarked tiles are untouched.`
      : `Accepts ${outcome.accepts}, flags ${outcome.flags}`
        + (outcome.skips ? `, and skips ${outcome.skips} with no imagery.` : '.');

  /* The one case where the number on the button is not the number of tiles on screen.
     Saying so is the whole of R5 -- a commit must never quietly mean "some of these". */
  const skipNote = $('#skipNote');
  if (skipNote) {
    skipNote.hidden = !outcome.skips || state.mode === 'delete';
    skipNote.textContent = outcome.skips
      ? `${outcome.skips} without imagery will be skipped — flag one to record that.`
      : '';
  }

  $('#footCount').textContent = `${markedCount} ${m.mark.toLowerCase()}`;
  $('#markAll').textContent = `${m.verb} all on page`;

  renderShortcutHints();
  renderStatusFilters();
  renderPager();
  renderPagesDone();
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

/**
 * How much of the current filter has been committed, counted in pages.
 *
 * It shares the legend with the swatch deliberately: the swatch explains what the
 * hue in the pager means, and the count says how many carry it. The total moves as
 * finished work leaves the filter, which is honest rather than tidy — the number to
 * watch is the one on the left.
 */
function renderPagesDone() {
  const done = state.committedPages.size;
  const total = state.pageCount;
  $('#pagesDone').innerHTML =
    `<b>${done}</b> of <b>${total}</b><span class="lw"> pages committed</span>`;
  $('#legend').title = done
    ? `${done} of ${total} pages committed this session. The total shrinks as finished `
      + `work leaves the filter; committed pages keep their place.`
    : 'No pages committed yet in this filter';
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

/**
 * Put each shortcut on the control it duplicates.
 *
 * A key badge rather than a help screen: a shortcut nobody can find is a shortcut nobody
 * uses, and a help screen is a place people go once. The `title` is appended too, since
 * that is reachable by keyboard focus -- but it cannot be the only route, because touch
 * has no hover at all.
 *
 * Idempotent: `renderChrome` runs on every state change, and a badge appended each time
 * would stack up.
 */
function renderShortcutHints() {
  const pairs = [
    ['#commit', 'commitPage'],
    ['#clearMarks', 'clearMarks'],
    ['.seg button[data-mode="scientific"]', 'modeScientific'],
    ['.seg button[data-mode="training"]', 'modeTraining'],
    ['.seg button[data-mode="delete"]', 'modeDelete'],
  ];

  for (const [selector, action] of pairs) {
    const el = $(selector);
    const hint = hintFor(action);
    if (!el || !hint) continue;

    el.dataset.key = hint;
    const base = (el.title || '').replace(/\s*\(\S+\)$/, '');
    if (base && !base.endsWith(`(${hint})`)) el.title = `${base} (${hint})`;
  }
}
