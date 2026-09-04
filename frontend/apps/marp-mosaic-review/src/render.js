/**
 * Rendering. Reads state, writes DOM. Never mutates state directly — every
 * interaction calls a named action, so the seams stay visible.
 */
import { state, actions, subscribe, MODES, getLog, onLog } from './store.js';
import { MarpData } from './data.js';
import { commitCount, existingState, decidedBy } from './model/modes.js';
import { pageWindow } from './model/page.js';
import { SORTS, sortLabel, activeFilterCount } from './model/filters.js';

const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const ICON = {
  flag: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h1.6v14H3zM5.6 2h8l-2 3 2 3h-8z"/></svg>',
  tick: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 12.5 2 8l1.4-1.4 3.1 3.1 6.1-6.1L14 5z"/></svg>',
  eye:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.4 3 1.6 5.6 1 8c.6 2.4 3.4 5 7 5s6.4-2.6 7-5c-.6-2.4-3.4-5-7-5zm0 8a3 3 0 110-6 3 3 0 010 6z"/></svg>',
  del:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 1h4l.6 1H14v2H2V2h3.4zM3 5h10l-.8 10H3.8z"/></svg>',
  exc:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM3.9 8a4.1 4.1 0 016.3-3.4L4.6 10.2A4 4 0 013.9 8zm4.1 4.1a4 4 0 01-2.2-.7l5.6-5.6A4.1 4.1 0 018 12.1z"/></svg>',
  pro:  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="m8 1 2 4.4 4.8.5-3.6 3.2 1 4.7L8 11.4 3.8 13.8l1-4.7L1.2 5.9 6 5.4z"/></svg>'
};

const markIcon = () => ({ scientific: ICON.flag, training: ICON.exc, delete: ICON.del }[state.mode]);
const markClass = () => ({ scientific: 'b-flag', training: 'b-exc', delete: 'b-del' }[state.mode]);

/* ------------------------------------------------------- responsive layout */

/**
 * The grid fills the field rather than sitting in it, and the page holds exactly
 * the tiles that fit — so page size follows the viewport, per #68.
 */
const TARGET_TILE = 150, MIN_TILE = 104, GAP = 2;
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

/* ---------------------------------------------------------------- tiles */

