/**
 * The one tier that runs against a real MARP API (#132 R14, #135 R7).
 *
 * **Why this file exists at all.** Every other browser test navigates with
 * `?backing=fixture`, and the fixture is not a small API — it is a different one. It holds
 * the mosaic in memory and *writes the row's own status column in place* when a page is
 * committed. The endpoint never does that: a decision is a projection row, the mosaic row is
 * served from a cache, and a commit deliberately invalidates nothing. So a defect that lives
 * in the gap between "what the commit recorded" and "what the row still says" cannot be
 * observed on the fixture at any tier. #130, #124's F6 and #124's F8 were all that shape.
 *
 * A8's first answer to this was a better fake. That was reversed on 2026-09-11 — *"if the
 * fixture doesn't trigger the error and the actual system does, that doesn't make any
 * sense"* — and the reversal is why nothing in here simulates anything. The wider decision
 * followed on 2026-09-12: the fixture was scaffolding for the months before this app had an
 * API, **a browser test belongs here**, and the fixture-backed projects are what is left of
 * the way it used to be done rather than the pattern to copy.
 *
 * **Point it at a copy of the corpus, not at the corpus.** `marp db dump`, then
 * `marp db up -Port <yours>` and `marp db load` into that second database, and serve the API
 * from it. The tests still restore what they change — a test that only works on a disposable
 * database is a test nobody can run anywhere else — but the copy is what makes a failed run
 * cost nothing.
 *
 * **It touches one observation and puts it back.** `tests/api/corpus.mjs` is that
 * discipline: it discovers a `{species, line}` pair holding exactly one observation so a page
 * sweep writes one decision rather than fifty, it refuses to run if the page it gets is not
 * that one row, and `restore` returns the record in a `finally` so a failed assertion still
 * leaves it as it was found.
 *
 * Run it with the API serving this app:
 *
 *   MARP_API_BASE=http://localhost:<port> npx playwright test --project=api
 */
import { test, expect } from '@playwright/test';
import { claimLoneRow, commitOne, restore, decisionNow } from './corpus.mjs';

/**
 * One row, three tests, so they take turns.
 *
 * The fixture-backed projects run six workers because each browser context holds its own
 * copy of the data. Here there is one database and one observation isolated enough to write
 * to, so parallel tests would commit over each other and the failure would look like a
 * defect in the app.
 */
test.describe.configure({ mode: 'serial' });

/** Every test asserts this: a run must not be able to grade the fixture and call it the API. */
async function onTheApi(page) {
  await expect(page.locator('html')).toHaveAttribute('data-backing', 'api');
  await expect(page.locator('#backingFlag')).toHaveCount(0);
}

/** The tile, pinned by id — a locator describing a *state* slides onto a different tile. */
const tileFor = (page, row) => page.locator(`.tile[data-id="${row.observation_id}"]`);

/**
 * An address holding this one row, **whatever decision it is carrying**.
 *
 * Both status dimensions are spelled out rather than left to the mode's default, and that is
 * not belt and braces: Scientific opens on `['unreviewed', 'flagged']` and Training on
 * `['undecided']`, so a row the test has just *accepted* drops straight out of the page and
 * the failure reads as a missing tile rather than as a filter. It cost a run here.
 */
const addressFor = (mode, lone) => (mode === 'scientific'
  ? `./?species=${lone.species}&line=${lone.line}`
    + '&reviewStatus=unreviewed,flagged,reviewed'
  : `./?mode=training&species=${lone.species}&line=${lone.line}`
    + '&trainingDisposition=undecided,promoted,excluded');

