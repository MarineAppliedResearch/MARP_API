/**
 * The panel that opens from a tile's badge: reasons, species correction, resolve.
 *
 * It anchors to the tile rather than covering the mosaic, so the reviewer keeps
 * their place. Marking already happened before this opened — choosing a reason is
 * genuinely optional, and the copy says so.
 */
import { state, actions, MODES } from '../store.js';
import { MarpData } from '../data.js';
import { $, el, ICON } from './dom.js';
import { markIcon } from './tile.js';

const speciesRow = (s) => `<button class="srow" data-species="${s.species_id}">${s.comname}
  <span class="sci">${s.species}</span></button>`;

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
  const t = tileEl.getBoundingClientRect(), f = field.getBoundingClientRect();
  const GAP = 10, EDGE = 8;

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

let renderSeq = 0;

export async function renderPicker() {
  const host = $('#picker');
  if (!state.picker || state.mode === 'delete') { host.innerHTML = ''; return; }

  const { id, correcting } = state.picker;
  const row = state.rows.find((r) => r.observation_id === id);
  const mark = state.marks.get(id);
  if (!row || !mark) { host.innerHTML = ''; return; }

  const m = MODES[state.mode];
  /* Fetch first, clear second. Blanking the panel and then awaiting the taxonomy
     left it missing for the length of the request, which looked like the panel
     closing and reopening by itself. */
  const token = ++renderSeq;
  const matches = correcting ? await MarpData.searchSpecies('') : [];
  if (token !== renderSeq) return;                    // a newer render already won
  if (!state.picker || state.picker.id !== id) { host.innerHTML = ''; return; }
  host.innerHTML = '';
  const [consqClass, consqText] = consequence(state.mode, correcting);

  const panel = el(`<div class="pick" role="dialog" aria-label="${m.mark} options">
      <h4><span class="fl">${markIcon()}</span>${m.mark}<span class="opt">Reason optional</span></h4>
      <p>Already recorded. Add a reason to help whoever resolves it, or close this and
         keep scanning &mdash; the mark stands on its own.</p>
      <div class="chips">${m.reasons.map((r) =>
        `<button class="chip ${mark.reason === r ? 'on' : ''}" data-reason="${r}"
           title="Record this as the reason">${mark.reason === r ? ICON.tick : ''}${r}</button>`).join('')}
        <button class="chip change ${correcting ? 'on' : ''}" data-act="correct"
          title="Change this observation's species">Change species&hellip;</button>
      </div>
      ${correcting ? `<div class="correct">
        <h5>Correct the species<span class="opt">saves immediately</span></h5>
        <input class="search" id="spSearch" placeholder="Search MARP taxonomy&hellip;" autocomplete="off">
        <div class="sugghead">Matches &middot; MARP taxonomy</div>
        <div id="spList">${matches.map(speciesRow).join('')}</div></div>` : ''}
      <div class="consq ${consqClass}">${consqText}</div>
      <div class="pickfoot">
        <button class="ghost" data-act="unmark" title="Remove the mark entirely">Remove ${m.mark.toLowerCase()}</button>
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
      panel.querySelector('#spList').innerHTML = list.map(speciesRow).join('');
      bindSpecies(panel, id);
    });
  }
}