function tile(row) {
  const id = row.observation_id;
  const marked = state.marks.get(id);
  const changed = state.changed.get(id);
  const outcome = state.outcomes.get(id);
  const isActive = state.picker && state.picker.id === id;
  const ME = 'I. Travers';
  /* The state the record already carries, as opposed to a mark made this session. */
  const existing = existingState(state.mode, row);
  const showExisting = existing && !marked && !outcome;
  const byMe = decidedBy(row) === ME;

  const cls = ['tile'];
  const noImage = row.thumbnail_status !== 'ready';
  if (row.thumbnail_status === 'queued') cls.push('queued');
  if (row.thumbnail_status === 'failed') cls.push('failed');
  if (marked) cls.push('marked');
  if (isActive) cls.push('active');
  if (changed) cls.push('changed');
  if (outcome) cls.push('out-' + outcome);
  else if (showExisting) cls.push('has-' + existing);

  /* The badge is its own control: tapping the tile marks, tapping the badge opens
     the panel. That keeps marking a single uninterrupted gesture. */
  let badge = '';
  if (outcome === 'flagged')      badge = `<span class="badge b-flag" data-badge="${id}"
        title="Flagged${row.flag_reason ? ' — ' + row.flag_reason : ''}">${ICON.flag}FLAGGED</span>`;
  else if (outcome === 'excluded') badge = `<span class="badge b-exc" data-badge="${id}"
        title="Excluded${row.exclusion_reason ? ' — ' + row.exclusion_reason : ''}">${ICON.exc}EXCLUDED</span>`;
  else if (outcome === 'reverted') badge = `<span class="badge b-rev">${markIcon()}TAKEN BACK</span>`;
  else if (outcome === 'deleted') badge = `<span class="badge b-gone">${ICON.del}DELETED</span>`;
  else if (outcome === 'promoted') badge = `<span class="badge b-out">${ICON.pro}PROMOTED</span>`;
  else if (outcome === 'reviewed') badge = `<span class="badge b-out">${ICON.tick}REVIEWED</span>`;
  else if (marked) badge = `<span class="badge ${markClass()}" data-badge="${id}"
        title="Open reason and correction options">${markIcon()}${MODES[state.mode].mark.toUpperCase()}</span>`;
  else if (changed)     badge = `<span class="badge b-chg">${ICON.tick}CHANGED</span>`;
  else if (showExisting) {
    const who = byMe ? ' &middot; you' : '';
    badge = existing === 'flagged'
      ? `<span class="badge b-flag" data-badge="${id}"
           title="Flagged${row.flag_reason ? ' — ' + row.flag_reason : ''}${who ? ', by you' : ''}">${ICON.flag}FLAGGED${who}</span>`
      : existing === 'excluded'
      ? `<span class="badge b-exc">${ICON.exc}EXCLUDED${who}</span>`
      : existing === 'promoted'
        ? `<span class="badge b-pro">${ICON.pro}PROMOTED${who}</span>`
        : byMe ? `<span class="badge b-out">${ICON.tick}REVIEWED &middot; you</span>`
               : `<span class="badge b-oth">${ICON.eye}${row.reviewed_by || 'REVIEWED'}</span>`;
  }

  const corner = state.mode === 'training'
    ? `<span class="frames">${row.keyframe_count}f</span>`
    : (marked && marked.reason ? `<span class="reason-chip">${marked.reason}</span>`
       : (changed || row.previous_comname)
         ? `<span class="reason-chip" data-changed="${id}" title="Change the species again">was ${
             (changed && changed.from) || row.previous_comname}</span>`
       : ((existing === 'flagged' || outcome === 'flagged') && row.flag_reason)
         ? `<span class="reason-chip">${row.flag_reason}</span>`
       : ((existing === 'excluded' || outcome === 'excluded') && row.exclusion_reason)
         ? `<span class="reason-chip">${row.exclusion_reason}</span>` : '');

  /* An unavailable image is still an observation: it keeps its name and stays
     markable. It is only excluded from the bulk commit, which is a separate rule. */
  const body = row.thumbnail_status === 'ready'
    ? `<img src="./fixtures/thumbs/t${String(row.thumb).padStart(2, '0')}.jpg" alt="${row.comname}">`
    : row.thumbnail_status === 'queued'
      ? `<span class="fallback"><img src="./fixtures/thumbs/marp-mark.png" alt="">
           <span class="ph-t">PREPARING</span><span class="phbar"><i></i></span></span>`
      : `<span class="fallback"><span style="font-size:20px;color:#c07d85">&#9888;</span>
           <span class="na-t">NO IMAGE</span></span>`;

  const tip = noImage
    ? `${row.comname} · no image — markable, but excluded from the page commit`
    : `${row.comname} · ${row.confidence} · ${row.dive} line ${row.line} · ${row.tc}`;

  return `<button class="${cls.join(' ')}" data-id="${id}" title="${tip}">
      ${body}${badge}${corner}
      <span class="cap">${row.comname}</span></button>`;
}

function renderGrid() {
  const grid = $('#grid');
  if (state.loading) {
    grid.innerHTML = Array.from({ length: state.pageSize }, () => '<div class="tile skeleton"></div>').join('');
    return;
  }
  grid.innerHTML = state.rows.map(tile).join('');
}

/* ---------------------------------------------------------------- picker */

