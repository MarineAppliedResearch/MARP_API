/**
 * Everything around the mosaic: header, sub-bar, filter rail, pager, action log.
 *
 * The mode tints the chrome and never the image field, so nothing here changes how
 * the organisms look.
 */
import { state, actions, MODES, getLog } from '../store.js';
import {
  commitCount, statusDimensions, commitOutcome, pageState, markedOnPage,
  selectionOutcome, acceptedValue, commitActsOnMarked, MARK_EXCEPT, MARK_ACCEPT
} from '../model/modes.js';
import { hintFor } from '../model/keys.js';
import { pageWindow } from '../model/page.js';
import { sortLabel, activeFilterCount } from '../model/filters.js';
import { $, ICON } from './dom.js';

export function renderChrome() {
  document.body.dataset.mode = state.mode;
  document.body.classList.toggle('rail-collapsed', state.railCollapsed);
  document.body.classList.toggle('top-hidden', state.topChromeHidden);
  /* The one control that says what it will do next rather than what it did (#151 R2).
     The glyph is CSS, keyed on the same class; what cannot be CSS is the label a screen
     reader reads, and a button reading `Hide the header` while the header is gone is the
     kind of lie a toggle makes easily. */
  const chromeBtn = $('#chromebtn');
  if (chromeBtn) {
    const verb = state.topChromeHidden ? 'Show' : 'Hide';
    chromeBtn.setAttribute('aria-expanded', String(!state.topChromeHidden));
    chromeBtn.setAttribute('aria-label', `${verb} the header`);
    chromeBtn.title = `${verb} the header and the bar under it`;
  }

  const m = MODES[state.mode];
  $('#modeNote').textContent = m.note;
  document.querySelectorAll('.seg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.mode === state.mode));

  /* The exception marks, which is what this number has always counted -- every mark was
     one until #126. The accept marks are counted beside it rather than folded in, because
     "12 flagged" and "12 marked, some of which are acceptances" are different statements. */
  const markedCount = markedOnPage({ rows: state.rows, marks: state.marks, kind: MARK_EXCEPT });
  const acceptCount = markedOnPage({ rows: state.rows, marks: state.marks, kind: MARK_ACCEPT });
  const eligible = state.rows.filter((r) => r.thumbnail_status === 'ready').length;
  const willAct = commitCount({ mode: state.mode, rows: state.rows, marks: state.marks });

  /* Where the reviewer is, said in words as well as drawn in the pager. The pager's
     current page is a typable `<input>`, which reads as a control to change the page
     rather than as a statement of where you are — and once paging is instant you move
     far more, so the answer to "which page am I on" has to be legible without hunting
     for the highlighted chip. #99, reported 2026-09-09. */
  $('#pageNow').textContent = state.page.toLocaleString();
  $('#pageTotal').textContent = Math.max(1, state.pageCount).toLocaleString();

  /* Rows on screen, not the page size: a cached page suppresses rows now pinned to a
     committed page, so the last page and a short page both really do hold fewer. The
     page size is stated separately rather than inferred from this number. */
  $('#shown').textContent = state.loading ? '…' : state.rows.length;
  $('#total').textContent = state.total.toLocaleString();
  $('#perPage').textContent = state.pageSize;
  $('#markedCount').textContent = markedCount;
  /* This counts marks made here, which is not the same thing as the status filter. */
  $('#markedLabel').title =
    `Tiles you have marked to ${m.verb.toLowerCase()} on this page. `
    + 'Decisions already recorded against these observations are shown on the tiles, '
    + 'and are not counted here.';

  /* The dimension labels belong to ui/rail.js, which draws the controls they sit on. */
  $('#sortLabel').textContent = sortLabel(state.sort);
  $('#fcount').textContent = activeFilterCount(state.mode, state.filters);

  renderCommits({ m, markedCount, acceptCount, eligible });

  /* The one case where the number on the button is not the number of tiles on screen.
     Saying so is the whole of R5 -- a commit must never quietly mean "some of these".
     It describes the **sweep**, which is the only button that can reach a tile the
     reviewer never named: the main button's tiles were each clicked on. */
  const outcome = commitOutcome({ mode: state.mode, rows: state.rows, marks: state.marks });
  const skipNote = $('#skipNote');
  if (skipNote) {
    skipNote.hidden = !outcome.skips || state.mode === 'delete';
    skipNote.textContent = outcome.skips
      ? `${outcome.skips} without imagery will be skipped — flag one to record that.`
      : '';
  }

  /* `textContent`, so the separator is the character rather than the entity. Both kinds
     are named, because "12 flagged" standing beside eight acceptances would be a true
     number and a misleading sentence. */
  $('#footCount').textContent = acceptCount
    ? `${markedCount} ${m.mark.toLowerCase()} \u00b7 ${acceptCount} ${acceptedValue(state.mode)}`
    : `${markedCount} ${m.mark.toLowerCase()}`;
  $('#markAll').textContent = `${m.verb} all on page`;

  renderShortcutHints();
  renderStatusFilters();
  renderPager();
  renderPagesDone();
}

/**
 * The two commit buttons (#126 R5, R6).
 *
 * One function draws both, because the whole risk here is the two of them disagreeing
 * about what a number means -- they take their counts from `model/`, from the same two
 * rules the commits themselves use, so what a button says and what it does cannot drift.
 *
 * **Delete keeps one button** (A2). Its existing button already commits only what is
 * marked, so the main button would do the identical thing and showing both would be two
 * controls with one meaning. The sweep sheds its secondary styling there and is the
 * primary control again, which it has always been.
 */
function renderCommits({ m, markedCount, acceptCount, eligible }) {
  /* The acknowledgement belongs to the button that ran, and to no other (#131). The
     idle button keeps its default appearance -- not disabled, not blanked, not spun
     (A4): a button that says "Saving..." while saving nothing is the same lie as one
     that says "Saved", one step earlier. */
  const { busy, status, which } = state.commit;
  const ranSweep = which === 'sweep';
  const ranMarked = which === 'marked';
  const oneButton = commitActsOnMarked(state.mode);

  const sweep = $('#commit');
  const main = $('#commitMarked');

  main.hidden = oneButton;
  sweep.classList.toggle('sweep', !oneButton);

  /* What each will really do, split by outcome -- so neither can offer to act on rows it
     is about to skip. A commit that would do nothing is disabled and says why, rather
     than looking normal and quietly achieving nothing. */
  const swept = commitOutcome({
    mode: state.mode, rows: state.rows, marks: state.marks,
    takenBack: state.takenBack, outcomes: state.outcomes
  });
  const picked = selectionOutcome({
    mode: state.mode, rows: state.rows, marks: state.marks, touched: state.touched,
    takenBack: state.takenBack, outcomes: state.outcomes
  });

  paintCommit(sweep, {
    busy: busy && ranSweep, status: ranSweep ? status : null, acts: swept.acts,
    /* Its secondary label while there are two buttons, its own while it is the only one. */
    label: oneButton ? m.commit : m.sweep,
    short: oneButton ? m.verb : 'Page',
    title: swept.acts === 0
      ? (swept.skips
        ? `Nothing to commit: the ${swept.skips} tiles here have no imagery, and nothing is marked. `
          + 'Flag one to record that it could not be seen, or retry the thumbnails.'
        : 'Nothing to commit on this page.')
      : oneButton
        ? `Permanently deletes the ${markedCount} marked tiles. The ${eligible - markedCount} unmarked tiles are untouched.`
        : `Every tile on this page: accepts ${swept.accepts}, flags ${swept.flags}`
          /* Named rather than folded into the accepts: this button withdraws a take-back
             too (R7), and a withdrawal removes a decision where the other two make one. */
          + (swept.withdraws ? `, takes back ${swept.withdraws}` : '')
          + (swept.skips ? `, and skips ${swept.skips} with no imagery.` : '.')
  });

  if (oneButton) return;

  paintCommit(main, {
    busy: busy && ranMarked, status: ranMarked ? status : null, acts: picked.acts,
    label: 'Commit Marked',
    short: 'Commit',
    /* Why there is nothing to do matters here, and there are two different reasons. A page
       that arrives already showing the record's flags looks marked without anything having
       been decided in this sitting -- and this button deliberately acts only on what the
       reviewer decided (A3), so saying "nothing to do" without saying why would read as a
       broken button on a page covered in badges. */
    title: picked.acts === 0
      ? (markedCount + acceptCount
        ? 'Nothing you marked in this sitting. The marks on screen came from the record, and '
          + 'this button only commits decisions you made here.'
        : 'Mark a tile first: a click or tap flags it, a right click or a double tap accepts it.')
      : `Commits only these ${picked.acts}: accepts ${picked.accepts}, `
        + `flags ${picked.flags}`
        /* Named rather than folded into the other two: a withdrawal removes a decision
           and the other two make one, so a reviewer counting tiles would otherwise be
           told a take-back was an acceptance (#135 R5). */
        + (picked.withdraws ? `, takes back ${picked.withdraws}` : '')
        + '. Every other tile is left alone.'
  });
}

/**
 * One button's busy, done, failed and disabled states. Shared so they cannot diverge.
 *
 * **Two labels, and the narrow one is chosen by CSS rather than by JavaScript.** Two
 * buttons do not fit a 412-pixel footer at their full length, and `.app` clips rather than
 * scrolls -- so the pair simply ran off the end, taking the *main* button with it, which is
 * the one a phone reviewer needs most. `.lw` and `.sw` are the long and short wordings and
 * the media query picks one; reading the viewport here instead would make the label depend
 * on when a render happened to run.
 *
 * The count is in **both** wordings. R6 asks that each button says what it will do before
 * it does it, and that is the number rather than the verb.
 */
function paintCommit(el, { busy, status, acts, label, short, title }) {
  const nothingToDo = acts === 0;
  el.classList.toggle('busy', busy);
  el.classList.toggle('ok', status === 'ok');
  el.classList.toggle('bad', status === 'failed');
  el.disabled = busy || nothingToDo;
  const wording = nothingToDo
    ? `<span class="lw">${label} &middot; nothing to do</span><span class="sw">${short} 0</span>`
    : `<span class="lw">${label} &middot; ${acts} tiles</span><span class="sw">${short} ${acts}</span>`;
  el.innerHTML =
      busy                ? `<span class="spin" aria-hidden="true"></span>Saving&hellip;`
    : status === 'ok'     ? `${ICON.tick}Saved`
    : status === 'failed' ? `${ICON.cross}Failed &mdash; try again`
    : wording;
  el.title = title;
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

  /* `data-statuskey`, not `data-key`. `data-key` belongs to the keyboard-shortcut badge
     added by #74, and `[data-key]::after { content: attr(data-key) }` drew its value on
     screen -- so every status checkbox carried a grey pill reading `reviewStatus` beside
     its label, and nobody could tell what the second control was for. That is #81 B4. */
  $('#statusFilters').innerHTML = dims.map((dim, i) => {
    const active = state.filters[dim.key] || [];
    const heading = i === 0 ? '' : `<div class="lbl sub">${dim.label}</div>`;
    return heading + dim.statuses.map(([value, label]) =>
      `<button class="chk" data-status="${value}" data-statuskey="${dim.key}"
         title="Show ${label.toLowerCase()} observations">
         <span class="box ${active.includes(value) ? 'on' : ''}"></span>${label}
         <span class="n">${(state.counts[value] ?? 0).toLocaleString()}</span></button>`).join('');
  }).join('');

  $('#statusFilters').querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.toggleStatus(b.dataset.statuskey, b.dataset.status);
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
