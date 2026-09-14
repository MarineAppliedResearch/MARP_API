/**
 * The panel that opens from a tile's badge: reasons, species correction, resolve.
 *
 * It anchors to the tile rather than covering the mosaic, so the reviewer keeps
 * their place. Marking already happened before this opened — choosing a reason is
 * genuinely optional, and the copy says so.
 */
import { state, actions, MODES } from '../store.js';
import { acceptedValue, existingNote, existingReason, existingState, markKind, MARK_EXCEPT } from '../model/modes.js';
import { $, el, ICON } from './dom.js';
import { acceptIcon, markIcon } from './tile.js';

const NOTE_LIMIT = 1000;

/**
 * One candidate species.
 *
 * `data-species` is **`s.id`**, the `species.id` the correction route takes — "not
 * taxserial, and not the species_id the fixture keys its catalogue on". The fixture's own
 * catalogue calls it `species_id`, so both are read: the field name is the one thing the
 * two backings genuinely spell differently, and it is a catalogue rather than a mosaic row
 * so it is outside A1's rename.
 *
 * `showList` draws which list the candidate is on, and it is **only true for a widened
 * search** (#130 A3). A common name is not unique across the seven lists — `Red sea
 * urchin` is one entry on `Inverts` and a different organism on `GULF_Inverts` — so a
 * widened result without its list lets a reviewer silently correct onto the wrong list,
 * and a correction is written to the record. A scoped result is all one list by
 * construction, so labelling every row with it would be noise.
 */
const speciesRow = (s, showList = false) =>
  `<button class="srow" data-species="${s.id != null ? s.id : s.species_id}">${s.comname}
  <span class="sci">${s.species}</span>${(showList && s.species_list)
    ? `<span class="slist">${s.species_list}</span>` : ''}</button>`;

/**
 * How many characters before a search is worth sending.
 *
 * Two, and it is a decision rather than a default. `searchSpecies('')` used to fill the
 * panel with six entries before anything was typed, and the route **rejects an empty `q`
 * with a 400** — deliberately, because "an empty search returning all 224 entries reads as
 * a working search" (F14). So there is nothing to show at zero characters, and saying so
 * is better than showing six arbitrary organisms.
 */
const MIN_SEARCH = 2;

/**
 * What the results are scoped to, said out loud.
 *
 * It **names the list** rather than saying "this observation's list", and where the
 * session type names none it says that instead of implying a scope that does not exist
 * (#130 R5). The heading is the only place the reviewer can read what they are searching.
 */
const scopeLabel = (list, widen) =>
  widen ? 'Matches &middot; the whole MARP taxonomy'
    : list ? `Matches &middot; ${list}`
      : 'Matches &middot; no list for this session type';

function bindSpecies(panel, id) {
  panel.querySelectorAll('[data-species]').forEach((b) =>
    b.addEventListener('click', () => actions.changeSpecies(id, Number(b.dataset.species))));
}

/**
 * Below the tile by preference, above when there is no room, and clamped inside the
 * field when it fits neither — a tall panel on a middle row fits nowhere, and must
 * never be positioned off-screen.
 */
function position(panel, id) {
  const tileEl = $(`.tile[data-id="${id}"]`), field = $('#field');
  if (!tileEl) return;
  const GAP = 10, EDGE = 8;

  if (window.matchMedia('(max-width: 760px)').matches) {
    const viewport = window.visualViewport;
    const top = viewport ? viewport.offsetTop : 0;
    const left = viewport ? viewport.offsetLeft : 0;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;
    panel.style.position = 'fixed';
    panel.style.top = (top + EDGE) + 'px';
    panel.style.left = (left + EDGE) + 'px';
    panel.style.width = Math.max(0, width - EDGE * 2) + 'px';
    panel.style.maxHeight = Math.max(0, height - EDGE * 2) + 'px';
    panel.style.overflowY = 'auto';
    return;
  }

  const t = tileEl.getBoundingClientRect(), f = field.getBoundingClientRect();

  panel.style.maxHeight = (f.height - EDGE * 2) + 'px';
  panel.style.overflowY = 'auto';
  const h = Math.min(panel.offsetHeight, f.height - EDGE * 2);
  const below = t.bottom - f.top + GAP;
  const above = t.top - f.top - h - GAP;

  panel.style.top = (below + h <= f.height - EDGE ? below
                    : above >= EDGE ? above
                    : Math.max(EDGE, f.height - h - EDGE)) + 'px';
  panel.style.left = Math.min(Math.max(EDGE, t.left - f.left - 140),
                              Math.max(EDGE, f.width - panel.offsetWidth - EDGE)) + 'px';
}