async function renderPicker() {
  const host = $('#picker');
  host.innerHTML = '';
  if (!state.picker || state.mode === 'delete') return;

  const { id, correcting } = state.picker;
  const row = state.rows.find((r) => r.observation_id === id);
  const mark = state.marks.get(id);
  if (!row || !mark) return;

  const matches = correcting ? await MarpData.searchSpecies('') : [];

  const panel = el(`<div class="pick" role="dialog" aria-label="Flag options">
      <h4><span class="fl">${markIcon()}</span>${MODES[state.mode].mark}<span class="opt">Reason optional</span></h4>
      <p>Already recorded. Add a reason to help whoever resolves it, or close this and
         keep scanning &mdash; the mark stands on its own.</p>
      <div class="chips">${MODES[state.mode].reasons.map((r) =>
        `<button class="chip ${mark.reason === r ? 'on' : ''}" data-reason="${r}"
           title="Record this as the reason">${mark.reason === r ? ICON.tick : ''}${r}</button>`).join('')}
        <button class="chip change ${correcting ? 'on' : ''}" data-act="correct"
          title="Change this observation's species">Change species&hellip;</button>
      </div>
      ${correcting ? `<div class="correct">
        <h5>Correct the species<span class="opt">saves immediately</span></h5>
        <input class="search" id="spSearch" placeholder="Search MARP taxonomy&hellip;" autocomplete="off">
        <div class="sugghead">Matches &middot; MARP taxonomy</div>
        <div id="spList">${matches.map((s) =>
          `<button class="srow" data-species="${s.species_id}">${s.comname}
             <span class="sci">${s.species}</span></button>`).join('')}</div></div>` : ''}
      <div class="consq ${correcting ? 'ok' : ''}">${correcting
        ? 'The correction <b>saves immediately</b> and is recorded against your name. The mark stays until you resolve it.'
        : state.mode === 'training'
          ? 'Excluding is <b>a deliberate decision, not the absence of one</b>. It is recorded with its reason and can be reconsidered.'
          : 'False detection <b>removes this observation from accepted scientific results</b>. The other reasons are advisory.'}</div>
      <div class="pickfoot">
        <button class="ghost" data-act="unmark" title="Remove the mark entirely">Remove ${MODES[state.mode].mark.toLowerCase()}</button>
        <button class="ghost" data-act="video" title="Open the source video at this observation">Open video</button>
        <button class="ghost go" data-act="resolve" title="Clear the mark, keeping any correction">Mark resolved</button>
      </div></div>`);

  host.appendChild(panel);
  position(panel, id);

  panel.querySelectorAll('[data-reason]').forEach((b) =>
    b.addEventListener('click', () => actions.setReason(id, b.dataset.reason)));
  bindSpecies(panel, id);
  panel.querySelector('[data-act="correct"]').addEventListener('click', () => actions.toggleCorrecting(id));
  panel.querySelector('[data-act="unmark"]').addEventListener('click', () => actions.toggleMark(id));
  panel.querySelector('[data-act="video"]').addEventListener('click', () => actions.openVideo(id));
  panel.querySelector('[data-act="resolve"]').addEventListener('click', () => actions.resolve(id));

  const search = panel.querySelector('#spSearch');
  if (search) {
    search.focus();
    search.addEventListener('input', async () => {
      const list = await MarpData.searchSpecies(search.value);
      panel.querySelector('#spList').innerHTML = list.map((s) =>
        `<button class="srow" data-species="${s.species_id}">${s.comname}
           <span class="sci">${s.species}</span></button>`).join('');
      bindSpecies(panel, id);
    });
  }
}

function bindSpecies(panel, id) {
  panel.querySelectorAll('[data-species]').forEach((b) =>
    b.addEventListener('click', () => actions.changeSpecies(id, Number(b.dataset.species))));
}

