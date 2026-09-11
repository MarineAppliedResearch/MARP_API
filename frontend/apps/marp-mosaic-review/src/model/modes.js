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
    /**
     * The same button's label once it is the **secondary** one (#126 R5).
     *
     * Shorter, because it sits beside the main button in a footer that is 412 pixels wide
     * on a phone -- the full label pushed the pair past the edge, and `.app` clips rather
     * than scrolls, so the button was cut off rather than reachable. It keeps the verb, so
     * it still says what it records rather than only that it is the big one.
     */
    sweep: 'Review page',
    accepts: 'reviewed',
    /** What a marked tile becomes when the page is committed. */
    marks: 'flagged',
    note: 'Commit accepts unflagged tiles for scientific use',
    /** The dimension this mode acts on. What it may *filter* on is `statusDimensions`. */
    statusKey: 'reviewStatus',
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
    sweep: 'Promote page',
    accepts: 'promoted',
    marks: 'excluded',
    note: 'Commit promotes unmarked tracks to training data — it does not change scientific status',
    statusKey: 'trainingDisposition',
    defaultStatus: ['undecided'],
    reasons: ['Bounding box too loose', 'Occluded', 'Too small', 'Ambiguous ID', 'Other / unsure']
  },

  delete: {
    id: 'delete',
    label: 'Delete',
    mark: 'Delete',
    verb: 'Mark',
    commit: 'Delete Marked',
    /* Delete keeps one button, so this label is never the secondary one (A2). */
    sweep: null,
    /* The one mode where the commit acts on the marked tiles rather than the
       unmarked ones. Everything that reports a commit has to respect that. */
    accepts: null,
    marks: 'deleted',
    note: 'Commit permanently deletes the marked tiles — unmarked tiles are untouched',
    /* Delete Mode *owns* both status dimensions, and it is the only mode that does — every
       mode now filters on both (#89), but only here does the second one arrive with a
       default of its own. Deleting is irreversible, so the useful question before removing
       an observation is not "what does this one workflow think" but "what does anything on
       the record say" — that it was flagged, that it was accepted for science, that it is
       already teaching a model. All of those are reasons to stop, so all three training
       values are ticked on arrival rather than left not filtering.

       They are context, not this mode's own decision: Delete records nothing until the
       commit, so nothing here ever arrives marked. */
    statusKey: 'reviewStatus',
    defaultStatus: ['unreviewed', 'flagged'],
    alsoStatusKey: 'trainingDisposition',
    alsoDefaultStatus: ['undecided', 'promoted', 'excluded'],
    reasons: []
  }
};

export const isMode = (id) => Object.prototype.hasOwnProperty.call(MODES, id);

/**
 * The status dimensions a mode filters on, in the order the rail shows them.
 *
 * **Every mode filters on both, and this reversed on 2026-09-08** (#89). Delete Mode
 * already offered both, and its reasoning generalises: choosing what to review is the same
 * question as choosing what to destroy — not what one workflow thinks, but what anything on
 * the record says. So a reviewer who can now *see* that an observation is excluded from
 * training (#85) can also ask for only those.
 *
 * `own` is the distinction the whole change turns on:
 *
 * - an **own** dimension is one the mode acts on, and it arrives at that mode's default;
 * - a **borrowed** one arrives **not filtering at all** — `defaults: []` — and narrows only
 *   once the reviewer picks something.
 *
 * That is not tidiness. `trainingDisposition` defaults to `['undecided']`, so letting the
 * borrowed dimension take a default would drop every promoted and excluded row out of
 * Scientific's opening page: 151 of 1083 in the fixture, silently, with nothing on screen
 * saying so — and those are the exact rows #85 exists to surface.
 *
 * Returning a list rather than a key is still what lets the rail, the query, the defaults,
 * the collapsed-rail badge and the address stay ignorant of which mode owns what.
 */
