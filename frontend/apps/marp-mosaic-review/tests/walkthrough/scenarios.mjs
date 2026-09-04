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
        say: "Click anywhere outside to close the panel. The tile now shows what it used to "
           + "be, so you can see at a glance that you changed it.",
        async act({ page, expect }) {
          await page.locator('#field').click({ position: { x: 6, y: 6 } });
          await expect(page.locator('.pick')).toHaveCount(0);
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
        say: "Marking here means exclude, not flag. Let's exclude one and say why.",
        async act({ page, expect }) {
          await tilesIn(page).first().click();
          await page.locator('[data-badge]').first().click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.locator('.pick .chip', { hasText: 'Occluded' }).click();
          await page.locator('#field').click({ position: { x: 6, y: 6 } });
        }
      },
      {
        caption: 'Promote Page',
        say: "And committing promotes everything else into the training set. Excluding is a "
           + "real decision that gets recorded with its reason — it isn't just the absence "
           + "of approval.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'PROMOTED' }).first()).toBeVisible();
        }
      }
    ]
  }
};

export const scenarioIds = Object.keys(scenarios);