/** Below the tile by preference, above when there is no room, clamped when neither fits. */
function position(panel, id) {
  const tileEl = $(`.tile[data-id="${id}"]`), field = $('#field');
  if (!tileEl) return;
  const t = tileEl.getBoundingClientRect(), f = field.getBoundingClientRect(), G = 10, E = 8;
  panel.style.maxHeight = (f.height - E * 2) + 'px';
  panel.style.overflowY = 'auto';
  const h = Math.min(panel.offsetHeight, f.height - E * 2);
  const below = t.bottom - f.top + G, above = t.top - f.top - h - G;
  panel.style.top = (below + h <= f.height - E ? below
                    : above >= E ? above
                    : Math.max(E, f.height - h - E)) + 'px';
  panel.style.left = Math.min(Math.max(E, t.left - f.left - 140),
                              Math.max(E, f.width - panel.offsetWidth - E)) + 'px';
}

/* ---------------------------------------------------------------- menus */

let openMenuEl = null;
export function closeMenus() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }

function menu(anchor, items, { align = 'left', dir = 'down', search = false } = {}) {
  closeMenus();
  const rows = () => items.filter((i) => !i.head && !i.hr);

  const body = (filter) => {
    const f = (filter || '').trim().toLowerCase();
    const shown = items.filter((i) => {
      if (i.head || i.hr) return !f;                     // headings only when unfiltered
      return !f || String(i.label).toLowerCase().includes(f);
    });
    if (!shown.some((i) => !i.head && !i.hr)) return '<div class="mhead">No matches</div>';
    return shown.map((i) => {
      if (i.head) return `<div class="mhead">${i.head}</div>`;
      if (i.hr) return '<hr>';
      return `<button data-v="${i.value}" class="${i.on ? 'on' : ''}">
        <span class="tick">${i.on ? ICON.tick : ''}</span>${i.label}</button>`;
    }).join('');
  };

  /* These lists can get long — projects and taxonomy especially — so they filter
     as you type rather than making you scroll. */
  const m = el(`<div class="menu ${dir} ${align}">
      ${search ? '<input class="msearch" placeholder="Type to filter&hellip;" autocomplete="off">' : ''}
      <div class="mbody">${body('')}</div>
    </div>`);
  /* Anchored against the viewport, not the parent: the filter rail has
     overflow:hidden and was clipping the menu off the left edge. */
  document.body.appendChild(m);
  const a = anchor.getBoundingClientRect();
  m.style.position = 'fixed';
  m.style.minWidth = Math.max(190, a.width) + 'px';
  const w = m.offsetWidth, h = m.offsetHeight, E = 8;
  let left = align === 'right' ? a.right - w : a.left;
  left = Math.min(Math.max(E, left), window.innerWidth - w - E);
  const below = a.bottom + 6;
  m.style.left = left + 'px';
  m.style.top = (below + h <= window.innerHeight - E ? below
                : Math.max(E, a.top - h - 6)) + 'px';

  const bind = () => m.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = rows().find((i) => String(i.value) === b.dataset.v);
    closeMenus();
    if (item && item.onPick) item.onPick(item.value);
  }));
  bind();

  const input = m.querySelector('.msearch');
  if (input) {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => { m.querySelector('.mbody').innerHTML = body(input.value); bind(); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = m.querySelector('[data-v]');
      if (first) first.click();
    });
    setTimeout(() => input.focus(), 0);
  }
  openMenuEl = m;
}

function speciesMenu(anchor) {
  const items = [{ head: 'Species' },
    { value: '', label: 'All species', on: !state.filters.species,
      onPick: () => actions.setFilter('species', null) }];
  MarpData.species().forEach((s) => items.push({
    value: s.comname, label: s.comname, on: state.filters.species === s.comname,
    onPick: (v) => actions.setFilter('species', v)
  }));
  menu(anchor, items, { search: true });
}

function projectMenu(anchor) {
  const items = [{ head: 'Project' },
    { value: '', label: 'All projects', on: !state.filters.project,
      onPick: () => actions.setFilter('project', null) }];
  MarpData.projects().forEach((p) => items.push({
    value: p.name, label: p.name, on: state.filters.project === p.name,
    onPick: (v) => actions.setFilter('project', v)
  }));
  menu(anchor, items, { search: true });
}