export function statusDimensions(modeId) {
  const m = MODES[modeId];
  const dims = [{ key: m.statusKey, defaults: m.defaultStatus, own: true }];
  if (m.alsoStatusKey) {
    dims.push({ key: m.alsoStatusKey, defaults: m.alsoDefaultStatus, own: true });
  }
  /* Then everything the mode does not own, borrowed and not filtering. Read from the
     declaration rather than listed per mode, so a third dimension would arrive in every
     mode's rail by adding one entry to `STATUS_DIMENSIONS`. */
  for (const dim of Object.values(STATUS_DIMENSIONS)) {
    if (dims.some((d) => d.key === dim.key)) continue;
    dims.push({ key: dim.key, defaults: [], own: false });
  }
  /* The label and the value list describe the dimension, not the mode — they were copied
     into each mode and the copies were identical. See `STATUS_DIMENSIONS`. */
  return dims.map((d) => ({
    ...d,
    label: STATUS_DIMENSIONS[d.key].label,
    statuses: STATUS_DIMENSIONS[d.key].statuses
  }));
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
 * The two kinds a mark can carry (#126).
 *
 * **A mark had no kind before this.** `state.marks` was a set of ids and the commit read
 * it with a bare `marks.has(id)`, so every mark meant "this is the exception". The human
 * reviewed 1,062 real observations and that model did not hold up: *"There are times when
 * you just want to exclude things, or just approve certain items, without it affecting
 * anything else."*
 *
 * So the kind is on the mark rather than in a second list (A5). One list keyed by
 * `observation_id` is what `applyCommit` already folds by, and two lists reintroduce the
 * question of what an id appearing in both means.
 *
 * `EXCEPT` is what a left click has always recorded, and is the default everywhere a kind
 * is absent — a seeded mark, an older stored shape, a caller that has not been told.
 */
export const MARK_EXCEPT = 'except';
export const MARK_ACCEPT = 'accept';

/** The kind a mark carries, defaulting to the one a mark has always had. */
export const markKind = (mark) => (mark && mark.kind === MARK_ACCEPT ? MARK_ACCEPT : MARK_EXCEPT);

/** Is this id marked as the exception? The question every commit rule used to ask as `has`. */
export const isExcepted = (marks, id) => marks.has(id) && markKind(marks.get(id)) === MARK_EXCEPT;

/** Is this id marked as accepted? */
export const isAccepted = (marks, id) => marks.has(id) && markKind(marks.get(id)) === MARK_ACCEPT;

/**
 * What an accept mark would record in this mode, or null where it can record nothing.
 *
 * Delete is the null (A2): `MODES.delete.accepts` is null because the opposite of deleting
 * is leaving a row alone, which needs no record — so an accept mark has nothing to mean
 * there and the gesture is inert.
 */
export const acceptedValue = (modeId) => (MODES[modeId] ? MODES[modeId].accepts : null);

/**
 * May this tile be marked accepted? (A4)
 *
 * **Accepting needs imagery; flagging does not.** That rule is older than this feature and
 * is why an unmarked row without a picture is skipped rather than accepted. An *explicit*
 * accept mark is the reviewer saying "I have judged this one", which they cannot have done
 * without seeing it — so the mark is refused at click time, with the tile saying why,
 * rather than taken and quietly not acted on. The skip count explains a **sweep**, where
 * the reviewer never singled the tile out; it does not explain a deliberate click.
 *
 * @param {string} modeId - The active mode.
 * @param {Object} row - The row the gesture landed on.
 * @returns {{ok: boolean, reason: string|null}} Why not, in the reviewer's words.
 */
export function acceptRefusal(modeId, row) {
  if (!acceptedValue(modeId)) {
    return { ok: false, reason: null };           // inert, not refused: nothing to say
  }
  if (!row || row.thumbnail_status !== 'ready') {
    return {
      ok: false,
      reason: `No picture, so it cannot be marked ${MODES[modeId].accepts}`
    };
  }
  return { ok: true, reason: null };
}

/**
 * The rows a **selective** commit will be sent for (#126 R3, A3).
 *
 * Only what the reviewer marked **by hand in this sitting**. `state.touched` is the whole
 * of that second half, and it is not a nicety: a page still arrives with the record's
 * existing exceptions already marked, because the human asked to see it that way — so
 * without the `touched` filter, pressing this button on a freshly loaded page would
 * re-commit flags nobody touched, under this reviewer's name and today's date.
 * `observation_reviews` records a reviewer per row, so that is the scientific record
 * asserting a decision that was never made.
 *
 * A take-back is not a mark, so it is not here: clicking a mark off leaves the tile
 * untouched by this button (R7). The sweep still accepts it, which is R4.
 *
 * @param {Object} args
 * @param {Array<Object>} args.rows - The page.
 * @param {Map} args.marks - `state.marks`.
 * @param {Set<number>} args.touched - `state.touched`.
 * @returns {Array<Object>} The rows, in page order.
 */
export function selectedRows({ rows, marks, touched }) {
  return rows.filter((r) => marks.has(r.observation_id) && touched.has(r.observation_id));
}

/**
 * What the **main** button will do to this page, split by outcome (R6).
 *
 * The same shape `commitOutcome` answers in, so the chrome draws both buttons through one
 * code path and they cannot disagree about what the five numbers mean.
 *
 * `skips` is zero by construction outside Delete: an accept mark on a tile with no picture
 * is refused at click time (A4), and an exception mark never needed one.
 */
export function selectionOutcome({ mode, rows, marks, touched }) {
  const picked = selectedRows({ rows, marks, touched });

  if (commitActsOnMarked(mode)) {
    /* Delete has one button, not two (A2) -- this exists so a caller asking anyway gets
       the same answer the single button gives rather than a second opinion. */
    return { acts: picked.length, accepts: 0, flags: 0, deletes: picked.length, skips: 0 };
  }

  const flags = picked.filter((r) => isExcepted(marks, r.observation_id)).length;
  const ready = picked.filter((r) => isAccepted(marks, r.observation_id)
    && r.thumbnail_status === 'ready').length;
  const skips = picked.length - flags - ready;
  return { acts: flags + ready, accepts: ready, flags, deletes: 0, skips };
}

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
export function markedOnPage({ rows, marks, kind = null }) {
  return rows.filter((r) => marks.has(r.observation_id)
    /* `kind` narrows it to one of #126's two. Absent, it counts both -- which is what
       every caller meant while a mark could only be the exception. */
    && (kind === null || markKind(marks.get(r.observation_id)) === kind)).length;
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
  /* **Excepted**, not merely marked (#126). An accept mark is not an exception, so the
     sweep accepts it exactly as it accepts an untouched tile -- which is why the sweep's
     behaviour is unchanged by this feature rather than quietly widened by it. */
  return eligible.filter((r) => !isExcepted(marks, r.observation_id)).length;
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
    /* Through `dimensionState` rather than naming the column again: the column moved
       from `training_disposition` to `training_decision` (F3) and this was the one place
       outside `STATUS_DIMENSIONS` that spelled it out. */
    promoted: targets.filter((r) => dimensionState('trainingDisposition', r) === 'promoted').length,
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
  /* The exception set, which is what a mark used to be by definition. An accept mark is
     not an exception: under the sweep it is accepted, which is what an unmarked tile is
     too, so the sweep does exactly what it did before #126 existed (R4). */
  const marked = (r) => isExcepted(marks, r.observation_id);

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
 * Which of a page's tiles a retry can actually help.
 *
 * **A permanent failure is left out** (F11, R13). The endpoint refuses one rather than
 * re-queueing it -- an observation with no keyframes has no bounding box and can never
 * have a cropped picture -- and without that the page's "Ask again" button becomes a way
 * to hammer a shared media server for something that cannot exist.
 *
 * A named rule rather than a filter written inline in the store, because `permanent` is a
 * state the client had code for and no data had ever reached: `src/data.js:494`
 * short-circuited on `thumbnail_permanent` and no row has ever carried the key. A rule
 * nothing can observe is a rule that quietly stops being true, so this is the tier that
 * observes it.
 *
 * @param {Array<Object>} rows - The page.
 * @returns {Array<number>} The observation ids worth asking again for.
 */
export const retryablePage = (rows) => (rows || [])
  .filter((r) => r.thumbnail_status === 'failed' && !r.thumbnail_permanent)
  .map((r) => r.observation_id);

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
 *
 * `label` and `statuses` moved here from `MODES` with #89. Every mode filters on every
 * dimension now, so a per-mode copy of the rail's heading and its three boxes was
 * describing the dimension rather than the mode — and the copies were identical anyway,
 * `scientific.statuses` word for word the same as `delete.statuses`. A borrowed dimension
 * also has to get its label from somewhere that is not another mode's declaration. What
 * stays per mode is which dimensions it owns, and with what defaults.
 *
 * The two vocabularies must stay disjoint. `ui/chrome.js` reads `state.counts[value]` by
 * value alone, so a value appearing in both dimensions would show one dimension's count
 * beside the other's box.
 */
export const STATUS_DIMENSIONS = {
  reviewStatus: {
    key: 'reviewStatus',
    /* `review_decision`, not `review_status` (F3, A1). The column this used to name has
       not existed since #103: a review belongs to the reviewer, so the current decision
       is a projection row rather than a column on `observations`. The client now uses the
       schema's word for it, rather than an adapter translating one into the other -- see
       A1, where the reasoning is that "nothing above `api/` changes" is a *measurement*
       and an adapter would make it pass by hiding what it measures. */
    column: 'review_decision',
    /**
     * The **filter** value that means nobody has decided yet.
     *
     * On the row the same state is **null** -- the absence of a review record -- and the
     * two really are different words for one thing: the endpoint accepts
     * `reviewStatus: ['unreviewed', ...]` as a filter and sends `review_decision: null`
     * in the row. `dimensionState` is where that is reconciled, once.
     */
    neutral: 'unreviewed',
    workflow: 'Scientific data review',
    label: 'Review status',
    statuses: [['unreviewed', 'Unreviewed'], ['flagged', 'Flagged'], ['reviewed', 'Reviewed']],
    reasonColumn: 'flag_reason',
    /**
     * Which column says **who** decided. A13, and F8 is the defect it closes.
     *
     * This was `byColumns: ['reviewed_by', 'flagged_by']`, and the mosaic row has never
     * carried either — nor `training_approved_by` or `excluded_by`. So the "REVIEWED by
     * you" badge, the borrowed tag's attribution and the whole `byMe` derivation silently
     * became nothing: no error, no log, just an interface that stopped being able to tell
     * the reviewer which decisions were theirs.
     *
     * **An id, not a name.** The permission catalog separates `reports:read` from
     * `observations:read` because it exposes who did how much work, and the row's freedom
     * from `processor_name` is what keeps the mosaic an `observations:read` route. An id
     * the client can only compare against its own authenticated principal gives "by you"
     * and exposes nobody — which is why `borrowedTags` below answers `byMe` rather than a
     * person.
     */
    reviewerColumn: 'review_reviewer_id'
  },
  trainingDisposition: {
    key: 'trainingDisposition',
    /* `training_decision` on the row, for the same reason as `review_decision` above. */
    column: 'training_decision',
    neutral: 'undecided',
    workflow: 'Training data review',
    label: 'Training disposition',
    statuses: [['undecided', 'Undecided'], ['promoted', 'Promoted'], ['excluded', 'Excluded']],
    reasonColumn: 'exclusion_reason',
    reviewerColumn: 'training_reviewer_id'
  }
};

/**
 * The state a record carries in one dimension, or null when it carries none.
 *
 * **Null on the row is the neutral state** — "the absence of a record" — which is what
 * the endpoint sends and is the one place the row vocabulary and the filter vocabulary
 * are reconciled (F3). The neutral *filter* string is accepted too, because
 * `state.counts` and the rail are keyed by it and a row is easy to build by hand in a
 * test; anything else is a decision and is returned as one.
 */
export function dimensionState(key, row) {
  const dim = STATUS_DIMENSIONS[key];
  if (!dim) return null;
  const value = row[dim.column];
  if (value == null || value === dim.neutral) return null;
  return value;
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
        /* Who decided, as an id -- and `byMe` is derived from it by the caller, which is
           the only thing the interface may say about a person (A13). `by: <a name>` is
           what this used to be, from a column the row does not carry (F8). */
        reviewerId: row[dim.reviewerColumn] == null ? null : row[dim.reviewerColumn]
      };
    })
    .filter(Boolean);
}

