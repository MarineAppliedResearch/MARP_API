/**
 * What a review mode means.
 *
 * No DOM, no network. A mode decides what tapping a tile records, what the page
 * commit does with it, and which status dimension the reviewer is filtering on.
 * Keeping that here means the rules can be tested without a browser — and it is
 * where the interesting mistakes live, so they are worth testing.
 */

export const MODES = {
  scientific: {
    id: 'scientific',
    label: 'Scientific Data Review',
    /** What a tap records. */
    mark: 'Flagged',
    verb: 'Flag',
    /** What the page commit is called, and what it does to unmarked tiles. */
    commit: 'Mark Page Reviewed',
    accepts: 'reviewed',
    /** What a marked tile becomes when the page is committed. */
    marks: 'flagged',
    note: 'Commit accepts unflagged tiles for scientific use',
    statusKey: 'reviewStatus',
    statusLabel: 'Review status',
    statuses: [['unreviewed', 'Unreviewed'], ['flagged', 'Flagged'], ['reviewed', 'Reviewed']],
    /** Flagged work is still open work, so it stays in the default view. */
    defaultStatus: ['unreviewed', 'flagged'],
    reasons: ['Wrong species', 'False detection', 'Duplicate', 'Bounding box', 'Other / unsure']
  },

  training: {
    id: 'training',
    label: 'Training Data Review',
    mark: 'Excluded',
    verb: 'Exclude',
    commit: 'Promote Page',
    accepts: 'promoted',
    marks: 'excluded',
    note: 'Commit promotes unmarked tracks to training data — it does not change scientific status',
    statusKey: 'trainingDisposition',
    statusLabel: 'Training disposition',
    statuses: [['undecided', 'Undecided'], ['promoted', 'Promoted'], ['excluded', 'Excluded']],
    defaultStatus: ['undecided'],
    reasons: ['Bounding box too loose', 'Occluded', 'Too small', 'Ambiguous ID', 'Other / unsure']
  },

  delete: {
    id: 'delete',
    label: 'Delete',
    mark: 'Delete',
    verb: 'Mark',
    commit: 'Delete Marked',
    /* The one mode where the commit acts on the marked tiles rather than the
       unmarked ones. Everything that reports a commit has to respect that. */
    accepts: null,
    marks: 'deleted',
    note: 'Commit permanently deletes the marked tiles — unmarked tiles are untouched',
    /* Delete Mode reads BOTH status dimensions, and it is the only mode that does.
       Deleting is irreversible, so the useful question before removing an observation
       is not "what does this one workflow think" but "what does anything on the record
       say" — that it was flagged, that it was accepted for science, that it is already
       teaching a model. All of those are reasons to stop.

       They are context, not this mode's own decision: Delete records nothing until the
       commit, so nothing here ever arrives marked. */
    statusKey: 'reviewStatus',
    statusLabel: 'Review status',
    statuses: [['unreviewed', 'Unreviewed'], ['flagged', 'Flagged'], ['reviewed', 'Reviewed']],
    defaultStatus: ['unreviewed', 'flagged'],
    alsoStatusKey: 'trainingDisposition',
    alsoStatusLabel: 'Training disposition',
    alsoStatuses: [['undecided', 'Undecided'], ['promoted', 'Promoted'], ['excluded', 'Excluded']],
    alsoDefaultStatus: ['undecided', 'promoted', 'excluded'],
    reasons: []
  }
};

export const isMode = (id) => Object.prototype.hasOwnProperty.call(MODES, id);

/**
 * The status dimensions a mode filters on, in the order the rail shows them.
 *
 * Every mode has one, except Delete, which has both — see the note on that mode.
 * Returning a list rather than a key is what lets the rail, the query and the
 * defaults all stay ignorant of which mode is the exception.
 */
export function statusDimensions(modeId) {
  const m = MODES[modeId];
  const dims = [{ key: m.statusKey, label: m.statusLabel,
                  statuses: m.statuses, defaults: m.defaultStatus }];
  if (m.alsoStatusKey) {
    dims.push({ key: m.alsoStatusKey, label: m.alsoStatusLabel,
                statuses: m.alsoStatuses, defaults: m.alsoDefaultStatus });
  }
  return dims;
}

/** Delete Mode inverts the commit: it acts on what was marked, not what was left. */
export const commitActsOnMarked = (modeId) => modeId === 'delete';

/**
 * What a mark means once the page is committed, when that is a state the reviewer
 * can still take back. Delete Mode has none: a deleted observation is gone, not a
 * pending intention, so nothing about it stays marked.
 */
export const pendingException = (modeId) =>
  commitActsOnMarked(modeId) ? null : MODES[modeId].marks;

/**
 * How many observations a commit will act on, given what is on the page and what
 * the reviewer marked. Only observations with imagery are eligible, per
 * "What counts as reviewed".
 */
export function commitCount({ mode, rows, marks }) {
  const eligible = rows.filter((r) => r.thumbnail_status === 'ready');
  const marked = eligible.filter((r) => marks.has(r.observation_id)).length;
  return commitActsOnMarked(mode) ? marked : eligible.length - marked;
}

/**
 * Whether committing in this mode destroys something, and so has to be confirmed.
 *
 * Delete is the only one. Scientific review and training review both write a decision
 * that can be written again differently; a delete has no recovery path at all, which is
 * why it is the one mode that stops and asks.
 */
export const commitIsDestructive = (modeId) => modeId === 'delete';

/**
 * What a destructive commit is about to destroy.
 *
 * The count comes from the same rule the commit itself uses, so the number in the dialog
 * cannot disagree with the number acted on. The breakdown is the part that matters: a
 * reviewer stopped by "10 observations" was going to click through anyway, whereas
 * "3 of them are already reviewed, 2 are teaching a model" is a reason to look again.
 * That is also why Delete Mode reads both status dimensions in the first place.
 *
 * `excluded` training samples are deliberately not counted. Being excluded from training
 * is not a reason to keep an observation; being promoted is.
 */
export function deleteImpact({ rows, marks }) {
  const targets = rows.filter(
    (r) => r.thumbnail_status === 'ready' && marks.has(r.observation_id));

  return {
    count: targets.length,
    reviewed: targets.filter((r) => existingState('scientific', r)).length,
    promoted: targets.filter((r) => r.training_disposition === 'promoted').length,
  };
}

/** The state a record carries for this mode, or null when it carries none. */
export function existingState(mode, row) {
  if (mode === 'training') {
    return row.training_disposition && row.training_disposition !== 'undecided'
      ? row.training_disposition : null;
  }
  return row.review_status && row.review_status !== 'unreviewed' ? row.review_status : null;
}

/** Whose decision it was, when the record carries one. */
export function decidedBy(row) {
  return row.reviewed_by || row.training_approved_by || row.flagged_by || row.excluded_by || null;
}