function modelMenu(anchor) {
  menu(anchor, [
    { head: 'Model — not yet in the schema' },
    { value: 'v3.2', label: 'BatStarNet v3.2', on: true, onPick: () => {} },
    { value: 'v3.1', label: 'BatStarNet v3.1', onPick: () => {} },
    { value: 'any', label: 'Any model', onPick: () => {} }
  ], { search: true });
}

function sortMenu(anchor) {
  menu(anchor, [{ head: 'Sort by' }].concat(SORTS.map((s) => ({
    value: s.field + ':' + s.dir, label: s.label,
    on: state.sort.field === s.field && state.sort.dir === s.dir,
    onPick: (v) => { const [f, d] = v.split(':'); actions.setSort(f, d); }
  }))), { align: 'right' });
}

function userMenu(anchor) {
  menu(anchor, [
    { head: 'Signed in as I. Travers' },
    { value: 'prefs', label: 'Preferences', onPick: () => {} },
    { value: 'keys', label: 'Keyboard shortcuts', onPick: () => {} },
    { value: 'density', label: 'Tile density', onPick: () => {} },
    { hr: true },
    { value: 'out', label: 'Sign out', onPick: () => {} }
  ], { align: 'right' });
}

/* ---------------------------------------------------------------- chrome */

function renderChrome() {
  document.body.dataset.mode = state.mode;
  document.body.classList.toggle('rail-collapsed', state.railCollapsed);

  $('#modeNote').textContent = MODES[state.mode].note;
  document.querySelectorAll('.seg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.mode === state.mode));

  const markedCount = state.marks.size;
  const eligible = state.rows.filter((r) => r.thumbnail_status === 'ready').length;
  const willAct = commitCount({ mode: state.mode, rows: state.rows, marks: state.marks });

  $('#shown').textContent = state.loading ? '…' : state.rows.length;
  $('#total').textContent = state.total.toLocaleString();
  $('#markedCount').textContent = markedCount;
  $('#markedLabel').title =
    `Tiles you have marked to ${MODES[state.mode].verb.toLowerCase()} on this page. `
    + 'Decisions already recorded against these observations are shown on the tiles, '
    + 'and are not counted here.';
  $('#selSpecies').textContent = state.filters.species || 'All species';
  $('#selProject').textContent = state.filters.project || 'All projects';
  $('#sortLabel').textContent = sortLabel(state.sort);

  const commit = $('#commit');
  commit.innerHTML = `${MODES[state.mode].commit} &middot; ${willAct} tiles`;
  commit.title = state.mode === 'delete'
    ? `Permanently deletes the ${markedCount} marked tiles. The ${eligible - markedCount} unmarked tiles are untouched.`
    : `Applies to the ${willAct} eligible tiles you did not mark. The ${markedCount} marked ones stay open.`;

  $('#footCount').textContent = `${markedCount} ${MODES[state.mode].mark.toLowerCase()}`;
  $('#markAll').textContent = `${MODES[state.mode].verb} all on page`;
  renderStatusFilters();
  $('#fcount').textContent = activeFilterCount(state.mode, state.filters);

  renderPager();
}

/* The status filter is mode-specific: scientific review filters on review status,
   training review on training disposition. Counts come from the query, so they move
   as work is committed. */
function renderStatusFilters() {
  const m = MODES[state.mode];
  const set = { key: m.statusKey, label: m.statusLabel, items: m.statuses };
  $('#statusLbl').textContent = set.label;
  const active = state.filters[set.key] || [];
  $('#statusFilters').innerHTML = set.items.map(([value, label]) =>
    `<button class="chk" data-status="${value}" data-key="${set.key}"
       title="Show ${label.toLowerCase()} observations">
       <span class="box ${active.includes(value) ? 'on' : ''}"></span>${label}
       <span class="n">${(state.counts[value] ?? 0).toLocaleString()}</span></button>`).join('');
  $('#statusFilters').querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.toggleStatus(b.dataset.key, b.dataset.status);
    }));
}