/** The line that says what the choice actually does. */
function consequence(mode, correcting) {
  if (correcting) {
    return ['ok', 'The correction <b>saves immediately</b> and is recorded against your name. '
      + 'This panel closes; the mark stays until you resolve it.'];
  }
  if (mode === 'training') {
    return ['', 'Excluding is <b>a deliberate decision, not the absence of one</b>. '
      + 'It is recorded with its reason and can be reconsidered.'];
  }
  return ['', 'False detection <b>removes this observation from accepted scientific results</b>. '
    + 'The other reasons are advisory.'];
}

/** Keep the focused editor inside the keyboard-reduced visual viewport. */
function repositionForViewport() {
  if (!state.picker) return;
  const panel = $('#picker .pick');
  if (!panel) return;
  position(panel, state.picker.id);
  const note = panel.querySelector('.decision-note:focus');
  if (note) note.scrollIntoView({ block: 'center', inline: 'nearest' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => requestAnimationFrame(repositionForViewport));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => requestAnimationFrame(repositionForViewport));
    window.visualViewport.addEventListener('scroll', () => requestAnimationFrame(repositionForViewport));
  }
}

let renderSeq = 0;

export async function renderPicker() {
  const host = $('#picker');
  if (!state.picker || state.mode === 'delete') { host.innerHTML = ''; return; }

  const { id, correcting } = state.picker;
  const openPanel = host.querySelector('.pick');
  const focusedNote = openPanel && openPanel.querySelector('#decisionNote:focus');
  /* Layout, prefetch and other state changes can repaint while somebody types. Keep the
     active editor itself alive; replacing it makes a phone keyboard move or disappear. */
  if (focusedNote && Number(openPanel.dataset.pickerId) === id) {
    position(openPanel, id);
    return;
  }
  const row = state.rows.find((r) => r.observation_id === id);
  if (!row) { host.innerHTML = ''; return; }
  const staged = state.marks.get(id);
  const decision = staged
    ? (markKind(staged) === MARK_EXCEPT ? MODES[state.mode].marks : acceptedValue(state.mode))
    : existingState(state.mode, row);
  if (!decision) { host.innerHTML = ''; return; }

  const m = MODES[state.mode];
  const isException = decision === m.marks;
  const mark = staged || {
    kind: isException ? MARK_EXCEPT : 'accept',
    reason: isException ? existingReason(state.mode, row) : null,
    note: existingNote(state.mode, row)
  };
  /* Fetch first, clear second. Blanking the panel and then awaiting the taxonomy
     left it missing for the length of the request, which looked like the panel
     closing and reopening by itself.
     **Nothing is fetched to open the panel**: see MIN_SEARCH. */
  const token = ++renderSeq;
  const matches = [];
  if (token !== renderSeq) return;                    // a newer render already won
  if (!state.picker || state.picker.id !== id) { host.innerHTML = ''; return; }
  host.innerHTML = '';
  const [consqClass, consqText] = isException
    ? consequence(state.mode, correcting)
    : ['', `This note will be recorded with the ${decision} decision when you commit it.`];
  const label = decision.charAt(0).toUpperCase() + decision.slice(1);
  const reasonControls = isException ? `<div class="chips">${m.reasons.map((r) =>
    `<button class="chip ${mark.reason === r ? 'on' : ''}" data-reason="${r}"
       title="Record this as the reason">${mark.reason === r ? ICON.tick : ''}${r}</button>`).join('')}
    <button class="chip change ${correcting ? 'on' : ''}" data-act="correct"
      title="Change this observation's species">Change species&hellip;</button>
  </div>` : '';

  const panel = el(`<div class="pick" data-picker-id="${id}" role="dialog" aria-label="${label} details">
      <h4><span class="fl">${isException ? markIcon() : acceptIcon()}</span>${label}<span class="opt">Details optional</span></h4>
      <p>Changes here stay pending until you use one of the existing commit controls.</p>
      ${reasonControls}
      ${correcting && isException ? `<div class="correct">
        <h5>Correct the species<span class="opt">saves immediately</span></h5>
        <input class="search" id="spSearch" placeholder="Type two letters to search&hellip;" autocomplete="off">
        <!-- Scoped to the observation's own annotation list, with an explicit action to
             widen (A11, R17). A common name identifies a species only *within* a list, so
             an unscoped search can offer two different organisms under one label. Widening
             is how an off-list correction stays possible but deliberate -- and it is the
             only path for an observation whose session type maps to no list at all. -->
        <div class="sugghead"><span id="spScope">${scopeLabel(row.species_list, false)}</span>
          <button type="button" class="widen" data-act="widen"
            title="Search the whole MARP taxonomy, not only this observation's list">Search all lists</button></div>
        <div id="spList">${matches.map((s) => speciesRow(s)).join('')}</div></div>` : ''}
      <label class="note-label" for="decisionNote">Note <span class="opt"><span data-note-count>0</span> / ${NOTE_LIMIT}</span></label>
      <textarea class="decision-note" id="decisionNote" rows="4"
        placeholder="Add an optional note about this decision"></textarea>
      <div class="consq ${consqClass}">${consqText}</div>
      <div class="pickfoot">
        ${isException ? `<button class="ghost" data-act="unmark" title="Remove the mark entirely">Remove ${m.mark.toLowerCase()}</button>` : ''}
        ${isException && state.mode === 'scientific'
          ? '<button class="ghost" data-act="replace-thumbnail" title="Clear this pending flag and ask for a different crop">Request replacement image</button>'
          : ''}
        <button class="ghost" data-act="video" title="Open the source video at this observation">Open video</button>
        ${isException ? '<button class="ghost go" data-act="resolve" title="Clear the mark, keeping any correction">Mark resolved</button>'
          : '<button class="ghost go" data-act="close">Close</button>'}
      </div></div>`);

  host.appendChild(panel);
  const note = panel.querySelector('#decisionNote');
  const count = panel.querySelector('[data-note-count]');
  note.value = mark.note || '';
  count.textContent = String(Array.from(note.value).length);
  if (state.picker.noteCursor != null) {
    note.focus();
    note.setSelectionRange(state.picker.noteCursor, state.picker.noteCursor);
  }
  note.addEventListener('input', () => {
    const characters = Array.from(note.value);
    if (characters.length > NOTE_LIMIT) note.value = characters.slice(0, NOTE_LIMIT).join('');
    count.textContent = String(Array.from(note.value).length);
    actions.setNote(id, note.value, { cursor: note.selectionStart });
  });
  note.addEventListener('focus', () => requestAnimationFrame(repositionForViewport));
  position(panel, id);

  panel.querySelectorAll('[data-reason]').forEach((b) =>
    b.addEventListener('click', () => actions.setReason(id, b.dataset.reason)));
  bindSpecies(panel, id);
  const correct = panel.querySelector('[data-act="correct"]');
  if (correct) correct.addEventListener('click', () => actions.toggleCorrecting(id));
  const unmark = panel.querySelector('[data-act="unmark"]');
  if (unmark) unmark.addEventListener('click', () => actions.toggleMark(id));
  const replace = panel.querySelector('[data-act="replace-thumbnail"]');
  if (replace) replace.addEventListener('click', () => actions.requestThumbnailReplacement(id));
  panel.querySelector('[data-act="video"]').addEventListener('click', () => actions.openVideo(id));
  const resolve = panel.querySelector('[data-act="resolve"]');
  if (resolve) resolve.addEventListener('click', () => actions.resolve(id));
  const close = panel.querySelector('[data-act="close"]');
  if (close) close.addEventListener('click', () => actions.closePicker());

  const search = panel.querySelector('#spSearch');
  if (search) {
    search.focus();

    /* Whether this search is over the whole catalogue. Panel-local rather than in the
       store: it is how a control is being used, not part of the question. */
    let widen = false;
    let searchSeq = 0;

    /* Whether a scoped search can be asked at all. The list is the owning session's and
       the server sends it; `Other` names no list, and for those rows only a widened search
       can return anything. Kept apart from "nothing matched" because they are different
       facts and the panel used to state the wrong one (#130 R5). */
    const scoped = row.species_list || null;

    const draw = async () => {
      const term = search.value.trim();
      const listEl = panel.querySelector('#spList');
      const mine = ++searchSeq;

      if (!widen && !scoped) {
        /* Nothing is sent, and saying "nothing matches" here would be a lie about the
           catalogue rather than a fact about this observation. */
        listEl.innerHTML = '<div class="mnote">This observation’s session type names no '
          + 'species list, so there is nothing to search within. Use “Search all '
          + 'lists”.</div>';
        return;
      }

      if (term.length < MIN_SEARCH) {
        /* Nothing is sent. The route refuses an empty `q` and a one-letter search over a
           taxonomy is a list nobody can read. */
        listEl.innerHTML = `<div class="mnote">Type ${MIN_SEARCH} letters to search.</div>`;
        return;
      }

      const found = await actions.searchSpecies(term, { widen });
      if (mine !== searchSeq) return;                 // a newer keystroke already won
      listEl.innerHTML = found.length
        ? found.map((s) => speciesRow(s, widen)).join('')
        : (widen
          ? '<div class="mnote">Nothing in the MARP taxonomy matches.</div>'
          : `<div class="mnote">Nothing on ${scoped} matches. Try “Search all
             lists”.</div>`);
      bindSpecies(panel, id);
    };

    search.addEventListener('input', draw);

    const widenBtn = panel.querySelector('[data-act="widen"]');
    if (widenBtn) {
      widenBtn.addEventListener('click', () => {
        widen = !widen;
        widenBtn.classList.toggle('on', widen);
        widenBtn.textContent = widen ? 'Back to this list' : 'Search all lists';
        const scope = panel.querySelector('#spScope');
        if (scope) scope.innerHTML = scopeLabel(scoped, widen);
        draw();
      });
    }

    draw();
  }
}
