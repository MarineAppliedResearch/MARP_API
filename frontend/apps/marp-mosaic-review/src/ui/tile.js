/**
 * One tile.
 *
 * A tile has to show three different things at once without confusing them: what
 * the record already carries, what this reviewer marked but has not committed, and
 * what the last commit did. Everything here is derived; nothing is stored.
 */
import { state, MODES } from '../store.js';
import {
  existingState, decidedByMe, pendingTakeBack, borrowedTags,
  acceptedValue, markKind, MARK_ACCEPT
} from '../model/modes.js';
import { currentSpeciesName } from '../model/row.js';
import { isDestroyed } from '../model/page.js';
import { MarpBackend } from '../backend.js';
import { ICON } from './dom.js';

export const markIcon = (mode = state.mode) =>
  ({ scientific: ICON.flag, training: ICON.exc, delete: ICON.del }[mode]);

export const markClass = (mode = state.mode) =>
  ({ scientific: 'b-flag', training: 'b-exc', delete: 'b-del' }[mode]);

/**
 * The other half of the pair, for an **accept** mark (#126 A6).
 *
 * The same class and icon the mode's accepted value already wears wherever it appears --
 * green REVIEWED for scientific, violet PROMOTED for training -- so a pending acceptance
 * and a recorded one are the same colour, and what separates them is the mark's outline
 * and the tile not stepping back. Delete has no accepted value and never reaches here.
 */
export const acceptClass = (mode = state.mode) =>
  ({ reviewed: 'b-out', promoted: 'b-pro' }[acceptedValue(mode)] || 'b-out');

export const acceptIcon = (mode = state.mode) =>
  ({ reviewed: ICON.tick, promoted: ICON.pro }[acceptedValue(mode)] || ICON.tick);

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
    /* `REVIEWED`, with no name, when it was somebody else. This drew
       `row.reviewed_by || 'REVIEWED'` -- a column the row does not carry, so the fallback
       was the only branch that ever ran (F8) -- and A13 settled that it stays nameless
       deliberately: the row carries a reviewer *id*, so the client can say "by you"
       without the mosaic becoming a route that reports who did how much work. */
    default: return byMe
      ? `<span class="badge b-out">${ICON.tick}REVIEWED &middot; you</span>`
      : `<span class="badge b-oth">${ICON.eye}REVIEWED</span>`;
  }
}

/* What a record tag looks like, whichever mode is reading it. The same class and icon
   the owning workflow uses for its own badge, so PROMOTED is violet and a flag is amber
   wherever they appear. */
const TAG_CLASS = { flagged: 'b-flag', reviewed: 'b-out', promoted: 'b-pro', excluded: 'b-exc' };
const TAG_ICON = { flagged: ICON.flag, reviewed: ICON.tick, promoted: ICON.pro, excluded: ICON.exc };

/**
 * The tags other workflows have put on this record (#85).
 *
 * Every mode shows them, because whenever somebody looks at an observation they should
 * see what every workflow has said about it. They are drawn in their own slot below the
 * primary badge's corner and never in it: `.badge` is what *this* mode says, and letting a
 * record tag reach that slot would let it outrank a mark, which is how a click on a
 * committed tile comes to look like it did nothing.
 *
 * No workflow label on the face of the tile: FLAGGED and REVIEWED can only be scientific,
 * PROMOTED and EXCLUDED can only be training, and colour reinforces it. The tooltip names
 * the workflow, the reason and the person. If that turns out to be unclear in use, the
 * prefix form (`TRN · EXCLUDED`) is this one template string.
 */
