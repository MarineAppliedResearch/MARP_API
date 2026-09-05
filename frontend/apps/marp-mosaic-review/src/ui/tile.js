/**
 * One tile.
 *
 * A tile has to show three different things at once without confusing them: what
 * the record already carries, what this reviewer marked but has not committed, and
 * what the last commit did. Everything here is derived; nothing is stored.
 */
import { state, MODES } from '../store.js';
import { existingState, decidedBy, pendingException } from '../model/modes.js';
import { ICON, ME } from './dom.js';

export const markIcon = (mode = state.mode) =>
  ({ scientific: ICON.flag, training: ICON.exc, delete: ICON.del }[mode]);

export const markClass = (mode = state.mode) =>
  ({ scientific: 'b-flag', training: 'b-exc', delete: 'b-del' }[mode]);

/** What the last commit did to this observation. */
function outcomeBadge(outcome, row, id) {
  switch (outcome) {
    case 'flagged':  return `<span class="badge b-flag" data-badge="${id}"
      title="Flagged${row.flag_reason ? ' — ' + row.flag_reason : ''}">${ICON.flag}FLAGGED</span>`;
    case 'excluded': return `<span class="badge b-exc" data-badge="${id}"
      title="Excluded${row.exclusion_reason ? ' — ' + row.exclusion_reason : ''}">${ICON.exc}EXCLUDED</span>`;
    case 'reverted': return `<span class="badge b-rev">${markIcon()}TAKEN BACK</span>`;
    case 'deleted':  return `<span class="badge b-gone">${ICON.del}DELETED</span>`;
    /* b-pro, not b-out: promotion is a training decision and wears training's
       violet. Reusing the reviewed badge made the two read as the same answer. */
    case 'promoted': return `<span class="badge b-pro">${ICON.pro}PROMOTED</span>`;
    case 'reviewed': return `<span class="badge b-out">${ICON.tick}REVIEWED</span>`;
    default: return '';
  }
}

/** What the record already carried before this reviewer touched it. */
function existingBadge(existing, row, id, byMe) {
  const who = byMe ? ' &middot; you' : '';
  switch (existing) {
    case 'flagged':  return `<span class="badge b-flag" data-badge="${id}"
      title="Flagged${row.flag_reason ? ' — ' + row.flag_reason : ''}${who ? ', by you' : ''}">${ICON.flag}FLAGGED${who}</span>`;
    case 'excluded': return `<span class="badge b-exc">${ICON.exc}EXCLUDED${who}</span>`;
    case 'promoted': return `<span class="badge b-pro">${ICON.pro}PROMOTED${who}</span>`;
    default: return byMe
      ? `<span class="badge b-out">${ICON.tick}REVIEWED &middot; you</span>`
      : `<span class="badge b-oth">${ICON.eye}${row.reviewed_by || 'REVIEWED'}</span>`;
  }
}

/** The top-right chip: track length in training, otherwise the reason or correction. */
function corner(row, id, { marked, changed, existing, outcome }) {
  /* Track length is what you judge a candidate on — but once it is excluded it is
     not going into the training set at all, so the reason is the more useful chip. */
  if (state.mode === 'training') {
    const why = (marked && marked.reason) || (existing === 'excluded' && row.exclusion_reason)
      || (outcome === 'excluded' && row.exclusion_reason);
    return why
      ? `<span class="reason-chip" title="${row.keyframe_count} frames">${why}</span>`
      : `<span class="frames">${row.keyframe_count}f</span>`;
  }

  if (marked && marked.reason) return `<span class="reason-chip">${marked.reason}</span>`;

  /* A correction is clickable: it reopens the chooser on the tile it belongs to. */
  if (changed || row.previous_comname) {
    const was = (changed && changed.from) || row.previous_comname;
    return `<span class="reason-chip" data-changed="${id}"
      title="Change the species again">was ${was}</span>`;
  }
  if ((existing === 'flagged' || outcome === 'flagged') && row.flag_reason) {
    return `<span class="reason-chip">${row.flag_reason}</span>`;
  }
  if ((existing === 'excluded' || outcome === 'excluded') && row.exclusion_reason) {
    return `<span class="reason-chip">${row.exclusion_reason}</span>`;
  }
  return '';
}

/**
 * An unavailable image is still an observation: it keeps its name and stays
 * markable. It is only excluded from the bulk commit, which is a separate rule.
 */
function body(row) {
  if (row.thumbnail_status === 'ready') {
    return `<img src="./fixtures/thumbs/t${String(row.thumb).padStart(2, '0')}.jpg" alt="${row.comname}">`;
  }
  if (row.thumbnail_status === 'queued') {
    return `<span class="fallback"><img src="./fixtures/thumbs/marp-mark.png" alt="">
      <span class="ph-t">PREPARING</span><span class="phbar"><i></i></span></span>`;
  }
  return `<span class="fallback"><span style="font-size:20px;color:#c07d85">&#9888;</span>
    <span class="na-t">NO IMAGE</span></span>`;
}

export function tile(row) {
  const id = row.observation_id;
  const marked = state.marks.get(id);
  const changed = state.changed.get(id);
  const outcome = state.outcomes.get(id);
  const existing = existingState(state.mode, row);
  const showExisting = existing && !marked && !outcome;

  /* The record still carries this mode's exception, but the reviewer has taken the
     mark off and not committed yet. Showing FLAGGED there would deny the click ever
     happened; showing nothing would hide a flag that is still on the record. */
  const exception = pendingException(state.mode);
  const takingBack = !marked && exception && state.touched.has(id)
    && (outcome === exception || existing === exception);
  const byMe = decidedBy(row) === ME;
  const noImage = row.thumbnail_status !== 'ready';

  const cls = ['tile'];
  if (row.thumbnail_status === 'queued') cls.push('queued');
  if (row.thumbnail_status === 'failed') cls.push('failed');
  if (marked) cls.push('marked');
  if (state.picker && state.picker.id === id) cls.push('active');
  if (changed) cls.push('changed');
  /* A mark outranks the last commit. Once the reviewer touches a committed tile
     they are editing it, and the screen has to show the new intention rather than
     the old answer — otherwise the click appears to do nothing at all. */
  if (takingBack) cls.push('out-reverted');
  else if (outcome && !marked) cls.push('out-' + outcome);
  else if (showExisting) cls.push('has-' + existing);

  /* The badge is its own control: tapping the tile marks, tapping the badge opens
     the panel. That keeps marking a single uninterrupted gesture. */
  const badge = takingBack
      ? `<span class="badge b-rev" title="Not committed yet — the next commit accepts it">${markIcon()}TAKING BACK</span>`
    : marked ? `<span class="badge ${markClass()}" data-badge="${id}"
        title="Open reason and correction options">${markIcon()}${MODES[state.mode].mark.toUpperCase()}</span>`
    : outcome ? outcomeBadge(outcome, row, id)
    : showExisting ? existingBadge(existing, row, id, byMe)
    /* A correction is not this mode's business, so it only claims the badge when
       the mode has nothing of its own to say. It always keeps the corner chip. */
    : changed ? `<span class="badge b-chg">${ICON.tick}CHANGED</span>`
    : '';

  const tip = noImage
    ? `${row.comname} · no image — markable, but excluded from the page commit`
    : `${row.comname} · ${row.confidence} · ${row.dive} line ${row.line} · ${row.tc}`;

  return `<button class="${cls.join(' ')}" data-id="${id}" title="${tip}">
      ${body(row)}${badge}${corner(row, id, { marked, changed, existing, outcome })}
      <span class="cap">${row.comname}</span></button>`;
}
