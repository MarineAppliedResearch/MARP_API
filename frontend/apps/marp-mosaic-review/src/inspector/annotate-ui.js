/**
 * The video page's two annotation surfaces (#181): the species popup that opens beside a box
 * just drawn, and the panel for the selected box.
 *
 * **The popup is the add.** Isaac, 2026-10-06: "focus on usability and making this as easy
 * as possible for the user to add". So it opens where the box was drawn, already focused,
 * offering the species used most recently before anything is typed: drawing a box and one
 * click -- or Enter -- makes the observation. When an observation is selected, its first
 * option is to add the box to that one instead (R2). The session defaults to the opened
 * observation's and is only asked about when the video has more than one (A8).
 *
 * **The panel is the rest** (R7): species, count, identifiers and keyframes of the selected
 * observation, and what can be done to it.
 *
 * DOM only; every decision is the caller's. Text goes in through `textContent`, never markup.
 */
import { MarpApi } from '../api/index.js';
import { withRecent } from '../model/box-edit.js';

/* A search is worth sending from two characters, as the Mosaic's own species picker. */
const MIN_TERM = 2;

const RECENT_KEY = 'marp-video-recent-species';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* The recently used species, per species list; this viewer's convenience, so browser storage. */
export function recentSpecies(list) {
  try {
    return JSON.parse(localStorage.getItem(`${RECENT_KEY}:${list || ''}`) || '[]');
  } catch {
    return [];
  }
}

export function rememberSpecies(list, species) {
  try {
    localStorage.setItem(`${RECENT_KEY}:${list || ''}`, JSON.stringify(withRecent(recentSpecies(list), species)));
  } catch {
    // A private window: the popup works, it just does not remember.
  }
}

/**
 * Open the species popup beside a box.
 *
 * @param {Object} options
 * @param {HTMLElement} options.popup - The popup's element, filled and placed here.
 * @param {{left: number, top: number, width: number, height: number}} options.at - The box,
 *   in the popup's container's pixels.
 * @param {string} options.title
 * @param {Array<Object>} [options.sessions] - To choose from, `{ session_id, dive, line, species_list }`.
 * @param {number} [options.sessionId] - The one chosen first.
 * @param {string} [options.list] - The species list when there is no session to choose.
 * @param {string} [options.extendLabel] - Offer "add to the selected observation" first.
 * @param {Function} options.onPick - `({ species, sessionId })`.
 * @param {Function} [options.onExtend]
 * @param {Function} options.onCancel
 */
