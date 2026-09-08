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
    /* 'No imagery' is here so a flag raised because nobody could see the observation
       says so on the record. Without it every such flag lands under 'Other / unsure',
       and the reason a whole batch was flagged is invisible to anything querying it
       later -- which matters, because that database is a scientific record. */
    reasons: ['Wrong species', 'False detection', 'Duplicate', 'Bounding box',
              'No imagery', 'Other / unsure']
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
/**
 * How many of *this page's* tiles are marked.
 *
 * `state.marks` spans the session, not the page: a mark made on page one is still there
 * when the reviewer is on page four, deliberately, so paging away and back does not lose
 * it. So `marks.size` is never the answer to "how many are marked here" -- the chrome used
 * it for three separate labels that all say "this page", and the count only ever went up.
 * Worst of the three was Delete Mode's note, which put a cross-page total in front of a
 * permanent deletion. Reported 2026-09-08.
 */
export function markedOnPage({ rows, marks }) {
  return rows.filter((r) => marks.has(r.observation_id)).length;
}

export function commitCount({ mode, rows, marks }) {
  /* Delete acts on what is marked, imagery or not -- `data.js` only skips a row with no
     picture when it is *unmarked*, so a marked one is destroyed either way. Filtering here
     first made this under-count in Delete Mode, and it agreed with `deleteImpact`, which
     had the same fault: the two were consistent with each other and wrong about what the
     commit does. Fixed 2026-09-06. */
  if (commitActsOnMarked(mode)) {
    return rows.filter((r) => marks.has(r.observation_id)).length;
  }
  const eligible = rows.filter((r) => r.thumbnail_status === 'ready');
  return eligible.filter((r) => !marks.has(r.observation_id)).length;
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
  /* Everything marked, imagery or not -- the same rule `commitOutcome` and the commit
     itself use. This filtered on `thumbnail_status === 'ready'` until 2026-09-06, so
     marking two rows where one had no picture put "1 observation" on the dialog and then
     destroyed two. Deletion is irreversible and this count is the only thing in front of
     it, so it has to be the number that actually gets deleted. */
  const targets = rows.filter((r) => marks.has(r.observation_id));

  return {
    count: targets.length,
    reviewed: targets.filter((r) => existingState('scientific', r)).length,
    promoted: targets.filter((r) => r.training_disposition === 'promoted').length,
  };
}

/**
 * What a commit will actually do to this page, split by outcome.
 *
 * `commitCount` answers "how many", which was enough while every row was assumed to have
 * imagery. It is not enough now: accepting a row means somebody looked at it, so it needs
 * a picture, while flagging one means somebody is saying something is wrong -- and a
 * missing thumbnail is itself worth flagging.
 *
 * So a marked row without imagery is flagged, an unmarked row without imagery is skipped,
 * and the interface can stop claiming to act on rows it is about to drop.
 */
export function commitOutcome({ mode, rows, marks }) {
  const ready = (r) => r.thumbnail_status === 'ready';
  const marked = (r) => marks.has(r.observation_id);

  if (commitActsOnMarked(mode)) {
    /* Delete acts on what is marked. Destroying something nobody could see is a decision
       for the human, and the confirmation names the count either way. */
    const targets = rows.filter(marked);
    return { acts: targets.length, accepts: 0, flags: 0, deletes: targets.length, skips: 0 };
  }

  const flags = rows.filter((r) => marked(r)).length;
  const accepts = rows.filter((r) => !marked(r) && ready(r)).length;
  const skips = rows.filter((r) => !marked(r) && !ready(r)).length;
  return { acts: flags + accepts, accepts, flags, deletes: 0, skips };
}

/**
 * What state this page is in, beyond "here are some tiles".
 *
 * Named rather than inferred at the point of drawing, so the rule is testable without a
 * browser and the chrome and the grid cannot disagree about which state they are in.
 */