function borrowed(row) {
  const tags = borrowedTags(state.mode, row);
  if (!tags.length) return '';
  return `<span class="rtags">${tags.map((t) => {
    /* "by you" or nothing. The tooltip used to name the person from `t.by`, which came
       from a column the row does not carry; A13 gives an id instead, so the only thing
       the interface may say about a decision's owner is whether it was the reviewer's. */
    const mine = state.me && t.reviewerId != null && t.reviewerId === state.me.user_id;
    const title = [`${t.workflow}: ${t.value}`, t.reason, mine ? 'by you' : null]
      .filter(Boolean).join(' — ');
    return `<span class="rtag ${TAG_CLASS[t.value] || 'b-oth'}" data-rtag="${t.key}"
      title="${title}">${TAG_ICON[t.value] || ''}${t.value.toUpperCase()}</span>`;
  }).join('')}</span>`;
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

  /**
   * A correction is clickable: it reopens the chooser on the tile it belongs to.
   *
   * **Only a correction made in this session** (A12, answered against the recommendation).
   * `row.previous_comname` is gone: no row carries it, and the field this phase *could*
   * have drawn instead — `comname` differing from `species_comname` — would have made the
   * chip appear on every row that has ever been relabelled, including rows nobody in this
   * session touched. That is a behaviour change rather than a port, and the human's call
   * was to keep today's behaviour. `state.changed` is therefore the only source.
   */
  if (changed) {
    return `<span class="reason-chip" data-changed="${id}"
      title="Change the species again">was ${changed.from}</span>`;
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
    /**
     * The address comes from the seam (R10, F7, R1).
     *
     * This was `./fixtures/thumbs/${row.thumb}` — a URL written above `api/`, and a
     * *fixture* URL at that, so it could never have drawn a real picture. The row
     * deliberately carries no `thumb`: "the address is derivable from a key this row
     * already carries, so no second field repeats a URL 45 times a page", and the
     * row-shape tripwire asserts its absence. So the seam answers, and against the API
     * that is a same-origin `<img>` carrying the session cookie — no signed URL, no token
     * in a query string, and no blob fetch per tile.
     *
     * `onerror` is R10's second half: a 404 on a row that reported `ready` degrades to the
     * no-image state rather than to a broken-image glyph. `storage/` is restored
     * separately from the database, so a recorded thumbnail whose file is missing is a
     * real and recoverable state.
     */
    return `<img src="${MarpBackend.thumbnailUrl(row)}" alt="${currentSpeciesName(row)}"
      loading="lazy" onerror="this.closest('.tile').dataset.noimage='1';this.remove()">`;
  }
  if (row.thumbnail_status === 'queued') {
    return `<span class="fallback"><span class="ph-t">PREPARING</span>
      <span class="phbar"><i></i></span></span>`;
  }
  /**
   * A failure that retrying cannot help says so, and offers no button (R13, F11).
   *
   * `thumbnail_permanent` is set from a retry answer, never from a row — the client had
   * code for this state and no data had ever reached it, so it has never been rendered
   * until now. The reason is the endpoint's own, e.g. "the observation has no keyframes,
   * so it has no bounding box and can never have a cropped picture".
   */
  if (row.thumbnail_permanent) {
    return `<span class="fallback"><span style="font-size:20px;color:#c07d85">&#9888;</span>
      <span class="na-t">NO IMAGE &middot; PERMANENT</span></span>`;
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

  /* The record still carries a decision, but the reviewer has taken the mark off and
     nothing has been committed yet. Showing FLAGGED or PROMOTED there would deny the
     click ever happened; showing nothing would hide a decision that is still on the
     record. The rule is `model/`'s, because the commit button asks the same question and
     the two must not disagree about which tiles are taking something back (#135). */
  const takingBack = pendingTakeBack({
    mode: state.mode, row, marks: state.marks, takenBack: state.takenBack,
    outcomes: state.outcomes
  });
  /* An id against the authenticated principal's id (A13). `decidedBy(row) === ME` was a
     name against a literal, and both halves were wrong: the row carries no name, and the
     literal was one developer's. */
  const byMe = decidedByMe(state.mode, row, state.me);
  const noImage = row.thumbnail_status !== 'ready';
  /* The row is gone from the database, so every gesture the store offers is refused
     (#138). The same rule the refusals ask, so the tile cannot look inert while still
     acting, or act while looking inert. */
  const gone = isDestroyed(state.outcomes, id);

  /* Which of the two things this mark says (#126). It fits **inside** the existing
     precedence rather than beside it: a mark still outranks an outcome, which still
     outranks the record, and the kind only decides what the mark itself looks like. */
  const accepted = Boolean(marked) && markKind(marked) === MARK_ACCEPT;
  /* An accept mark survives its own commit by design (#126), so the tile keeps the mark
     badge -- and its tooltip went on saying "Not committed yet" after the commit had
     recorded it. "Committed" means *this sitting*: after a reload there is no accept mark
     at all, so the tile falls to a badge with no tooltip and nothing false survives. */
  const acceptRecorded = accepted && outcome === acceptedValue(state.mode);
  /* The one accept mark the reviewer just tried to make and could not (A4). */
  const refused = state.refused && state.refused.id === id ? state.refused : null;

  const cls = ['tile'];
  if (row.thumbnail_status === 'queued') cls.push('queued');
  if (row.thumbnail_status === 'failed') cls.push('failed');
  if (row.thumbnail_permanent) cls.push('permanent');
  if (marked) cls.push('marked');
  if (accepted) cls.push('accept');
  if (refused) cls.push('refused');
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
    /* Mint, which is what a take-back looks like here and what the tile's own dashed
       outline already is -- and the **icon of the decision being withdrawn** (A4), so
       taking back a promotion does not wear the exclusion mark. Violet for the badge
       itself was the recorded assumption and is not what landed: it is the colour of
       PROMOTED, and a violet badge inside a mint outline would say the tile is promoted
       in the one slot that is saying it is about to stop being.
       What the next commit does depends on which button (#135 A2), so the tooltip says
       both rather than the one that used to be true of the sweep alone. */
      ? `<span class="badge b-rev" title="Taking back ${takingBack} — not committed yet. Commit Marked withdraws it; a page commit accepts it.">${takingBack === acceptedValue(state.mode) ? acceptIcon() : markIcon()}TAKING BACK</span>`
    /* An accept mark, and **still exactly one `.badge`** (A6). It carries no `data-badge`:
       the panel chooses a flag or exclusion reason, and an acceptance has nothing in that
       vocabulary to say, so its badge is not a target rather than opening a panel that
       cannot describe it. */
    : accepted ? `<span class="badge ${acceptClass()}"
        title="${acceptRecorded
          ? `Recorded as ${acceptedValue(state.mode)} — click to ${MODES[state.mode].verb.toLowerCase()} it instead`
          : `Not committed yet — the next commit records this one as ${acceptedValue(state.mode)}`}">${acceptIcon()}${String(acceptedValue(state.mode)).toUpperCase()}</span>`
    : marked ? `<span class="badge ${markClass()}" data-badge="${id}"
        title="Open reason and correction options">${markIcon()}${MODES[state.mode].mark.toUpperCase()}</span>`
    /* A refused commit is its own state: the annotation moved underneath the page and
       **nothing was written**, which is a different thing from a commit that did nothing.
       The mark is kept, so the page can be re-read and committed again (R9). */
    : outcome === 'conflicted'
      ? `<span class="badge b-rev" title="The annotation moved while you were looking at it — nothing was written. Re-read the page and commit again.">${ICON.cross}MOVED</span>`
    : outcome ? outcomeBadge(outcome, row, id)
    : showExisting ? existingBadge(existing, row, id, byMe)
    /* A correction is not this mode's business, so it only claims the badge when
       the mode has nothing of its own to say. It always keeps the corner chip. */
    : changed ? `<span class="badge b-chg">${ICON.tick}CHANGED</span>`
    : '';

  /* The **current** species, not the annotator's frozen label (F6). `row.comname` here
     showed the old animal for ever on any observation that had been corrected, while the
     species filter -- which is `species_id` -- matched the new one. */
  const name = currentSpeciesName(row);
  /* Why the clicks do nothing, which is the reviewer's actual question. DELETED states
     the fact; this states the consequence (#138). */
  const tip = gone
    ? `${name} · removed from the database — nothing more can be recorded about it`
    : row.thumbnail_permanent
      ? `${name} · no image, and retrying cannot help${row.thumbnail_reason ? ' — ' + row.thumbnail_reason : ''}`
      : noImage
        ? `${name} · no image — markable, but excluded from the page commit`
        : `${name} · ${row.confidence} · ${row.dive} line ${row.line} · ${row.tc}`;

  /* Its own slot, never the badge's (A4, A6). A refusal is an acknowledgement that a
     gesture did not take, not a state the tile is in, and letting it reach `.badge` is
     how a record tag comes to outrank a mark. It fades on its own. */
  const refusal = refused
    ? `<span class="refusal" data-refused="${id}">${ICON.cross}${refused.reason}</span>`
    : '';

  /* `aria-disabled`, never `disabled`: the tile stays a real button that a real click
     still reaches, so "the click does nothing" is a thing the render tier can observe
     rather than something the browser swallows before the app sees it. */
  return `<button class="${cls.join(' ')}" data-id="${id}" title="${tip}"${gone ? ' aria-disabled="true"' : ''}>
      ${body(row)}${badge}${corner(row, id, { marked, changed, existing, outcome })}
      ${refusal}${borrowed(row)}<span class="cap">${name}</span></button>`;
}
