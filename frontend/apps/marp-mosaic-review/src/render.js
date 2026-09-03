/**
 * Rendering. Reads state, writes DOM. Never mutates state directly — every
 * interaction calls a named action, so the seams stay visible.
 */
import { state, actions, subscribe, MODES, getLog, onLog } from './store.js';
import { MarpData } from './data.js';

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

const REASONS = ['Wrong species', 'False detection', 'Duplicate', 'Bounding box', 'Other / unsure'];
const markIcon = () => ({ scientific: ICON.flag, training: ICON.exc, delete: ICON.del }[state.mode]);
const markClass = () => ({ scientific: 'b-flag', training: 'b-exc', delete: 'b-del' }[state.mode]);

/* ---------------------------------------------------------------- tiles */

function tile(row) {
  const id = row.observation_id;
  const marked = state.marks.get(id);
  const changed = state.changed.get(id);
  const isActive = state.picker && state.picker.id === id;
  const doneByOther = row.review_status === 'reviewed' && !marked;

  const cls = ['tile'];
  if (marked) cls.push('marked');
  if (isActive) cls.push('active');
  if (changed) cls.push('changed');
  if (doneByOther) cls.push('done');

  if (row.thumbnail_status === 'queued') {
    return `<button class="tile queued" data-id="${id}">
        <img src="./fixtures/thumbs/marp-mark.png" alt="">
        <span class="ph-t">PREPARING</span><span class="phbar"><i></i></span></button>`;
  }
  if (row.thumbnail_status === 'failed') {
    return `<button class="tile failed" data-id="${id}">
        <span style="font-size:20px;color:#c07d85">&#9888;</span>
        <span class="na-t">NO IMAGE</span></button>`;
  }

  const thumb = String(row.thumb).padStart(2, '0');
  let badge = '';
  if (marked)          badge = `<span class="badge ${markClass()}">${markIcon()}${MODES[state.mode].mark.toUpperCase()}</span>`;
  else if (changed)    badge = `<span class="badge b-chg">${ICON.tick}CHANGED</span>`;
  else if (doneByOther) badge = `<span class="badge b-oth">${ICON.eye}${row.reviewed_by || 'REVIEWED'}</span>`;
  else if (row.training_disposition === 'promoted' && state.mode === 'training')
                       badge = `<span class="badge b-pro">${ICON.pro}PROMOTED</span>`;

  const corner = state.mode === 'training'
    ? `<span class="frames">${row.keyframe_count}f</span>`
    : (marked && marked.reason ? `<span class="reason-chip">${marked.reason}</span>`
       : changed ? `<span class="reason-chip">was ${changed.from}</span>` : '');

  return `<button class="${cls.join(' ')}" data-id="${id}">
      <img src="./fixtures/thumbs/t${thumb}.jpg" alt="${row.comname}">
      ${badge}${corner}
      <span class="cap">${row.comname}</span></button>`;
}

function renderGrid() {
  const grid = $('#grid');
  if (state.loading) {
    grid.innerHTML = Array.from({ length: state.pageSize },
      () => '<div class="tile skeleton"></div>').join('');
    return;
  }
  grid.innerHTML = state.rows.map(tile).join('');
}

/* ---------------------------------------------------------------- picker */