test('R8: a recorded take-back stops saying TAKING BACK', async ({ page, request }) => {
  const claim = await claimLoneRow(request, 'scientific');
  const { lone, row } = claim;

  try {
    /**
     * **The record has to carry the flag, not this sitting.**
     *
     * That is the whole precondition, and it is what the fixture cannot arrange honestly.
     * The flag is written through the API first and the page is then loaded fresh, so what
     * the tile reads comes off `observation_review_current` by way of the row's
     * `review_decision` — a decision from an earlier sitting, which is R7a's case too.
     */
    await commitOne(request, 'scientific', row, { kind: 'except' });
    expect(await decisionNow(request, 'scientific', lone)).toBe('flagged');

    /* Species and line together are the whole question, so the page holds this row alone.
       Scientific opens on `['unreviewed', 'flagged']`, so a flagged row is in view. */
    await page.goto(`./?species=${lone.species}&line=${lone.line}`);
    await onTheApi(page);

    const tile = tileFor(page, row);
    await expect(tile).toBeVisible();
    await expect(page.locator('.tile')).toHaveCount(1);

    /* The page arrives with the record's exception already marked (`page.seedMarks`). */
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');

    /* Take it back: the mark comes off, nothing is written yet, and the record still says
       flagged — which is exactly what TAKING BACK means. */
    await tile.click();
    await expect(tile).not.toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('TAKING BACK');

    /**
     * **The sweep withdraws it** (#135 R7).
     *
     * This assertion used to read `REVIEWED`, on the rule that the sweep accepts everything
     * unmarked and a take-back was the main button's business alone. That was reversed on
     * 2026-09-12: *"if it's already been committed and it shows that it's flagged, then you
     * take it back... then if you hit commit it again, it should be in the vanilla state for
     * that mode."* Either button, the same answer.
     */
    await page.locator('#commit').click();

    /* And the badge must stop claiming the take-back is pending. With the `takingBack`
       derivation preferring the row's stale column over this sitting's outcome (#131), the
       commit lands and the tile goes on offering to take back something already settled. */
    await expect(tile.locator('.badge')).toHaveCount(0);
    await expect(tile).not.toHaveClass(/marked/);

    /* And the record agrees, read back from the endpoint rather than off the screen. */
    expect(await decisionNow(request, 'scientific', lone)).toBe(null);
  } finally {
    await restore(request, 'scientific', claim);
  }
});

/**
 * **#135 R8, in both modes and from both provenances** — the defect he was reporting all
 * along, and the one A6 was opened for and then answered.
 *
 * > *"I am in science mode... something that shows as reviewed and I click it, it just
 * > switches to flagged. ... it should go taking back."*
 * > *"Something already promoted in training mode, I click it and it just goes straight to
 * > excluded, and it should go to taking back. Now let's see if it was excluded and I click
 * > it — it does do taking back."*
 *
 * The last clause is the shape of it: the *exception* values were right, because a page
 * arrives with its exceptions marked and a click removes that mark. The *accepted* values
 * were wrong, because nothing seeds an accept mark, so the same click added an exception and
 * the record went from reviewed straight to flagged with no take-back step in between and no
 * way to reach the vanilla state by clicking at all.
 *
 * Four cases, table-driven so the two that already worked stay covered beside the two that
 * did not — the mode's accepted value is the fix, the mode's exception is the regression.
 */