export function pageState({ rows, loading, total }) {
  if (loading) return 'loading';
  if (!rows.length) return total ? 'filtered-out' : 'empty';
  if (rows.every((r) => r.thumbnail_status === 'failed')) return 'no-imagery';
  if (rows.some((r) => r.thumbnail_status !== 'ready')) return 'partial-imagery';
  return 'ready';
}

/**
 * The status dimensions a record carries, declared once.
 *
 * A mode's `statusKey` names one of these. The filter key, the row column and the value
 * that means "nothing has been decided" were spelled out by hand in several places --
 * `data.js` counts and filters on the columns, `existingState` read them again -- and
 * reading *both* dimensions off one row needed the mapping to exist somewhere.
 *
 * `workflow` is what the tooltip calls the decision. It is not drawn on the tile face:
 * the vocabularies are disjoint, so FLAGGED can only be scientific and EXCLUDED can only
 * be training. See the app's CLAUDE.md.
 */
export const STATUS_DIMENSIONS = {
  reviewStatus: {
    key: 'reviewStatus',
    column: 'review_status',
    /* The value that means nobody has decided yet, and so carries no tag. */
    neutral: 'unreviewed',
    workflow: 'Scientific data review',
    reasonColumn: 'flag_reason',
    byColumns: ['reviewed_by', 'flagged_by']
  },
  trainingDisposition: {
    key: 'trainingDisposition',
    column: 'training_disposition',
    neutral: 'undecided',
    workflow: 'Training data review',
    reasonColumn: 'exclusion_reason',
    byColumns: ['training_approved_by', 'excluded_by']
  }
};

/** The state a record carries in one dimension, or null when it carries none. */
export function dimensionState(key, row) {
  const dim = STATUS_DIMENSIONS[key];
  if (!dim) return null;
  const value = row[dim.column];
  return value && value !== dim.neutral ? value : null;
}

/**
 * The state a record carries for this mode, or null when it carries none.
 *
 * **Deliberately mode-scoped, and it has to stay that way.** This answers "what does the
 * dimension this mode acts on say", and three different things ask it: the tile's primary
 * badge and its mark/outcome/record precedence, `store.refresh` seeding the page's
 * exception set through `page.seedMarks`, and `deleteImpact`. Widening it to return every
 * tag -- which is what #85 looks like it wants -- would make a *training* exclusion seed a
 * *scientific* mark, and would let another workflow's value satisfy the `takingBack`
 * derivation in `ui/tile.js`. Showing every workflow's tags is `borrowedTags` instead.
 */
export function existingState(mode, row) {
  const m = MODES[mode];
  return m ? dimensionState(m.statusKey, row) : null;
}

/**
 * Every tag the record carries from a workflow other than this mode's own (#85).
 *
 * Whenever a reviewer looks at an observation they should see what every workflow has
 * said about it — flagged, reviewed, promoted, excluded — whichever mode they are in.
 * Hiding the other workflow's answer was the earlier decision and it was wrong: Delete
 * Mode already read both dimensions, and its reasoning generalises. The decisions stay
 * independent; only the concealment goes.
 *
 * The mode's own dimension is left out because it already has the primary badge and its
 * full precedence — and since a page arrives with its existing exceptions marked,
 * including it would draw FLAGGED the mark beside FLAGGED the record.
 *
 * These are context, never a selection: nothing here changes what a mark means, what
 * arrives marked, or what a commit writes.
 */
export function borrowedTags(mode, row) {
  const own = MODES[mode] && MODES[mode].statusKey;
  return Object.values(STATUS_DIMENSIONS)
    .filter((dim) => dim.key !== own)
    .map((dim) => {
      const value = dimensionState(dim.key, row);
      if (!value) return null;
      return {
        key: dim.key,
        value,
        workflow: dim.workflow,
        reason: row[dim.reasonColumn] || null,
        by: dim.byColumns.map((c) => row[c]).find(Boolean) || null
      };
    })
    .filter(Boolean);
}

/** Whose decision it was, when the record carries one. */
export function decidedBy(row) {
  return row.reviewed_by || row.training_approved_by || row.flagged_by || row.excluded_by || null;
}
