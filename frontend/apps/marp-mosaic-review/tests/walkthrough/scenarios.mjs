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

/**
 * Draw the current address into the page, for the video only.
 *
 * A recorded viewport has no browser chrome in it, so the address bar — which is the whole
 * subject of the resumability walkthrough — cannot be seen. This paints it across the top
 * instead. It is scaffolding for the camera and belongs to no test and to no part of the
 * application; nothing outside this file knows it exists.
 */
async function showAddress(page) {
  await page.evaluate(() => {
    let strip = document.getElementById('demoAddress');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'demoAddress';
      strip.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;'
        + 'font:12px/1.9 ui-monospace,Consolas,monospace;padding:0 10px;'
        + 'background:#0b1b24;color:#7fe3ff;border-bottom:1px solid #17414f;'
        + 'pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(strip);
    }
    const url = new URL(window.location.href);
    strip.textContent = decodeURIComponent(url.pathname + url.search) || url.pathname;
  });
}

/** How many observations the current filters match, read off the chrome. */
const totalShown = async (page) =>
  Number((await page.locator('#total').innerText()).replace(/\D/g, ''));

/** Type into one end of a two-ended filter and let the rail's change handler run. */
async function setEnd(page, key, end, value, settled) {
  const box = page.locator(`[data-span="${key}"] [data-end="${end}"]`);
  /* Time and date live behind a summary button since #81, so open the popover first. */
  if (!(await box.count())) await page.locator(`[data-dim="${key}"]`).click();
  await box.fill(value);
  /* `fill` raises `input` and not `change`, and the rail waits for `change`. */
  await box.press('Enter');
  await settled();
}

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
/**
 * Mark the first `n` undecided tiles, one after another.
 *
 * Paced rather than instant: the point of the introduction video is that reviewing is
 * a person going down a wall clicking things, and fifteen tiles vanishing in one frame
 * does not read as work being done.
 */