for (const mode of ['scientific', 'training']) {
  const accepted = mode === 'scientific' ? 'reviewed' : 'promoted';
  const exception = mode === 'scientific' ? 'flagged' : 'excluded';
  for (const [decided, label] of [[accepted, 'accepted'], [exception, 'exception']]) {
    test(`#135 R8: in ${mode}, clicking a committed ${label} takes it back`, async ({ page, request }) => {
      const claim = await claimLoneRow(request, mode);
      const { lone, row } = claim;

      try {
        /* Put the decision on the record before the page is loaded. He confirmed both
           provenances behave the same, and this is the one the client cannot have cached. */
        await commitOne(request, mode, row, { kind: decided === exception ? 'except' : 'accept' });
        expect(await decisionNow(request, mode, lone)).toBe(decided);

        await page.goto(addressFor(mode, lone));
        await onTheApi(page);

        const tile = tileFor(page, row);
        await expect(tile).toBeVisible();
        await expect(page.locator('.tile')).toHaveCount(1);
        await expect(tile.locator('.badge')).toContainText(decided.toUpperCase());

        /* **One ordinary click — the exception gesture, not the right click.** */
        await tile.click();

        await expect(tile.locator('.badge')).toContainText('TAKING BACK');
        /* And specifically *not* the other decision: before the fix, an accepted tile went
           straight to the exception here, which is the whole report. */
        await expect(tile.locator('.badge')).not.toContainText(exception.toUpperCase());
        await expect(tile).not.toHaveClass(/marked/);

        /* Committing it reaches the vanilla state, which is the half that makes the click
           worth anything: reviewed -> flagged was a decision the reviewer could not undo. */
        await page.locator('#commitMarked').click();
        await expect(tile.locator('.badge')).toHaveCount(0);
        expect(await decisionNow(request, mode, lone)).toBe(null);
      } finally {
        await restore(request, mode, claim);
      }
    });
  }
}

test('#135 R8: clicking again puts the decision back, and only a commit reaches the flag',
  async ({ page, request }) => {
    /**
     * **A toggle against the record, not a cycle through states**, answered 2026-09-12:
     *
     * > *"If it's reviewed and you click and it goes to taking back, and then you click it
     * > again, it should go right to where it was already. It shouldn't go to flagged. If
     * > you reviewed, click and go to taking back, and then you hit commit, then it should
     * > clear. And if you hit it again, it should be flagged."*
     *
     * So while a committed decision is on the record, a click is about *that decision* and
     * nothing else — take it back, or leave it alone. A click means "flag this" only once
     * the record carries nothing. **There is no one-click route from a committed acceptance
     * to a flag and that is intended**: taking back is a decision the reviewer commits, and
     * only then can they flag. Do not add a shortcut.
     *
     * A superseded guess is recorded in A8: that the second click applied the exception, so
     * `REVIEWED -> TAKING BACK -> FLAGGED`. It was overturned before it was built.
     */
    const claim = await claimLoneRow(request, 'scientific');
    const { lone, row } = claim;

    try {
      await commitOne(request, 'scientific', row, { kind: 'accept' });
      expect(await decisionNow(request, 'scientific', lone)).toBe('reviewed');

      await page.goto(addressFor('scientific', lone));
      await onTheApi(page);

      const tile = tileFor(page, row);
      await expect(tile.locator('.badge')).toContainText('REVIEWED');

      await tile.click();
      await expect(tile.locator('.badge')).toContainText('TAKING BACK');

      /* Click again: right back where it was. Not flagged, and nothing pending. */
      await tile.click();
      await expect(tile.locator('.badge')).toContainText('REVIEWED');
      await expect(tile.locator('.badge')).not.toContainText('TAKING BACK');
      await expect(tile).not.toHaveClass(/marked/);
      expect(await decisionNow(request, 'scientific', lone)).toBe('reviewed');

      /* Take it back and commit: now the record carries nothing. */
      await tile.click();
      await expect(tile.locator('.badge')).toContainText('TAKING BACK');
      await page.locator('#commitMarked').click();
      await expect(tile.locator('.badge')).toHaveCount(0);
      expect(await decisionNow(request, 'scientific', lone)).toBe(null);

      /* And *now* an ordinary click flags it, because there is no decision to be about. */
      await tile.click();
      await expect(tile).toHaveClass(/marked/);
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
      await page.locator('#commitMarked').click();
      expect(await decisionNow(request, 'scientific', lone)).toBe('flagged');
    } finally {
      await restore(request, 'scientific', claim);
    }
  });