function renderPager() {
  const chip = (i) => `<button class="pg ${state.committedPages.has(i) ? 'done' : ''}" data-page="${i}"
      title="${state.committedPages.has(i) ? 'Committed this session' : 'Go to page ' + i}">${i}</button>`;
  const out = ['<button class="pg nav" data-page="prev" title="Previous page">&lsaquo; Prev</button>'];
  for (const slot of pageWindow(state.page, state.pageCount)) {
    if (slot === 'gap') out.push('<span class="gap">&hellip;</span>');
    else if (slot === state.page) out.push(`<input class="pg" id="pageInput" value="${slot}" title="Type a page number to jump">`);
    else out.push(chip(slot));
  }
  out.push('<button class="pg nav" data-page="next" title="Next page">Next &rsaquo;</button>');
  $('#pager').innerHTML = out.join('');
}

function renderLog() {
  $('#logList').innerHTML = getLog().slice(0, 60).map((e) => {
    const d = e.detail ? JSON.stringify(e.detail).replace(/[{}"]/g, '').slice(0, 60) : '';
    return `<li><span class="t">${e.at.toTimeString().slice(0, 8)}</span>
              <span class="n">${e.name}</span><span class="d">${d}</span></li>`;
  }).join('');
}

/* ---------------------------------------------------------------- wiring */

export function mount() {
  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => actions.setMode(b.dataset.mode)));

  $('#railbtn').addEventListener('click', () => actions.toggleRail());
  $('#markAll').addEventListener('click', () => actions.markAllOnPage());
  $('#clearMarks').addEventListener('click', () => actions.clearMarks());
  $('#commit').addEventListener('click', () => actions.commitPage());

  /* tile marks; badge opens the panel */
  $('#grid').addEventListener('click', (e) => {
    const badge = e.target.closest('[data-badge]');
    if (badge) { e.stopPropagation(); actions.openPicker(Number(badge.dataset.badge)); return; }
    const chip = e.target.closest('[data-changed]');
    if (chip) { e.stopPropagation(); actions.openCorrection(Number(chip.dataset.changed)); return; }
    const t = e.target.closest('.tile');
    if (t) actions.toggleMark(Number(t.dataset.id));   // no stopPropagation: the
    /* document handler below still runs and closes any open panel */
  });

  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    const v = b.dataset.page;
    actions.goToPage(v === 'prev' ? state.page - 1 : v === 'next' ? state.page + 1 : Number(v));
  });
  $('#pager').addEventListener('change', (e) => {
    if (e.target.id === 'pageInput') actions.goToPage(Number(e.target.value));
  });

  const anchor = (id, fn) => $(id).addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenuEl) { closeMenus(); return; }
    fn(e.currentTarget);
  });
  anchor('#selSpeciesBtn', speciesMenu);
  anchor('#selProjectBtn', projectMenu);
  anchor('#selModelBtn', modelMenu);
  anchor('#sortBtn', sortMenu);
  anchor('#userBtn', userMenu);

  $('#logbtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const log = $('#log');
    log.hidden = !log.hidden;
    $('#logbtn').textContent = log.hidden ? 'Action log' : 'Hide log';
  });

  /* 6: clicking anywhere else dismisses the panel and any open menu */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pick')) actions.closePicker();
    if (!e.target.closest('.menu')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { actions.closePicker(); closeMenus(); }
  });

  /* The field's real size is the only reliable input, and it changes on window
     resize and on rail collapse alike — so observe it rather than guessing when
     layout has settled. */
  let t;
  const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(computeLayout, 90); });
  ro.observe($('#field'));

  /* Re-measure after every render. A single measurement is unreliable — the field's
     size settles after layout — and setPageSize no-ops when nothing changed, so this
     converges in one extra pass rather than looping. */
  subscribe(() => {
    renderChrome(); renderGrid(); renderPicker();
    requestAnimationFrame(computeLayout);
  });
  onLog(renderLog);
}