export function openSpeciesPopup({ popup, at, title, sessions = [], sessionId, list, extendLabel, onPick, onExtend, onCancel }) {
  let chosenSession = sessionId;
  let results = [];
  let searchToken = 0;
  const listOf = () => {
    const session = sessions.find((s) => s.session_id === chosenSession);
    return session ? session.species_list : list;
  };

  const close = () => {
    popup.hidden = true;
    popup.replaceChildren();
    document.removeEventListener('keydown', onKey, true);
  };
  const cancel = () => { close(); onCancel(); };
  const pick = (species) => {
    rememberSpecies(listOf(), species);
    close();
    onPick({ species, sessionId: chosenSession });
  };

  const head = element('div', 'annotate-head');
  head.append(element('strong', null, title));
  const closer = element('button', 'annotate-close', '×');
  closer.type = 'button';
  closer.setAttribute('aria-label', 'Cancel');
  closer.addEventListener('click', cancel);
  head.append(closer);
  popup.replaceChildren(head);

  if (extendLabel && onExtend) {
    const extend = element('button', 'annotate-extend', extendLabel);
    extend.type = 'button';
    extend.dataset.action = 'extend';
    extend.addEventListener('click', () => { close(); onExtend(); });
    popup.append(extend);
  }

  if (sessions.length > 1) {
    const label = element('label', 'annotate-session', 'Session ');
    const select = document.createElement('select');
    for (const session of sessions) {
      const option = element('option', null, [session.dive, session.line].filter(Boolean).join(' · ') || `Session ${session.session_id}`);
      option.value = String(session.session_id);
      option.selected = session.session_id === chosenSession;
      select.append(option);
    }
    select.addEventListener('change', () => {
      chosenSession = Number(select.value);
      show(input.value);
    });
    label.append(select);
    popup.append(label);
  }

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Species…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Species');
  const list_ = element('div', 'annotate-results');
  list_.setAttribute('role', 'listbox');
  popup.append(input, list_);

  function render(items, note) {
    results = items;
    list_.replaceChildren(...items.map((species, index) => {
      const button = element('button', 'annotate-species');
      button.type = 'button';
      button.dataset.speciesId = String(species.id);
      button.setAttribute('role', 'option');
      button.append(element('span', 'name', species.comname || `Species ${species.id}`));
      if (species.species) button.append(element('span', 'sci', species.species));
      if (index === 0) button.classList.add('first');
      button.addEventListener('click', () => pick(species));
      return button;
    }));
    if (note) list_.append(element('p', 'annotate-note', note));
  }

  async function show(term) {
    const mine = ++searchToken;
    const q = String(term || '').trim();
    if (q.length < MIN_TERM) {
      const recent = recentSpecies(listOf());
      render(recent, recent.length ? null : 'Type a species name.');
      return;
    }
    try {
      const found = await MarpApi.searchSpecies(q, { list: listOf() });
      if (mine === searchToken) render(found.slice(0, 12), found.length ? null : 'No species matches that.');
    } catch (error) {
      if (mine === searchToken) render([], `The search failed: ${error.message}`);
    }
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
    } else if (event.key === 'Enter' && document.activeElement === input && results.length) {
      event.preventDefault();
      pick(results[0]);
    }
  }

  input.addEventListener('input', () => show(input.value));
  document.addEventListener('keydown', onKey, true);

  popup.hidden = false;
  // Beside the box, inside the player, wherever there is room.
  const host = (popup.offsetParent || popup.parentElement).getBoundingClientRect();
  const right = at.left + at.width + 8;
  const left = right + popup.offsetWidth <= host.width ? right : Math.max(0, at.left - popup.offsetWidth - 8);
  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(0, Math.min(at.top, host.height - popup.offsetHeight))}px`;
  show('');
  input.focus();
  return { close };
}

/**
 * Fill the panel for the selected observation, or hide it.
 *
 * @param {HTMLElement} panel
 * @param {Object|null} model - `{ row, colour, session, keyframes, canWrite, canDelete }`, or
 *   null for no selection.
 * @param {Object} on - `{ rename, count, merge, picture, remove, seek, close }`.
 */
export function renderPanel(panel, model, on) {
  if (!model) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }
  const { row, colour, session, keyframes, canWrite, canDelete } = model;
  const head = element('div', 'annotate-head');
  const swatch = element('span', 'swatch');
  swatch.style.background = colour;
  head.append(swatch, element('strong', 'panel-name', row.comname || 'Unknown'));
  const closer = element('button', 'annotate-close', '×');
  closer.type = 'button';
  closer.setAttribute('aria-label', 'Close');
  closer.addEventListener('click', on.close);
  head.append(closer);

  const facts = element('dl', 'panel-facts');
  const fact = (term, value) => facts.append(element('dt', null, term), element('dd', null, value));
  fact('Obs ID', `${row.obs_id ?? '?'}  ·  ${row.observation_id}`);
  if (session) fact('Session', [session.dive, session.line].filter(Boolean).join(' · ') || String(session.session_id));

  const count = document.createElement('input');
  count.type = 'number';
  count.min = '1';
  count.step = '1';
  count.value = String(row.count ?? 1);
  count.disabled = !canWrite;
  count.className = 'panel-count';
  count.setAttribute('aria-label', 'Count');
  const saveCount = () => {
    const value = Number(count.value);
    if (Number.isInteger(value) && value >= 1 && value !== row.count) on.count(value);
  };
  count.addEventListener('change', saveCount);
  count.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveCount(); });
  facts.append(element('dt', null, 'Count'));
  const countCell = element('dd');
  countCell.append(count);
  facts.append(countCell);

  const list = element('ol', 'panel-keyframes');
  for (const keyframe of keyframes) {
    const item = element('li');
    const jump = element('button', null, `${keyframe.type}  ${keyframe.t.toFixed(2)} s`);
    jump.type = 'button';
    jump.addEventListener('click', () => on.seek(keyframe.t));
    item.append(jump);
    list.append(item);
  }

  const actions = element('div', 'panel-actions');
  const action = (label, name, handler, enabled = true) => {
    const button = element('button', null, label);
    button.type = 'button';
    button.dataset.action = name;
    button.disabled = !enabled;
    button.addEventListener('click', handler);
    actions.append(button);
  };
  action('Change species…', 'rename', on.rename, canWrite);
  action('Use this frame for the Mosaic picture', 'picture', on.picture);
  action('Merge another observation into this one…', 'merge', on.merge, canWrite);
  if (canDelete) action('Delete observation…', 'remove', on.remove);

  panel.replaceChildren(head, facts, element('div', 'panel-label', 'Keyframes'), list, actions);
  panel.hidden = false;
}