test('R7a: a decision made in an earlier sitting can be taken back', async ({ page, request }) => {
  const claim = await claimLoneRow(request, 'training');
  const { lone, row } = claim;

  try {
    /**
     * A promotion on the record, put there before the page is ever loaded.
     *
     * This is the half of #135 the supervising diagnosis expected to be broken — on the
     * theory that the endpoint never writes the row's status column, so `existingState`
     * would find nothing. It is not broken, and the reason is worth keeping in a test rather
     * than in a note: `ROW_COLUMNS` in `repository/mosaic.repository.js` selects
     * `rt.decision AS training_decision` straight out of `observation_review_current`, so a
     * decision from any earlier sitting arrives *on the row*. What the endpoint does not do
     * is write it back after a commit in **this** sitting, which is #131 and is why
     * `state.outcomes` is preferred over the column.
     */
    await commitOne(request, 'training', row, { kind: 'accept' });
    expect(await decisionNow(request, 'training', lone)).toBe('promoted');

    /* Training opens on `['undecided']`, so a promoted row needs the filter widening or the
       page it is being judged on would not contain it. */
    await page.goto(`./?mode=training&species=${lone.species}&line=${lone.line}`
      + '&trainingDisposition=undecided,promoted,excluded');
    await onTheApi(page);

    const tile = tileFor(page, row);
    await expect(tile).toBeVisible();
    await expect(page.locator('.tile')).toHaveCount(1);
    await expect(tile.locator('.badge')).toContainText('PROMOTED');

    /**
     * **Two right-clicks, and the first one is the open question (A6).**
     *
     * Nothing seeds an *accept* mark — `page.seedMarks` seeds exceptions and says so — so a
     * tile arriving `promoted` arrives unmarked. The first right-click marks it accepted,
     * agreeing with what the record already says; the second removes that mark, and *that*
     * is the take-back. A tile arriving `flagged` or `excluded` is seeded, so one click is
     * enough there, which is the asymmetry A6 names. This test asserts what the app does
     * today rather than what A6 might decide: if the answer is "one click", this is the test
     * that has to change, and it will say so by failing on the second click.
     */
    await tile.click({ button: 'right' });
    await expect(tile).toHaveClass(/marked/);

    await tile.click({ button: 'right' });
    await expect(tile).not.toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('TAKING BACK');
  } finally {
    await restore(request, 'training', claim);
  }
});

test('R7: the page sweep withdraws a take-back instead of deciding it again', async ({ page, request }) => {
  const claim = await claimLoneRow(request, 'training');
  const { lone, row } = claim;

  try {
    /* The issue's own sequence, from the top, so it starts undecided. */
    if (claim.original.decision != null) {
      await commitOne(request, 'training', row, { withdraw: true });
    }

    await page.goto(`./?mode=training&species=${lone.species}&line=${lone.line}`
      + '&trainingDisposition=undecided,promoted,excluded');
    await onTheApi(page);

    const tile = tileFor(page, row);
    await expect(tile).toBeVisible();
    await expect(page.locator('.tile')).toHaveCount(1);

    /* 1. Right click promotes it; Commit Marked records it. */
    await tile.click({ button: 'right' });
    await page.locator('#commitMarked').click();
    await expect(tile.locator('.badge')).toContainText('PROMOTED');
    expect(await decisionNow(request, 'training', lone)).toBe('promoted');

    /* 2. Click it again — the promotion on the record is being taken back. */
    await tile.click({ button: 'right' });
    await expect(tile.locator('.badge')).toContainText('TAKING BACK');

    /**
     * 3. **The page sweep, not the main button** (R7).
     *
     * This is the assertion the test exists for. Before it, the sweep read the tile as
     * merely unmarked and promoted it straight back: badge `PROMOTED`, record `promoted`,
     * and the reviewer's take-back silently undone by the button next to the one that
     * honours it.
     */
    await page.locator('#commit').click();

    await expect(tile.locator('.badge')).toHaveCount(0);
    await expect(tile).not.toHaveClass(/marked/);
    /* The vanilla state for the mode is the *absence* of a projection row (R7b). */
    expect(await decisionNow(request, 'training', lone)).toBe(null);
  } finally {
    await restore(request, 'training', claim);
  }
});