async function renderPicker() {
  const host = $('#picker');
  host.innerHTML = '';
  if (!state.picker || state.mode !== 'scientific') return;

  const id = state.picker.id;
  const row = state.rows.find((r) => r.observation_id === id);
  const mark = state.marks.get(id);
  if (!row || !mark) return;

  const wrongSpecies = mark.reason === 'Wrong species';
  const matches = wrongSpecies ? await MarpData.searchSpecies('') : [];

  const panel = el(`<div class="pick" role="dialog" aria-label="Flag reason">
      <h4><span class="fl">${ICON.flag}</span>Flagged<span class="opt">Reason optional</span></h4>
      <p>Already recorded. Add a reason to help whoever resolves it, or keep scanning &mdash;
         the flag stands on its own.</p>
      <div class="chips">${REASONS.map((r) =>
        `<button class="chip ${mark.reason === r ? 'on' : ''}" data-reason="${r}">
           ${mark.reason === r ? ICON.tick : ''}${r}</button>`).join('')}</div>
      ${wrongSpecies ? `<div class="correct">
        <h5>Correct the species<span class="opt">saves immediately</span></h5>
        <input class="search" id="spSearch" placeholder="Search MARP taxonomy&hellip;" autocomplete="off">
        <div class="sugghead">Matches &middot; MARP taxonomy</div>
        <div id="spList">${matches.map((s) =>
          `<button class="srow" data-species="${s.species_id}">${s.comname}
             <span class="sci">${s.species}</span></button>`).join('')}</div></div>` : ''}
      <div class="consq ${wrongSpecies ? 'ok' : ''}">${wrongSpecies
        ? 'The correction <b>saves immediately</b> and is recorded against your name. The flag stays until you resolve it.'
        : 'False detection <b>removes this observation from accepted scientific results</b>. The other reasons are advisory.'}</div>
      <div class="pickfoot">
        <button class="ghost" data-act="unmark">Remove flag</button>
        <button class="ghost" data-act="video">Open video</button>
        ${wrongSpecies ? '<button class="ghost go" data-act="resolve">Mark resolved</button>' : ''}
      </div></div>`);

  host.appendChild(panel);

  /* Anchor to the tile: below it by preference, above when there is no room, and
     clamped inside the field when it fits neither — a tall panel on a middle row
     fits nowhere, and must never be positioned off-screen. */
  const tileEl = $(`.tile[data-id="${id}"]`);
  const field = $('#field');
  if (tileEl) {
    const t = tileEl.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    const GAP = 10, EDGE = 8;

    panel.style.maxHeight = (f.height - EDGE * 2) + 'px';
    panel.style.overflowY = 'auto';
    const h = Math.min(panel.offsetHeight, f.height - EDGE * 2);

    const below = t.bottom - f.top + GAP;
    const above = t.top - f.top - h - GAP;
    let top;
    if (below + h <= f.height - EDGE) top = below;        // preferred
    else if (above >= EDGE) top = above;                  // flipped
    else top = Math.max(EDGE, f.height - h - EDGE);       // clamped

    panel.style.top = top + 'px';
    panel.style.left = Math.min(
      Math.max(EDGE, t.left - f.left - 140),
      Math.max(EDGE, f.width - panel.offsetWidth - EDGE)
    ) + 'px';
  }

  panel.querySelectorAll('[data-reason]').forEach((b) =>
    b.addEventListener('click', () => actions.setReason(id, b.dataset.reason)));
  panel.querySelectorAll('[data-species]').forEach((b) =>
    b.addEventListener('click', () => actions.changeSpecies(id, Number(b.dataset.species))));
  panel.querySelector('[data-act="unmark"]').addEventListener('click', () => actions.toggleMark(id));
  panel.querySelector('[data-act="video"]').addEventListener('click', () => actions.openVideo(id));
  const res = panel.querySelector('[data-act="resolve"]');
  if (res) res.addEventListener('click', () => actions.resolve(id));

  const search = panel.querySelector('#spSearch');
  if (search) {
    search.addEventListener('input', async () => {
      const list = await MarpData.searchSpecies(search.value);
      panel.querySelector('#spList').innerHTML = list.map((s) =>
        `<button class="srow" data-species="${s.species_id}">${s.comname}
           <span class="sci">${s.species}</span></button>`).join('');
      panel.querySelectorAll('[data-species]').forEach((b) =>
        b.addEventListener('click', () => actions.changeSpecies(id, Number(b.dataset.species))));
    });
  }
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
  const willAct = state.mode === 'delete' ? markedCount : eligible - markedCount;

  $('#shown').textContent = state.loading ? '…' : state.rows.length;
  $('#total').textContent = state.total.toLocaleString();
  $('#markedCount').textContent = markedCount;
  $('#markWord').textContent = MODES[state.mode].mark;

  $('#commit').innerHTML = `${MODES[state.mode].commit} &middot; ${willAct} tiles`;
  $('#footCount').textContent = `${markedCount} ${MODES[state.mode].mark.toLowerCase()}`;
  $('#markAll').textContent = `${MODES[state.mode].verb} all on page`;
  $('#fcount').textContent = Object.values(state.filters).filter(
    (v) => v != null && (!Array.isArray(v) || v.length)).length;

  renderPager();
}

function renderPager() {
  const { page, pageCount } = state, span = 2, out = [];
  const chip = (i) => `<button class="pg ${state.committedPages.has(i) ? 'done' : ''}" data-page="${i}">${i}</button>`;
  out.push('<button class="pg nav" data-page="prev">&lsaquo; Prev</button>');
  const lo = Math.max(1, page - span), hi = Math.min(pageCount, page + span);
  if (lo > 1) { out.push(chip(1)); if (lo > 2) out.push('<span class="gap">&hellip;</span>'); }
  for (let i = lo; i <= hi; i++) {
    out.push(i === page ? `<input class="pg" id="pageInput" value="${i}" aria-label="Current page">` : chip(i));
  }
  if (hi < pageCount) { if (hi < pageCount - 1) out.push('<span class="gap">&hellip;</span>'); out.push(chip(pageCount)); }
  out.push('<button class="pg nav" data-page="next">Next &rsaquo;</button>');
  $('#pager').innerHTML = out.join('');
}

/* ---------------------------------------------------------------- log */

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

  $('#grid').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (t) actions.toggleMark(Number(t.dataset.id));
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

  $('#logbtn').addEventListener('click', () => {
    const log = $('#log');
    log.hidden = !log.hidden;
    $('#logbtn').textContent = log.hidden ? 'Action log' : 'Hide log';
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') actions.closePicker(); });

  subscribe(() => { renderChrome(); renderGrid(); renderPicker(); });
  onLog(renderLog);
}