/**
 * Who made the decision **this mode acts on**, as a `users.user_id`, or null.
 *
 * Mode-scoped for the same reason `existingState` is: it answers a question about the one
 * dimension whose badge the tile is drawing, and the two have to agree about which
 * decision they are describing. `decidedBy(row)` was neither — it returned the first
 * non-null of four columns across both workflows, so a training approver could have been
 * reported as the scientific reviewer — and all four columns were absent from the row
 * anyway, so it always returned null (F8).
 *
 * @param {string} mode - The active mode.
 * @param {Object} row - A mosaic row.
 * @returns {number|null} The reviewer's user id.
 */
export function reviewerIdFor(mode, row) {
  const m = MODES[mode];
  const dim = m && STATUS_DIMENSIONS[m.statusKey];
  if (!dim || !row) return null;
  const id = row[dim.reviewerColumn];
  return id == null ? null : id;
}

/**
 * Was this the signed-in reviewer's own decision?
 *
 * The comparison A13 exists for: an id against the authenticated principal's id, which
 * answers "by you" without the row ever carrying a name. `me` may be null — the identity
 * arrives from `/api/v2/auth/me` and a page can render before it does — and a null `me`
 * must read as "not mine" rather than matching a row with no reviewer either.
 *
 * @param {string} mode - The active mode.
 * @param {Object} row - A mosaic row.
 * @param {Object|null} me - The signed-in user, or null.
 * @returns {boolean} True only when both ids are present and equal.
 */
export function decidedByMe(mode, row, me) {
  const mine = me && me.user_id;
  const theirs = reviewerIdFor(mode, row);
  return Boolean(mine != null && theirs != null && mine === theirs);
}