async function markMany(page, n, gap = 280) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const next = freshTile(page).first();
    if (!(await next.count())) break;
    const id = await next.getAttribute('data-id');
    ids.push(id);
    await page.locator(`.tile[data-id="${id}"]`).click();
    await page.waitForTimeout(gap);
  }
  return ids;
}

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
        async act({ page, expect, store }) {
          const badge = page.locator('[data-badge]').first();
          store.correctedId = await badge.locator('xpath=ancestor::*[@data-id][1]')
            .getAttribute('data-id');
          await badge.click();
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
           + "unflag whatever happens to be underneath it. And because this page is showing one "
           + "predicted species, the one you just corrected is no longer one of them, so it "
           + "leaves. The other two flags stay exactly where they were.",
        async act({ page, expect, store }) {
          await page.locator('#field').click({ position: { x: 6, y: 6 } });
          await expect(page.locator('.pick')).toHaveCount(0);

          /* This asserted three marks and failed on `develop` before #77 ever existed: the
             page filters to one predicted species, so correcting a tile's species takes it
             out of the filter and off the page. The old narration claimed the tile stayed
             and showed what it used to be, which is exactly the kind of line the doctrine
             warns about -- a scene that says one thing while the app does another. */
          await expect(page.locator(`.tile[data-id="${store.correctedId}"]`)).toHaveCount(0);
          await expect(page.locator('.tile.marked')).toHaveCount(2);
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
  /* The introduction. Assumes no prior knowledge: what MARP is, what a false positive
     is and why removing them matters, then each workflow driven at working pace.

     Panels are opened at the start of a scene and left open while the line about them
     plays. An earlier cut did the whole species correction inside one act, so the
     window came and went in two seconds under twelve seconds of narration about it. */
  overview: {
    title: 'MARP Picture Mosaic Reviewer — introduction',
    scenes: [
      {
        caption: 'MARP Picture Mosaic Reviewer',
        say: "This is the Picture Mosaic Reviewer, part of Marp \u2014 the Marine Analysis and "
           + "Reporting Platform."
      },
      {
        caption: 'Where the data comes from',
        say: "Marp turns underwater video into scientific records. A machine learning model "
           + "watches the footage and marks every animal it thinks it sees."
      },
      {
        caption: 'False positives',
        say: "A model gets things wrong in two ways. It misses animals that are there \u2014 false "
           + "negatives. And it marks things that aren't \u2014 false positives. The Picture Mosaic "
           + "Reviewer is how we find the false positives and get rid of them, simply and in "
           + "bulk."
      },
      {
        caption: 'Why a mosaic',
        say: "Instead of one record at a time, we put hundreds on one screen, all the same "
           + "predicted species. Your eye is very good at finding the thing that doesn't match "
           + "in a grid of things that do. That's the trick.",
        async act({ page, expect }) {
          await expect(page.locator('.tile').first()).toBeVisible();
        }
      },
      {
        caption: 'The filters build the query',
        say: "The filters set up the query. Any combination of what's in the database \u2014 "
           + "project, dive, line, species \u2014 and the mosaic is built from whatever you ask for.",
        async act({ page, expect, settled }) {
          /* Opened first and left up, so the list is on screen while it is described. */
          await page.locator('[data-dim="dive"]').click();
          await expect(page.locator('.menu')).toBeVisible();
          await page.waitForTimeout(5200);
          await page.locator('.menu [data-v]').nth(1).click();
          await settled();
          await expect(page.locator('[data-dim="dive"]')).not.toContainText('All dives');
        }
      },
      {
        caption: 'Click the ones that look wrong',
        say: "Then you go through and click the ones that look wrong.",
        async act({ page, expect, store }) {
          store.ids = await markMany(page, 15);
          await expect(page.locator('.tile.marked')).toHaveCount(15);
        }
      },
      {
        caption: 'Recording what was wrong',
        say: "You can click the flag itself if you want to record what was wrong with it \u2014 "
           + "wrong species, false detection, a duplicate. That reason stays with the "
           + "observation for whoever picks it up next.",
        async act({ page, expect, store }) {
          const tile = page.locator(`.tile[data-id="${store.ids[0]}"]`);
          await tile.locator('[data-badge]').click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.waitForTimeout(4200);
          await page.locator('.pick .chip', { hasText: 'Wrong species' }).click();
          /* Left open: the next scene continues in this same panel. */
        }
      },
      {
        caption: 'Change the observation here',
        say: "And if you already know what it actually is, you can change the observation "
           + "right here in this window. Search the taxonomy, pick the right species, and it "
           + "saves immediately. No need to open the video.",
        async act({ page, expect, store }) {
          const tile = page.locator(`.tile[data-id="${store.ids[0]}"]`);
          const before = await tile.locator('.cap').innerText();
          await page.locator('.pick [data-act="correct"]').click();
          await expect(page.locator('.pick #spSearch')).toBeVisible();
          await page.waitForTimeout(2600);
          await page.locator('.pick #spSearch').fill('lea');
          await page.waitForTimeout(3200);           // the matches, on screen, being read
          await page.locator('.pick .srow').first().click();
          await expect(page.locator('.pick')).toHaveCount(0);
          await expect(tile.locator('.cap')).not.toHaveText(before);
        }
      },
      {
        caption: 'Commit the page',
        say: "Then you commit the entire page. That takes care of fifty records at once \u2014 "
           + "everything you didn't flag is accepted, and the ones you flagged keep their flag.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('#commit')).toContainText('Saved');
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Approving training data',
        say: "In addition to approving the scientific data, we approve the training data the "
           + "same way. Here we un-approve the ones we don't want teaching the next model, "
           + "save, and everything else is promoted.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await markMany(page, 15, 220);
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'PROMOTED' }).first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'EXCLUDED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Deleting',
        say: "And deleting works the same way. Mark what shouldn't be in the database at all, "
           + "and commit. Those records are gone.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          await markMany(page, 10, 220);
          await page.locator('#commit').click();
          await expect(page.locator('.tile.out-deleted').first()).toBeVisible();
        }
      },
      {
        caption: 'And on to page two',
        say: "Then on to page two, and we delete half of these as well.",
        async act({ page, expect, settled }) {
          await page.locator('[data-page="next"]').click();
          await settled();
          const total = await page.locator('.tile:not(.failed):not(.queued)').count();
          await markMany(page, Math.floor(total / 2), 150);
          await page.locator('#commit').click();
          await expect(page.locator('.tile.out-deleted').first()).toBeVisible();
        }
      },
      {
        caption: 'MARP Picture Mosaic Reviewer',
        say: "Using the Marp Picture Mosaic Reviewer gives us a very efficient way to review a "
           + "model's false positives, and approve or reject them."
      }
    ]
  },

  /* ------------------------------------------------- verify: mode separation */
  /* --------------------------------------- verify: the delete confirmation */
  /* Short and single-purpose: show that a permanent delete now stops and asks, that
     cancelling really does nothing, and that confirming really does delete. Every line
     asserts what it claims -- a scene that narrates a result without asserting it can
     lie, and this is the one workflow where that would matter most. */
  /* ------------------------------------------------- verifying: the filters */
  'verify-filters': {
    title: 'Verifying: the filter rail',
    scenes: [
      {
        caption: 'Ten filters, one list',
        say: "The rail used to be five filters in a column. It is ten now. They were "
           + "briefly grouped under four headings, and the headings cost more room than "
           + "they bought — without them the whole rail fits on screen.",
        async act({ page, expect }) {
          const labels = await page.locator('#railDimensions .lbl').allInnerTexts();
          expect(labels.length).toBe(10);
          expect(await page.locator('.railgroup__title').count()).toBe(0);
          /* And the point of removing them: the bottom of the rail is reachable. */
          await expect(page.locator('#statusFilters [data-status="reviewed"]')).toBeVisible();
        }
      },
      {
        caption: 'More than one at a time',
        say: "The first thing that changed is that you are no longer stuck with one. "
           + "Watch the dive filter — I am picking two dives, and the menu stays open, "
           + "because picking several is the normal case and not a special one.",
        async act({ page, expect, settled, store }) {
          store.all = await totalShown(page);
          await page.locator('[data-dim="dive"]').click();
          await expect(page.locator('.menu')).toBeVisible();

          await page.locator('.menu [data-v]').nth(1).click();   // nth(0) clears
          await page.waitForTimeout(500);
          await page.locator('.menu [data-v]').nth(2).click();
          await page.keyboard.press('Escape');
          await settled();

          /* Two chosen, and the mosaic is genuinely narrower for it. Two names still fit
             on the button, so it lists them; a third would collapse to a count. */
          await expect(page.locator('[data-dim="dive"]')).toHaveText(/Dive .+,\s*Dive .+/);
          store.twoDives = await totalShown(page);
          expect(store.twoDives).toBeLessThan(store.all);
        }
      },
      {
        caption: 'Dropping one keeps the other',
        say: "And taking one back off leaves the other exactly where it was. That sounds "
           + "obvious, but the old rail cleared everything underneath whenever you touched "
           + "anything above it — so a selection you had spent a minute assembling vanished "
           + "because you changed your mind about one dive.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-dim="dive"]').click();
          await page.locator('.menu [data-v]').nth(2).click();   // untoggle the second
          await page.keyboard.press('Escape');
          await settled();

          await expect(page.locator('[data-dim="dive"]')).not.toContainText('All dives');
          const oneDive = await totalShown(page);
          expect(oneDive).toBeLessThan(store.twoDives);
        }
      },
      {
        caption: 'How sure the model was',
        say: "Confidence is a range now, with both ends. Pull the top end down and you get "
           + "the calls the model was least sure about — which is exactly where the mistakes "
           + "are, so that is usually the page worth looking at first.",
        async act({ page, expect, settled }) {
          const before = await totalShown(page);
          const to = page.locator('[data-span="confidence"] [data-end="to"]');
          /* A range input is dragged, not typed into, so drive it the way the browser
             would and let the rail's own change handler do the rest. */
          await to.evaluate((el) => {
            el.value = '0.7';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settled();
          expect(await totalShown(page)).toBeLessThan(before);
          await expect(page.locator('[data-span="confidence"]')).toBeVisible();
        }
      },
      {
        caption: 'Clearing it again',
        say: "Before the next one, let us put confidence back. An empty filter means it is "
           + "not filtering. It never means show me nothing.",
        async act({ page, expect, settled }) {
          const narrow = await totalShown(page);
          const to = page.locator('[data-span="confidence"] [data-end="to"]');
          await to.evaluate((el) => {
            el.value = '1';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settled();
          expect(await totalShown(page)).toBeGreaterThan(narrow);
        }
      },
      {
        caption: 'Time of day',
        say: "Every observation carries a time of day, so this one always works. Here is the "
           + "tail end of the night. Five in the morning until just before seven.",
        async act({ page, expect, settled, store }) {
          await setEnd(page, 'timeOfDay', 'from', '05:00', settled);
          await setEnd(page, 'timeOfDay', 'to', '06:59', settled);
          store.oneSide = await totalShown(page);
          expect(store.oneSide).toBeGreaterThan(0);
        }
      },
      {
        caption: 'And it wraps past midnight',
        say: "Now watch the count. I am moving the end of that window round to one in the "
           + "morning, so it starts at five and finishes after midnight. A dive that runs "
           + "from dusk into the small hours is one night, not two — and written the obvious "
           + "way, a window like that matches nothing at all.",
        async act({ page, expect, settled, store }) {
          await setEnd(page, 'timeOfDay', 'to', '01:00', settled);
          const wrapped = await totalShown(page);
          /* The whole claim: the far side of midnight is included, so this is bigger
             rather than empty. */
          expect(wrapped).toBeGreaterThan(store.oneSide);
        }
      },
      {
        caption: 'Dates, and what it cannot see',
        say: "The date filter is the one that cannot always answer. A time code only carries "
           + "a date where the clock was synced, and plenty of the record was never synced. "
           + "So watch what appears underneath it when I ask for a date range.",
        async act({ page, expect, settled }) {
          await setEnd(page, 'timeOfDay', 'from', '', settled);
          await setEnd(page, 'timeOfDay', 'to', '', settled);
          await setEnd(page, 'date', 'from', '2019-01-01', settled);

          const note = page.locator('[data-note="date"]');
          await expect(note).toBeVisible();
          const said = await note.innerText();
          expect(Number(said.replace(/\D/g, ''))).toBeGreaterThan(0);
        }
      },
      {
        caption: 'It says what it left out',
        say: "It tells you how many it had to leave out. Until an hour ago it did not. "
           + "The number was counted, and the line was written to show it, and nothing "
           + "carried the one to the other — so the mosaic simply emptied and said nothing, "
           + "which looks exactly like there being no data. A filter that quietly omits is "
           + "worse than no filter at all.",
        async act({ page, expect }) {
          const said = await page.locator('[data-note="date"]').innerText();
          expect(said.toLowerCase()).toContain('no recorded date');
        }
      }
    ]
  },

  /* -------------------------------------------- verifying: coming back to it */
  'verify-resume': {
    title: 'Verifying: the question survives a reload',
    scenes: [
      {
        caption: 'The address is the whole memory',
        say: "Everything you ask the reviewer for now lives in the address. Nothing is "
           + "stored anywhere else — no hidden settings, no local storage. I have painted "
           + "the address across the top of the page, because a recording does not capture "
           + "the browser's own address bar. Watch it change as I go.",
        async act({ page, expect }) {
          await showAddress(page);
          await expect(page.locator('#demoAddress')).toBeVisible();
          /* The default question is a bare address, which is what makes a plain link to
             the tool still mean "everything". */
          expect(await page.locator('#demoAddress').innerText()).not.toContain('?');
        }
      },
      {
        caption: 'Two dives at once',
        say: "Start with a couple of dives. Two at a time, which the rail could not do "
           + "before. Watch the top of the screen — the dives appear in the address as I "
           + "pick them.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-dim="dive"]').click();
          await page.locator('.menu [data-v]').nth(1).click();
          await page.waitForTimeout(450);
          await page.locator('.menu [data-v]').nth(2).click();
          await page.keyboard.press('Escape');
          await settled();
          await showAddress(page);

          await expect(page.locator('#demoAddress')).toContainText('dive=');
          store.dives = await page.locator('[data-dim="dive"] span').first().innerText();
        }
      },
      {
        caption: 'A range, not a single value',
        say: "Now a different kind of filter altogether. Confidence is a range with two "
           + "ends, and it goes into the address as a range — the two numbers with a pair "
           + "of dots between them.",
        async act({ page, expect, settled }) {
          const to = page.locator('[data-span="confidence"] [data-end="to"]');
          await to.evaluate((el) => {
            el.value = '0.95';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settled();
          await showAddress(page);
          await expect(page.locator('#demoAddress')).toContainText('confidence=');
        }
      },
      {
        caption: 'And a time of day',
        say: "And a third kind — a window of time, which reads in the address exactly the "
           + "way you would say it out loud. Three in the morning until two, which is a "
           + "window that wraps past midnight, and it survives being written down as one.",
        async act({ page, expect, settled, store }) {
          await setEnd(page, 'timeOfDay', 'from', '03:00', settled);
          await setEnd(page, 'timeOfDay', 'to', '02:00', settled);
          await showAddress(page);

          await expect(page.locator('#demoAddress')).toContainText('timeOfDay=03:00..02:00');
          store.total = await totalShown(page);
          expect(store.total).toBeGreaterThan(0);
          /* The next scene pages forward, so the filters have to leave somewhere to go.
             They once left a single page and 'Next' was a silent no-op. */
          expect(await page.evaluate(() => window.MARP.state.pageCount)).toBeGreaterThan(1);
        }
      },
      {
        caption: 'Where you are, too',
        say: "The page you are on goes in as well. Move to the second page and the address "
           + "picks it up, so a link lands somebody exactly where you were rather than back "
           + "at the beginning.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-page="next"]').click();
          await settled();
          await showAddress(page);

          await expect(page.locator('#demoAddress')).toContainText('page=2');
          store.link = page.url();
          expect(await page.evaluate(() => window.MARP.state.page)).toBe(2);
        }
      },
      {
        caption: 'Flag something first',
        say: "Before I close it, let me flag a tile — because what comes back matters as "
           + "much as what does. Watch this one.",
        async act({ page, expect, settled }) {
          await settled();
          const tile = page.locator('.tile:not(.failed):not(.queued)').first();
          await tile.click();
          await expect(page.locator('.tile.marked')).toHaveCount(1);
        }
      },
      {
        caption: 'Now come back to it cold',
        say: "This is the bookmark. I am throwing the whole page away and opening that "
           + "address again from nothing, the way you would tomorrow morning. Two dives, "
           + "the confidence range, the time window, and the second page — all of it back.",
        async act({ page, expect, settled, store }) {
          await page.goto(store.link);
          await settled();
          await showAddress(page);

          await expect(page.locator('[data-dim="dive"] span').first()).toHaveText(store.dives);
          await expect(page.locator('#demoAddress')).toContainText('confidence=');
          await expect(page.locator('#demoAddress')).toContainText('timeOfDay=03:00..02:00');
          expect(await page.evaluate(() => window.MARP.state.page)).toBe(2);
          expect(await totalShown(page)).toBe(store.total);
        }
      },
      {
        caption: 'The flag did not come back',
        say: "The flag did not. That is deliberate, not a gap. A mark is not a decision "
           + "until the page is committed, and a flag that came back would look exactly "
           + "like one that had been written to the record while the record knew nothing "
           + "about it. The question comes back; work you never submitted does not.",
        async act({ page, expect }) {
          await expect(page.locator('.tile.marked')).toHaveCount(0);
        }
      },
      {
        caption: 'And one gesture puts it all back',
        say: "Last thing. Clearing ten filters one at a time is not a gesture, so there is "
           + "a Reset in the corner of the rail. It puts you back to the default question "
           + "and empties the address with it — but it leaves you in the mode you were "
           + "working in, because clearing your filters is not the same as leaving the job.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          await showAddress(page);

          await expect(page.locator('[data-dim="dive"]')).toContainText('All dives');
          expect(await page.locator('#demoAddress').innerText()).not.toContain('?');
        }
      }
    ]
  },

  /* ------------------------------------------------- verifying: the rail rebuilt */
  'verify-rail': {
    title: 'Verifying: the filter rail, rebuilt',
    scenes: [
      {
        caption: 'One list, not four groups',
        say: "The rail had become crowded and buggy, so it has been rebuilt. The four "
           + "group headings are gone, the processor filter is gone, and there is a reset "
           + "in the corner. What is left is one ordered list you can read down.",
        async act({ page, expect }) {
          await expect(page.locator('.railgroup__title')).toHaveCount(0);
          await expect(page.locator('#railReset')).toBeVisible();
          await expect(page.locator('[data-dim="processor"]')).toHaveCount(0);
          /* L7: the rail was clipping. The status filters live below the dimensions and
             were being drawn off the bottom where nobody could reach them. */
          await expect(page.locator('#statusFilters [data-statuskey]').first()).toBeVisible();
        }
      },
      {
        caption: 'Choosing one unticks "all"',
        say: "Here is the first bug. Open a filter and pick a value: All projects unticks "
           + "the moment you choose one, rather than staying ticked until you close the "
           + "menu and wonder which of the two you are actually filtering by.",
        async act({ page, expect }) {
          await page.locator('[data-dim="project"]').click();
          const menu = page.locator('.menu');
          await expect(menu).toBeVisible();
          const all = menu.locator('[data-v]').first();
          await expect(all).toHaveClass(/on/);          // "All projects" starts ticked

          await menu.locator('[data-v]').nth(1).click();
          await page.waitForTimeout(500);
          await expect(menu.locator('[data-v]').first()).not.toHaveClass(/on/);
          await expect(menu.locator('[data-v]').nth(1)).toHaveClass(/on/);
        }
      },
      {
        caption: 'And its own button closes it',
        say: "Second bug. Clicking the button that opened a menu now closes it, which is "
           + "what every dropdown anywhere does. It used to do nothing, because the rail "
           + "redraws itself and the button holding the menu open was no longer the same "
           + "button by the time you clicked it.",
        async act({ page, expect, settled }) {
          await page.locator('[data-dim="project"]').click();
          await expect(page.locator('.menu')).toHaveCount(0);
          await settled();
        }
      },
      {
        caption: 'The stray label beside each status',
        say: "Third. Every status filter was drawing a second grey pill next to it reading "
           + "reviewStatus. It was not a control at all — the keyboard shortcut badges are "
           + "drawn from a data attribute, and the status filters happened to use the same "
           + "attribute name for something else. They now use their own.",
        async act({ page, expect }) {
          await expect(page.locator('#statusFilters [data-key]')).toHaveCount(0);
          await expect(page.locator('#statusFilters [data-statuskey]').first()).toBeVisible();
        }
      },
      {
        caption: 'Session type narrows the sessions',
        say: "Session type sits above session now, and it is not only cosmetic — a session "
           + "belongs to a type, so choosing the type narrows which sessions are even on "
           + "offer. These are the real values from the database, inconsistent capitals and "
           + "all.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-dim="session"]').click();
          store.allSessions = await page.locator('.menu [data-v]').count();
          await page.keyboard.press('Escape');

          await page.locator('[data-dim="sessionType"]').click();
          const types = await page.locator('.menu [data-v]').allInnerTexts();
          expect(types.join(' ')).toContain('Fish_GULF');
          await page.locator('.menu [data-v]').nth(1).click();
          await page.keyboard.press('Escape');
          await settled();

          await page.locator('[data-dim="session"]').click();
          const narrowed = await page.locator('.menu [data-v]').count();
          await page.keyboard.press('Escape');
          expect(narrowed).toBeLessThan(store.allSessions);
        }
      },
      {
        caption: 'One track, two handles',
        say: "Confidence was two separate sliders stacked up. It is one track with two "
           + "handles now, which is what a range actually looks like. Watch the count as I "
           + "pull the top end down.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          const before = await totalShown(page);

          const dual = page.locator('.dual[data-span="confidence"]');
          await expect(dual).toBeVisible();
          await expect(dual.locator('input[type="range"]')).toHaveCount(2);

          await dual.locator('[data-end="to"]').evaluate((el) => {
            el.value = '0.8';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settled();
          expect(await totalShown(page)).toBeLessThan(before);
        }
      },
      {
        caption: 'Time of day, in 24-hour',
        say: "Time and date were four boxes wedged into the rail. Each is one row now, "
           + "opening a small panel. And the clock is twenty-four hour — a native time "
           + "field takes its format from the browser, and there is no way to make it "
           + "behave, so these are plain text fields that understand what you type.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          await page.locator('[data-dim="timeOfDay"], [data-panel="timeOfDay"]').first().click();
          const panel = page.locator('.menu');
          await expect(panel).toBeVisible();
          await expect(panel.locator('.clock').first()).toHaveAttribute('type', 'text');
          await expect(panel).toContainText('24-hour');

          await panel.locator('[data-end="from"]').fill('22:00');
          await panel.locator('[data-end="to"]').fill('02:00');
          await panel.locator('[data-end="to"]').press('Enter');
          await page.keyboard.press('Escape');
          await settled();
        }
      },
      {
        caption: 'Sorting, with a tie-break',
        say: "And sorting. There were five fixed orders in a list. Now you choose the "
           + "field and the direction separately — and then what to do where that field "
           + "ties, which is the part that was missing. Watch the order of the tiles when "
           + "I set the tie-break.",
        async act({ page, expect, settled, store }) {
          await page.locator('#railReset').click();
          await settled();
          store.before = await page.locator('.tile').evaluateAll(
            (els) => els.map((e) => e.dataset.id).join(','));

          await page.locator('#sortBtn').click();
          const menu = page.locator('.menu');
          await expect(menu).toContainText('Then, where that ties');
          await menu.locator('[data-v="then:keyframe_count"]').click();
          await page.waitForTimeout(400);
          await menu.locator('[data-v="then:desc"]').click();
          await page.keyboard.press('Escape');
          await settled();

          /* The claim is that the tie-break actually reorders, not merely that the menu
             remembered the click. */
          const after = await page.locator('.tile').evaluateAll(
            (els) => els.map((e) => e.dataset.id).join(','));
          expect(after).not.toBe(store.before);
          await expect(page.locator('#sortLabel')).toContainText('Track length');
        }
      }
    ]
  },

  /* ------------------------------------------------ verifying: the demo imagery */
  'verify-imagery': {
    title: 'Verifying: the demo data',
    scenes: [
      {
        caption: 'Real photographs, five species',
        say: "The mosaic is running on real pictures now — fifty-eight of them across five "
           + "species, reused across three thousand observations. Reuse costs nothing here: "
           + "you are judging the organism against the name it was given, not whether you "
           + "have seen this exact frame before.",
        async act({ page, expect }) {
          const srcs = await page.locator('.tile img').evaluateAll(
            (els) => els.map((e) => e.getAttribute('src')));
          const real = srcs.filter((s) => s && !s.includes('marp-mark'));
          expect(real.length).toBeGreaterThan(30);
          expect(real.every((s) => s.endsWith('.jpg'))).toBe(true);
        }
      },
      {
        caption: 'A couple on every page are wrong',
        say: "And this is what the tool is for. Every tile here claims to be a bat star. "
           + "About two on each page are not — the label is what the model said, and the "
           + "picture is what is really there. Those two things being different is the "
           + "whole job.",
        async act({ page, expect }) {
          const caps = await page.locator('.tile .cap').allInnerTexts();
          expect(caps.every((c) => c.trim() === 'Bat Star')).toBe(true);
          expect(caps.length).toBeGreaterThan(20);
        }
      },
      {
        caption: 'Whichever species you ask for',
        say: "It is not only bat stars. Every species carries the same rate, so filtering "
           + "to rock crabs gives you pages of crabs with a couple of intruders — because "
           + "four of the five species used to lead somewhere with nothing to practise on.",
        async act({ page, expect, settled }) {
          await page.locator('[data-dim="species"]').click();
          await page.locator('.menu .msearch').fill('Rock Crab');
          await page.waitForTimeout(400);
          await page.locator('.menu [data-v]').first().click();
          await page.locator('.menu .msearch').fill('Bat Star');
          await page.waitForTimeout(400);
          await page.locator('.menu [data-v]').first().click();
          await page.keyboard.press('Escape');
          await settled();

          const caps = await page.locator('.tile .cap').allInnerTexts();
          expect(caps.length).toBeGreaterThan(10);
          expect(caps.every((c) => c.trim() === 'Rock Crab')).toBe(true);
        }
      },
      {
        caption: 'Deleting counts what it will destroy',
        say: "One last thing, and it is the serious one. In delete mode, a tile whose "
           + "picture never arrived can still be marked — and the commit really does delete "
           + "it. The confirmation was leaving those out of its count, so it would say one "
           + "observation and then destroy two. It counts everything it is about to "
           + "destroy now.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();

          /* Break one deliberately rather than hoping the page happens to hold one. A
             scene that quietly returns when its subject is absent narrates a claim it
             never checked, which is the one thing a walkthrough must never do. */
          const brokenId = await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            const { MarpData } = await import('./src/data.js');
            const id = state.rows[2].observation_id;
            MarpData.breakThumbnails([id]);
            await actions.refresh();
            return id;
          });
          await settled();
          await expect(page.locator(`.tile[data-id="${brokenId}"]`)).toHaveClass(/failed/);
          await page.locator(`.tile[data-id="${brokenId}"]`).click();
          const good = page.locator('.tile:not(.failed):not(.queued)').first();
          await good.click();
          await expect(page.locator('.tile.marked')).toHaveCount(2);

          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          /* Two marked, two named. The one with no picture is not quietly left out. */
          await expect(page.locator('.confirm__title')).toContainText('2 observations');
          await page.keyboard.press('Escape');
        }
      }
    ]
  },

  /* --------------------------------- verifying: both workflows in every rail */
  'verify-status-filters': {
    title: 'Verifying: filtering on either workflow',
    scenes: [
      {
        caption: 'Both workflows, in every mode',
        say: "Until now, scientific review could only filter on scientific review, and "
           + "training could only filter on training. Delete could do both. Delete's rail "
           + "is the one the other two have now — six status boxes, two workflows, "
           + "whichever mode you are in.",
        async act({ page, expect }) {
          const boxes = page.locator('#statusFilters [data-statuskey]');
          await expect(boxes).toHaveCount(6);
          const keys = await boxes.evaluateAll(
            (els) => [...new Set(els.map((e) => e.dataset.statuskey))].sort());
          expect(keys).toEqual(['reviewStatus', 'trainingDisposition']);
        }
      },
      {
        caption: 'And the default view did not move',
        say: "This is the part that mattered most, and it is the part you cannot see. "
           + "Training disposition defaults to undecided. If that default had been applied "
           + "here, scientific review would silently have lost every promoted and every "
           + "excluded observation — about a hundred and fifty of them — and nothing on "
           + "screen would have said so. A borrowed filter arrives switched off.",
        async act({ page, expect, store }) {
          store.total = await totalShown(page);
          expect(store.total).toBeGreaterThan(1000);

          /* Nothing borrowed is narrowing: the two training boxes are all unticked. */
          const on = await page.locator('#statusFilters [data-statuskey="trainingDisposition"] .box.on')
            .count();
          expect(on).toBe(0);
        }
      },
      {
        caption: 'Filtering scientific review by a training decision',
        say: "So now you can ask a question that crosses the two. Show me, in scientific "
           + "review, only the observations training has already excluded. Watch the count "
           + "collapse.",
        async act({ page, expect, settled, store }) {
          await page.locator('#statusFilters [data-statuskey="trainingDisposition"]',
            { hasText: 'Excluded' }).click();
          await settled();

          const narrowed = await totalShown(page);
          expect(narrowed).toBeGreaterThan(0);
          expect(narrowed).toBeLessThan(store.total);
          store.narrowed = narrowed;
        }
      },
      {
        caption: 'And every tile says why it is here',
        say: "Every tile on this page carries the excluded tag, from the training workflow, "
           + "while you are standing in scientific review. That is the pair working "
           + "together — the tags told you what had happened to an observation, and now the "
           + "filter lets you go and find them.",
        async act({ page, expect }) {
          const tags = page.locator('.tile .rtag, .tile .badge').filter({ hasText: 'EXCLUDED' });
          expect(await tags.count()).toBeGreaterThan(0);
        }
      },
      {
        caption: 'Switch it off and you are back',
        say: "Untick it and the count comes straight back to where it started. Nothing was "
           + "left applied behind the scenes.",
        async act({ page, expect, settled, store }) {
          await page.locator('#statusFilters [data-statuskey="trainingDisposition"]',
            { hasText: 'Excluded' }).click();
          await settled();
          expect(await totalShown(page)).toBe(store.total);
        }
      },
      {
        caption: 'It works the other way too',
        say: "And it is symmetrical. Over in training data review, you can filter by what "
           + "science decided — show me the ones a scientist already flagged, so I do not "
           + "promote something that is under question.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('#statusFilters [data-statuskey]')).toHaveCount(6);

          const before = await totalShown(page);
          await page.locator('#statusFilters [data-statuskey="reviewStatus"]',
            { hasText: 'Flagged' }).click();
          await settled();
          expect(await totalShown(page)).not.toBe(before);
        }
      },
      {
        caption: 'Coming back to what you already reviewed',
        say: "Two other fixes are on this branch. First: review a page, wander off to "
           + "another workflow, and come back. What you submitted is still there. Switching "
           + "mode used to throw the whole session away, so three reviewed pages became "
           + "unfindable the moment you glanced at training.",
        async act({ page, expect, settled, store }) {
          await page.locator('#railReset').click();
          await settled();
          await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
          await settled();

          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await settled();

          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
          await settled();

          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          expect(await page.evaluate(() => window.MARP.state.committedPages.size)).toBe(1);
        }
      },
      {
        caption: 'And the count means this page',
        say: "Second: marked this page now counts this page. It was counting every mark you "
           + "had made anywhere in the session, so it only ever went up — and delete mode "
           + "put that same running total in front of a permanent deletion.",
        async act({ page, expect, settled }) {
          await page.locator('[data-page="next"]').click();
          await settled();

          const shown = Number(await page.locator('#markedCount').innerText());
          const marked = await page.locator('.tile.marked').count();
          expect(shown).toBe(marked);

          await page.locator('.tile:not(.failed):not(.queued):not(.marked)').first().click();
          expect(Number(await page.locator('#markedCount').innerText())).toBe(shown + 1);
        }
      }
    ]
  },

  'verify-delete-confirmation': {
    title: 'Verifying: nothing is deleted without confirming',
    scenes: [
      {
        caption: 'Six marked for deletion',
        say: "Delete mode. Six observations marked to be permanently removed.",
        async act({ page, expect, settled, store }) {
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          store.ids = await markMany(page, 6, 200);
          await expect(page.locator('.tile.marked')).toHaveCount(6);
        }
      },
      {
        caption: 'It stops and asks',
        say: "Before this change, committing here destroyed them immediately, with no "
           + "warning at all. Now it stops, and it tells you exactly what you are about "
           + "to lose.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          await expect(page.locator('.confirm__title')).toContainText('6 observations');
          await expect(page.locator('.confirm__warn')).toContainText('cannot be undone');
          await page.waitForTimeout(3800);       // long enough to actually read it
        }
      },
      {
        caption: 'Cancel changes nothing',
        say: "Cancel, and all six are still marked. Nothing was sent, so the page does "
           + "not have to be done again.",
        async act({ page, expect }) {
          await page.locator('[data-confirm="cancel"]').click();
          await expect(page.locator('.confirm__box')).toHaveCount(0);
          await expect(page.locator('.tile.marked')).toHaveCount(6);
          await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
          await page.waitForTimeout(900);
        }
      },
      {
        caption: 'Confirming deletes exactly six',
        say: "Commit again, confirm, and now they are gone. Six marked, six deleted.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          await page.waitForTimeout(1100);
          await page.locator('[data-confirm="go"]').click();
          await expect(page.locator('.tile.out-deleted')).toHaveCount(6);
          await page.waitForTimeout(900);
        }
      }
    ]
  },

  /* --------------------------------- verify: the states never rendered */
  /* Four states the grid could always reach and had never drawn. Every scene asserts what
     it claims -- the empty message, the disabled commit, the skip note, the recovery. */
  'verify-empty-and-broken': {
    title: 'Verifying: the empty and broken states',
    scenes: [
      {
        caption: 'A filter that matches nothing',
        say: "Ask for something that isn't there. Until now the mosaic just went blank — "
           + "no message, no way back.",
        async act({ page, expect }) {
          await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            state.filters.species = 'No Such Species';
            await actions.refresh();
          });
          await expect(page.locator('.pagestate--empty')).toBeVisible();
          await expect(page.locator('.pagestate--empty')).toContainText('Nothing to review here');
          await page.waitForTimeout(2600);
        }
      },
      {
        caption: 'One way back',
        say: "It says so, and it offers the one thing worth offering — clear the filters. "
           + "The rail has five dimensions and working out which one emptied it is not "
           + "the reviewer's job.",
        async act({ page, expect, settled }) {
          await page.locator('[data-act="clear-filters"]').click();
          await settled();
          await expect(page.locator('.tile').first()).toBeVisible();
          await expect(page.locator('.pagestate')).toHaveCount(0);
        }
      },
      {
        caption: 'When the imagery never arrives',
        say: "Now break every thumbnail on the page. The observations are still here and "
           + "still real — but there is nothing to look at.",
        async act({ page, expect, settled }) {
          await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            const { MarpData } = await import('./src/data.js');
            MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
            await actions.refresh();
          });
          await expect(page.locator('.pagestate--banner')).toBeVisible();
          await page.waitForTimeout(2400);
        }
      },
      {
        caption: 'The commit stops pretending',
        say: "The commit button used to look perfectly normal here and would have done "
           + "nothing at all. Now it is disabled, and it says why.",
        async act({ page, expect }) {
          await expect(page.locator('#commit')).toBeDisabled();
          await expect(page.locator('#commit')).toContainText('nothing to do');
          await page.waitForTimeout(2800);
        }
      },
      {
        caption: 'You can still flag what you could not see',
        say: "This is the important part. A flag is a reviewer saying something is wrong, "
           + "and a missing picture is worth flagging. That flag reaches the database, "
           + "even though nobody could see the observation. Until now it was silently "
           + "thrown away.",
        async act({ page, expect }) {
          const id = await page.locator('.tile').first().getAttribute('data-id');
          await page.locator(`.tile[data-id="${id}"]`).click();
          await expect(page.locator('.tile.marked')).toHaveCount(1);
          await expect(page.locator('#commit')).toBeEnabled();
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
          await page.waitForTimeout(1800);
        }
      },
      {
        caption: 'And you can ask for the picture again',
        say: "The server refetches missing imagery on its own, and you can ask again from "
           + "here. The thumbnails come back, and the page carries on.",
        async act({ page, expect }) {
          await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            const { MarpData } = await import('./src/data.js');
            MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
            await actions.refresh();
          });
          await expect(page.locator('.pagestate--banner')).toBeVisible();
          await page.locator('[data-act="retry-thumbnails"]').click();
          await expect(page.locator('.pagestate--banner')).toHaveCount(0, { timeout: 25000 });
          await page.waitForTimeout(1200);
        }
      }
    ]
  },

  /* ------------------------------------------- verify: the shortcuts */
  /* Short. The keyboard is not the speed path here -- the pointer is -- so this shows
     the four things worth a key and the one that deliberately refuses. */
  'verify-shortcuts': {
    title: 'Verifying: the keyboard shortcuts',
    scenes: [
      {
        caption: 'The pointer still does the choosing',
        say: "The keyboard is not how you pick tiles. Pointing at the odd one out is one "
           + "action; arrowing across a grid is several. So the pointer selects, and the "
           + "keyboard only handles the page.",
        async act({ page, expect, store }) {
          store.first = await page.locator('.tile').first().getAttribute('data-id');
          const id = await page.locator('.tile:not(.marked)').first().getAttribute('data-id');
          await page.locator(`.tile[data-id="${id}"]`).click();
          await expect(page.locator('.tile.marked')).toHaveCount(1);
          await page.waitForTimeout(900);
        }
      },
      {
        caption: 'C clears the page',
        say: "C clears every mark on the page.",
        async act({ page, expect }) {
          await page.keyboard.press('c');
          await expect(page.locator('.tile.marked')).toHaveCount(0);
          await page.waitForTimeout(700);
        }
      },
      {
        caption: 'N and P turn the pages',
        say: "N goes forward, P comes back. The shortcut is written on the button it "
           + "belongs to, so you find it where you'd ask the question.",
        async act({ page, expect, settled, store }) {
          await page.keyboard.press('n');
          await settled();
          const second = await page.locator('.tile').first().getAttribute('data-id');
          expect(second).not.toBe(store.first);
          await page.keyboard.press('p');
          await settled();
          await expect(page.locator('.tile').first()).toHaveAttribute('data-id', store.first);
          await page.waitForTimeout(600);
        }
      },
      {
        caption: 'Enter on its own does nothing',
        say: "Committing is the one thing you cannot undo, so it will not answer to a "
           + "single key. Pressing Enter here does nothing at all — deliberately.",
        async act({ page, expect }) {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1400);
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
        }
      },
      {
        caption: 'Control and Enter commits',
        say: "It takes both hands. Control and Enter commits the page.",
        async act({ page, expect }) {
          await page.keyboard.press('Control+Enter');
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await page.waitForTimeout(1500);
        }
      },
      {
        caption: 'And it says so when it cannot',
        say: "On a page with nothing to commit, the shortcut nudges the button that is "
           + "already telling you why, rather than sitting there looking broken.",
        async act({ page, expect }) {
          await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            const { MarpData } = await import('./src/data.js');
            MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
            await actions.refresh();
          });
          await expect(page.locator('#commit')).toBeDisabled();
          await page.keyboard.press('Control+Enter');
          await expect(page.locator('#commit')).toHaveClass(/nudge/);
          await page.waitForTimeout(1600);
        }
      }
    ]
  },

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
