/**
 * The walkthrough scripts.
 *
 * A scene has three parts, deliberately separated:
 *
 *   caption  what appears on screen — short, because it has to be read at a glance
 *   say      what is spoken — conversational, and spelled for a speech engine
 *            ("Marp", not "MARP", which gets read out as four letters)
 *   act      what the app is driven to do, asserting as it goes
 *
 * A scene is held for as long as its line takes to speak, so lines never talk over
 * one another. Silent runs fall back to a fixed hold.
 */

const tilesIn = (page) => page.locator('.tile:not(.failed):not(.queued)');

/* A page arrives with its existing flags already marked, so a scenario that wants to
   demonstrate marking has to start from a tile nobody has decided about yet. */
const freshTile = (page) => page.locator('.tile:not(.failed):not(.queued):not(.marked)');

/**
 * Mark the first undecided tile and keep hold of it.
 *
 * A locator is re-resolved on every use, and `freshTile` stops matching the instant
 * the tile is marked — so anything that clicks and then keeps using the same locator
 * waits forever. Pin the id first.
 */
async function markFirstFresh(page) {
  const id = await freshTile(page).first().getAttribute('data-id');
  const tile = page.locator(`.tile[data-id="${id}"]`);
  await tile.click();
  return tile;
}

export const scenarios = {

  /* ------------------------------------------------------------- review */
  review: {
    title: 'Scientific Data Review',
    scenes: [
      {
        caption: 'MARP Picture Mosaic Reviewer',
        say: "This is the Marp Picture Mosaic Reviewer. Every tile here is one observation "
           + "that a model produced, and they're all predicted to be the same species. "
           + "That's the whole idea — when they're side by side, the one that doesn't belong "
           + "jumps out at you."
      },
      {
        caption: 'Click a tile to flag it',
        say: "Reviewing is just clicking the ones that look wrong. Let's flag three of them. "
           + "Notice the flag lands straight away — there's no dialog in the way, because "
           + "this is the thing you'll do thousands of times.",
        async act({ page, expect }) {
          for (const i of [0, 1, 2]) {
            await tilesIn(page).nth(i).click();
            await page.waitForTimeout(420);
          }
          await expect(page.locator('.tile.marked')).toHaveCount(3);
        }
      },
      {
        caption: 'The badge opens the panel',
        say: "If you want to say why, click the flag badge itself. That opens this panel. "
           + "The reason is optional — the flag already counts on its own.",
        async act({ page, expect }) {
          await page.locator('[data-badge]').first().click();
          await expect(page.locator('.pick')).toBeVisible();
        }
      },
      {
        caption: 'Choosing a reason',
        say: "Let's say this one is the wrong species.",
        async act({ page }) {
          await page.locator('.pick .chip', { hasText: 'Wrong species' }).click();
        }
      },
      {
        caption: 'Correcting it here, without opening the video',
        say: "And when you already know what it should be, you can fix it right here. "
           + "Search the taxonomy, pick the right one, and it saves immediately.",
        async act({ page, expect }) {
          await page.locator('.pick [data-act="correct"]').click();
          await expect(page.locator('.pick #spSearch')).toBeVisible();
          await page.locator('.pick #spSearch').fill('lea');
          await page.waitForTimeout(800);
          await page.locator('.pick .srow').first().click();
        }
      },
      {
        caption: 'Click anywhere to close',
        say: "Click anywhere outside to close the panel. That click only dismisses — it won't "
           + "unflag whatever happens to be underneath it. The tile now shows what it used to "
           + "be, so you can see at a glance that you changed it.",
        async act({ page, expect }) {
          await page.locator('#field').click({ position: { x: 6, y: 6 } });
          await expect(page.locator('.pick')).toHaveCount(0);
          await expect(page.locator('.tile.marked')).toHaveCount(3);
        }
      },
      {
        caption: 'Mark Page Reviewed',
        say: "Now the important part. Instead of approving every observation one at a time, "
           + "you commit the page. Everything you didn't flag is accepted in a single action. "
           + "The work scales with how many are wrong, not with how many there are.",
        async act({ page, expect, store }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          store.reviewed = await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count();
        }
      },
      {
        caption: 'On to the next page',
        say: "Green means accepted, amber means still open. Let's move on to the next page.",
        async act({ page, settled }) {
          await page.locator('[data-page="next"]').click();
          await settled();
        }
      },
      {
        caption: 'Going back to check',
        say: "But hold on — let's go back and make sure we didn't get that wrong.",
        async act({ page, settled }) {
          await page.locator('[data-page="prev"]').click();
          await settled();
        }
      },
      {
        caption: 'Everything we submitted is still here',
        say: "And there it is, exactly as we left it. The ones we accepted, the ones we "
           + "flagged, and the correction we made. You can change any of it and commit "
           + "again — nothing is locked away just because you moved on.",
        async act({ page, expect, store }) {
          expect(await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count())
            .toBe(store.reviewed);
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      }
    ]
  },

  /* ------------------------------------------------------------- delete */
  delete: {
    title: 'Delete Mode',
    scenes: [
      {
        caption: 'Delete Mode',
        say: "Delete Mode is for clearing out observations that shouldn't exist at all. "
           + "It uses the same rhythm as reviewing, but with one important difference.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          await expect(page.locator('#commit')).toContainText('Delete Marked');
        }
      },
      {
        caption: 'The commit is inverted here',
        say: "In the review modes, committing accepts everything you didn't mark. Here it's "
           + "the opposite: it deletes only what you did mark. Everything else is left alone. "
           + "The header says so, the footer says so, and the button counts them.",
        async act({ page, expect }) {
          await expect(page.locator('.mode-note')).toContainText('permanently deletes');
        }
      },
      {
        caption: 'Marking two for deletion',
        say: "So let's mark two of these. Nothing is deleted yet — this is just a selection, "
           + "and you can undo it right up until you commit.",
        async act({ page, expect }) {
          for (const i of [0, 1]) {
            await tilesIn(page).nth(i).click();
            await page.waitForTimeout(450);
          }
          await expect(page.locator('.tile.marked')).toHaveCount(2);
        }
      },
      {
        caption: 'The whole page is tinted red',
        say: "Notice the whole frame has gone red. The mode colours everything around the "
           + "mosaic, but never the images themselves — because tinting the pictures would "
           + "change how the organisms look, and that's the one thing you're judging.",
        async act() { /* a beat to look at it */ }
      },
      {
        caption: 'Deleting the marked tiles',
        say: "Now we commit, and only the marked ones go.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'DELETED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Deleted tiles stay visible, greyed out',
        say: "The deleted ones stay on the page, greyed out and struck through, so you can "
           + "see what you just did. The others are untouched.",
        async act({ page, expect }) {
          await expect(page.locator('.tile.out-deleted').first()).toBeVisible();
        }
      }
    ]
  },

  /* ----------------------------------------------------------- training */
  training: {
    title: 'Training Data Review',
    scenes: [
      {
        caption: 'Training Data Review',
        say: "Training Data Review looks the same, but it's answering a different question. "
           + "Scientific review asks whether an observation is good data. This asks whether "
           + "it's good enough to teach a model with. Those are separate decisions.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('#commit')).toContainText('Promote Page');
        }
      },
      {
        caption: 'The unit is the whole track',
        say: "Every tile now shows a frame count. What gets promoted isn't this one picture, "
           + "it's the whole tracked observation — so a nine frame track and a fifty frame "
           + "track are very different training samples, and you need to see which is which.",
        async act({ page, expect }) {
          await expect(page.locator('.tile .frames').first()).toBeVisible();
        }
      },
      {
        caption: 'Excluding a track, with a reason',
        say: "Marking here means exclude, not flag. Let's exclude one, and say why we're "
           + "excluding it — this one is occluded, so it would teach the model the wrong shape.",
        async act({ page, expect }) {
          const tile = tilesIn(page).first();
          await tile.click();
          await expect(tile).toHaveClass(/marked/);
          await page.waitForTimeout(400);
          await tile.locator('[data-badge]').click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.locator('.pick .chip', { hasText: 'Occluded' }).click();
          await page.waitForTimeout(400);
          await page.keyboard.press('Escape');
          /* The exclusion has to still be there once the panel is gone — it used to
             be cancelled by the very click that dismissed the panel. */
          await expect(tile).toHaveClass(/marked/);
          await expect(tile.locator('.badge')).toContainText('EXCLUDED');
          await expect(tile.locator('.reason-chip')).toHaveText('Occluded');
          await expect(page.locator('#footCount')).toContainText('1');
        }
      },
      {
        caption: 'Promote Page',
        say: "And committing promotes everything else into the training set. The one we "
           + "excluded stays excluded, with its reason attached. Excluding is a real decision "
           + "that gets recorded — it isn't just the absence of approval.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'PROMOTED' }).first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'EXCLUDED' })).toHaveCount(1);
        }
      }
    ]
  },

  /* ------------------------------------------------------------- overview */
  /* Roughly two minutes, so the script is budgeted: about 290 spoken words at the
     ~150 words a minute the neural voice runs at, plus a second of overhead per
     scene. Every line earns its seconds — this is the video somebody watches once
     to understand what the reviewer is for. */
  overview: {
    title: 'MARP Picture Mosaic Reviewer — overview',
    scenes: [
      {
        caption: 'MARP Picture Mosaic Reviewer',
        say: "Marp turns underwater video into scientific data. Models watch the footage and "
           + "produce observations, thousands an hour — and every one needs a human to say "
           + "whether it is right. This is where that happens."
      },
      {
        caption: 'Why a mosaic',
        say: "The trick is showing them together. These are all predicted to be the same "
           + "species, so the one that does not belong jumps out at you. You are not reading "
           + "records; you scan.",
        async act({ page, expect }) {
          await expect(page.locator('.tile').first()).toBeVisible();
        }
      },
      {
        caption: 'Build the wall: where, then what',
        say: "The filters build that wall. Project, dive, line \u2014 where it came from \u2014 then "
           + "species. Narrow it to one dive, and the mosaic follows.",
        async act({ page, expect, settled }) {
          await page.locator('#selDiveBtn').click();
          await expect(page.locator('.menu')).toBeVisible();
          await page.locator('.menu [data-v]').nth(1).click();
          await settled();
          await expect(page.locator('#selDive')).not.toHaveText('All dives');
        }
      },
      {
        caption: 'Click the ones that look wrong',
        say: "Reviewing is clicking the ones that look wrong. No dialog, no form \u2014 you do "
           + "this thousands of times, so it is one tap. Watch them dim as they are flagged.",
        async act({ page, expect, store }) {
          store.ids = [];
          for (let i = 0; i < 3; i++) {
            const id = await freshTile(page).first().getAttribute('data-id');
            store.ids.push(id);
            await page.locator(`.tile[data-id="${id}"]`).click();
            await page.waitForTimeout(330);
          }
          await expect(page.locator('.tile.marked')).toHaveCount(3);
        }
      },
      {
        caption: 'Say why, and fix it here',
        say: "Click the flag itself to say why. And when you know what it should be, correct "
           + "it here — search the taxonomy, pick the species, and it saves immediately.",
        async act({ page, expect, store }) {
          const tile = page.locator(`.tile[data-id="${store.ids[0]}"]`);
          const before = await tile.locator('.cap').innerText();
          await tile.locator('[data-badge]').click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.locator('.pick .chip', { hasText: 'Wrong species' }).click();
          await page.waitForTimeout(350);
          await page.locator('.pick [data-act="correct"]').click();
          await expect(page.locator('.pick #spSearch')).toBeVisible();
          await page.locator('.pick #spSearch').fill('lea');
          await page.waitForTimeout(700);
          await page.locator('.pick .srow').first().click();
          await expect(page.locator('.pick')).toHaveCount(0);
          /* The caption is the evidence the correction landed. Not the corner chip:
             when a tile carries both a reason and a correction the reason wins that
             slot, so a corrected tile shows no sign it was corrected. Raised with
             the user rather than changed here. */
          await expect(tile.locator('.cap')).not.toHaveText(before);
          await expect(tile).toHaveClass(/changed/);
        }
      },
      {
        caption: 'Commit the page, not each tile',
        say: "Then commit the page. Everything you did not flag is accepted in one action. "
           + "That is the whole idea: the work scales with how many are wrong, not how many "
           + "there are.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('#commit')).toContainText('Saved');
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Pages you have finished stay finished',
        say: "Committed pages go green in the pager, and it counts them. Come back later "
           + "and everything you submitted is still here \u2014 ready to be changed.",
        async act({ page, expect, settled }) {
          await expect(page.locator('#pagesDone')).toContainText('1 of');
          await page.locator('[data-page="next"]').click();
          await settled();
          await page.locator('[data-page="prev"]').click();
          await settled();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Training Data Review',
        say: "Same rhythm, different question. Scientific review asks whether an observation "
           + "is good data. Training review asks whether it is good enough to teach a model "
           + "with. Separate decisions, so it wears its own colour.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('#commit')).toContainText('Promote Page');
          await expect(page.locator('.tile .frames').first()).toBeVisible();
        }
      },
      {
        caption: 'Delete Mode',
        say: "And Delete Mode, for observations that should not exist at all. It shows both "
           + "review and training status first \u2014 because deleting "
           + "cannot be undone.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          await expect(page.locator('#commit')).toContainText('Delete Marked');
          await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');
        }
      },
      {
        caption: 'Three workflows, one gesture',
        say: "Three workflows, one gesture, and the imagery never tinted \u2014 because that is "
           + "what you are judging.",
        async act({ page, expect }) {
          await expect(page.locator('.tile').first()).toBeVisible();
        }
      }
    ]
  },

  /* ------------------------------------------------- verify: mode separation */
  'verify-modes': {
    title: 'Verifying: the modes are separate',
    scenes: [
      {
        caption: 'Checking a fix: modes showing each other\u2019s answers',
        say: "This is a verification run, so watch the badges the whole way through \u2014 the "
           + "badges are where this bug showed. Scientific review and training review are two "
           + "separate decisions about the same observation, and the app was letting one of "
           + "them wear the other one's answer."
      },
      {
        caption: 'Scientific review: flag two, then commit',
        say: "We're in Scientific Data Review. I'll flag two observations and commit the page. "
           + "Pay attention to what appears: green means accepted, amber means flagged. That is "
           + "Scientific review's answer, and it belongs only here.",
        async act({ page, expect }) {
          for (let i = 0; i < 2; i++) {           // .first() each time: the set shrinks
            await markFirstFresh(page);
            await page.waitForTimeout(400);
          }
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Now switch to Training Data Review',
        say: "Now the important part. I'm switching to Training Data Review, and every one of "
           + "those badges should be gone. Before the fix, this screen came up covered in green "
           + "REVIEWED badges that Training review never gave \u2014 and clicking a tile would grey "
           + "it out while it still claimed to be reviewed.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' })).toHaveCount(0);
          await expect(page.locator('.tile.marked')).toHaveCount(0);
        }
      },
      {
        caption: 'Clean \u2014 nothing carried over',
        say: "And there it is. Clean. Every tile shows its frame count and nothing else, because "
           + "Training review has not been asked about any of these yet. Notice the filter on the "
           + "left has changed too \u2014 it reads Training disposition now, not Review status. That "
           + "is the reason nothing shows: Training is reading a different dimension entirely.",
        async act({ page, expect }) {
          await expect(page.locator('#statusLbl')).toHaveText('Training disposition');
          await expect(page.locator('.tile .frames').first()).toBeVisible();
        }
      },
      {
        caption: 'Delete Mode: the flag is meant to show here',
        say: "Delete Mode is different, and this is deliberate, so watch what stays. The "
           + "flag is still on screen. Delete Mode filters on Review status, not on its own "
           + "dimension, because deleting cannot be undone \u2014 and the most useful thing to "
           + "know before removing an observation is what the scientific record already says "
           + "about it. That somebody flagged it. Or worse, that somebody accepted it.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          await expect(page.locator('#statusLbl')).toHaveText('Review status');
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'But nothing here is selected for deletion',
        say: "What has not carried over is the selection. Look at the button: zero tiles. "
           + "Those badges are context, not a decision \u2014 a flag is not a deletion, and marking "
           + "here means something completely different, so nothing arrives marked. You start "
           + "from an empty selection every time.",
        async act({ page, expect }) {
          await expect(page.locator('.tile.marked')).toHaveCount(0);
          await expect(page.locator('#commit')).toContainText('0 tiles');
        }
      },
      {
        caption: 'Back to Scientific: the flag is on the record',
        say: "And back to Scientific review. This is the part to watch closely. The flag we made "
           + "is still here, because committing wrote it to the record \u2014 and look, it comes back "
           + "already marked. That matters more than it sounds: a mark is what the next commit "
           + "treats as the exception, so a flag that came back unmarked would be wiped the next "
           + "time anybody committed this page.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
          await settled();
          await expect(page.locator('.tile.marked').first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      }
    ]
  },

  /* -------------------------------------------- verify: a committed page edits */
  'verify-editing': {
    title: 'Verifying: a committed page is still editable',
    scenes: [
      {
        caption: 'Checking a fix: editing after committing',
        say: "Second verification. After committing a page, nothing could be changed. Clicking a "
           + "tile did alter the state underneath, but the screen never moved \u2014 so it looked "
           + "completely dead. Keep your eye on the first tile through this whole sequence."
      },
      {
        caption: 'Flag one, and commit the page',
        say: "I'll flag the first tile and commit the page. Watch its badge go amber.",
        async act({ page, expect }) {
          await markFirstFresh(page);
          await page.waitForTimeout(500);
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'It is still marked \u2014 that is deliberate',
        say: "Now look at the outline on that tile. It is still marked, and that is on purpose. "
           + "A mark is what the next commit treats as the exception, so the flag we just wrote "
           + "has to stay marked \u2014 otherwise committing again would quietly un-flag it.",
        async act({ page, expect }) {
          await expect(page.locator('.tile.marked').first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Click it to take the flag back',
        say: "So I click it, and watch the badge change. It says TAKING BACK. Nothing is written "
           + "yet \u2014 the record still says flagged, but the next commit will accept it. Before the "
           + "fix, this click appeared to do nothing at all.",
        async act({ page, expect }) {
          await page.locator('.tile.marked').first().click();
          await expect(page.locator('.tile .badge', { hasText: 'TAKING BACK' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Commit again to accept it',
        say: "And committing again accepts it. Amber to green, on a page that had already been "
           + "committed once. That is exactly the thing that was broken.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'TAKING BACK' })).toHaveCount(0);
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
        }
      }
    ]
  },

  /* ------------------------------------------------- verify: the species panel */
  'verify-correction': {
    title: 'Verifying: the correction panel',
    scenes: [
      {
        caption: 'Checking a fix: the panel flickering',
        say: "Third verification, and this one is short. When you corrected a species, the panel "
           + "vanished for a moment and then popped straight back up. Watch the panel this time, "
           + "not the tiles."
      },
      {
        caption: 'Open the panel, then the species chooser',
        say: "Flag a tile, open its badge, and open the species chooser. Opening the chooser goes "
           + "and fetches the taxonomy, and the panel has to stay on screen for the whole of that "
           + "request. Watch it now \u2014 it should not blink.",
        async act({ page, expect }) {
          const tile = await markFirstFresh(page);
          await page.waitForTimeout(350);
          await tile.locator('[data-badge]').click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.locator('.pick [data-act="correct"]').click();
          await expect(page.locator('.pick #spSearch')).toBeVisible();
        }
      },
      {
        caption: 'Search, and choose a species',
        say: "Search the taxonomy, and pick the right one. Here is the moment: the panel should "
           + "close, once, and stay closed. It should not come back.",
        async act({ page }) {
          await page.locator('.pick #spSearch').fill('lea');
          await page.waitForTimeout(700);
          await page.locator('.pick .srow').first().click();
        }
      },
      {
        caption: 'Closed, and it stays closed',
        say: "Gone, and it stays gone. The correction saved immediately, the tile now shows what "
           + "the species used to be, and the flag is still marked \u2014 because correcting a species "
           + "and resolving a flag are two different decisions.",
        async act({ page, expect }) {
          await expect(page.locator('.pick')).toHaveCount(0);
          for (let i = 0; i < 5; i++) {
            await page.waitForTimeout(200);
            await expect(page.locator('.pick')).toHaveCount(0);
          }
          await expect(page.locator('.tile.marked').first()).toBeVisible();
          await expect(page.locator('.reason-chip', { hasText: 'was ' }).first()).toBeVisible();
        }
      }
    ]
  }
};

export const scenarioIds = Object.keys(scenarios);
