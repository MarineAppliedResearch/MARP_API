/**
 * A walkthrough of Dataset Review (#271): a built dataset reviewed picture by picture in the
 * Mosaic. For Isaac to watch; not a test. Every claim a scene makes is proved by
 * `tests/unit/dataset-review.test.mjs` and the server's `tests/dataset-review-build.test.js`;
 * a scene asserts what it says only so a broken page fails instead of making a film.
 *
 * Recorded against the server and database the work is being done on, on a dataset already
 * built there, named by `MARP_FILM_DATASET`. **Self-cleaning**: every picture decision the
 * film commits is removed in the teardown, which runs even if the film fails.
 */
import { expect } from '@playwright/test';
import { connect } from '../api/seed.mjs';
import { drawPointer, ring, glide, clickOn, pause } from './video-scenarios.mjs';

const DATASET = Number(process.env.MARP_FILM_DATASET);

const tiles = (page) => page.locator('.tile');
const panel = (page) => page.locator('#picturesPanel');

export const datasetScenarios = {
  'dataset-review': {
    title: 'Dataset Review: checking a training dataset picture by picture',
    async setup({ page, store, settled }) {
      if (!Number.isInteger(DATASET)) throw new Error('MARP_FILM_DATASET names the dataset to film.');
      // The newest decision before the film, so the teardown removes only the film's own.
      const db = await connect();
      try {
        const { rows } = await db.query('SELECT coalesce(max(id), 0) AS id FROM picture_reviews');
        store.before = Number(rows[0].id);
      } finally {
        await db.end();
      }
      await page.addInitScript(drawPointer);
      await page.goto(`./?mode=datasetReview&dataset=${DATASET}`);
      await settled();
      await expect(page.locator('.flip').first()).toBeVisible();
    },
    async teardown({ store }) {
      if (store.before == null) return;
      const db = await connect();
      try {
        await db.query('DELETE FROM picture_reviews WHERE id > $1 AND dataset_id = $2', [store.before, DATASET]);
      } finally {
        await db.end();
      }
    },
    scenes: [
      {
        caption: 'Dataset Review',
        say: "This is Dataset Review, a new mode in the Marp Mosaic. It's for checking a dataset "
          + "we've built, picture by picture, before a model is trained on it.",
        async act({ page }) {
          await expect(page.locator('.seg button[data-mode="datasetReview"]')).toHaveClass(/on/);
          await ring(page, page.locator('.seg button[data-mode="datasetReview"]'), 4000);
        }
      },
      {
        caption: 'One dataset, chosen in the filters',
        say: "The dataset filter on the left picks one built dataset. This one is Bat stars: "
          + "every promoted Bat star track, ten pictures taken from each.",
        async act({ page }) {
          const filter = page.locator('button[data-dim="dataset"]');
          await filter.scrollIntoViewIfNeeded();
          await ring(page, filter, 4500);
          await expect(filter).toContainText('Bat star');
        }
      },
      {
        caption: 'A tile is one track',
        say: "Each tile is one track. It flips through the pictures the dataset took from that "
          + "track, zoomed in on the box, so you can see straight away whether the box stays on "
          + "the animal. The little bars along the bottom are one per picture.",
        async act({ page }) {
          const first = tiles(page).first();
          await expect(first.locator('.flip .dframe')).not.toHaveCount(1);
          await ring(page, first, 6500);
        }
      },
      {
        caption: 'Why the pictures between keyframes',
        say: "Most of these pictures fall between keyframes, where the box is drawn in a straight "
          + "line from one keyframe to the next. The R O V doesn't move in a straight line, so "
          + "that box can drift off the animal. This is where you catch it."
      },
      {
        caption: 'Hold still to look',
        say: "Holding the pointer over a tile stops it flipping, so you can look at one picture.",
        async act({ page }) {
          const second = tiles(page).nth(1);
          const box = await second.boundingBox();
          await glide(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
          await pause(page, 2500);
        }
      },
      {
        caption: 'Opening a track',
        say: "Clicking a tile … opens that track's pictures side by side.",
        async act({ page, store }) {
          const second = tiles(page).nth(1);
          store.id = Number(await second.getAttribute('data-id'));
          await clickOn(page, second);
          await expect(panel(page)).toBeVisible();
          await expect(panel(page).locator('figure.pic')).not.toHaveCount(0);
        }
      },
      {
        caption: 'The whole picture, every box',
        say: "Each one is the whole picture, read straight out of the dataset's own file, so "
          + "nothing extra is stored. This track's box is solid. Any other box the dataset put on "
          + "the same picture is dashed. So if there's a Bat star with no box at all, it stands "
          + "out, and that picture has to be flagged: a model learns an unboxed animal as "
          + "background.",
        async act({ page }) {
          const picture = panel(page).locator('figure.pic img').first();
          await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
          await ring(page, panel(page).locator('figure.pic').first(), 7000);
        }
      },
      {
        caption: 'The reasons',
        say: "Along the top are the reasons. The first two are the ones this is for: box off the "
          + "animal, and an animal has no box. The chosen one is what a click flags with.",
        async act({ page }) {
          const reasons = panel(page).locator('.reasons');
          await ring(page, reasons, 5500);
          await expect(reasons.locator('button.on')).toHaveText('Box off the animal');
        }
      },
      {
        caption: 'Flagging one picture',
        say: "Flagging this picture … one click. It turns amber, with its reason underneath.",
        async act({ page, store }) {
          const figure = panel(page).locator('figure.pic').nth(1);
          store.frame = Number(await figure.getAttribute('data-frame'));
          await clickOn(page, figure.locator('img'));
          await expect(figure).toHaveClass(/p-flagged/);
          await expect(figure.locator('figcaption b')).toContainText('Box off the animal');
        }
      },
      {
        caption: 'Only that picture',
        say: "Only that one picture is flagged. The rest of the track is still good, and it will "
          + "still be used. Clicking it again would take the flag off."
      },
      {
        caption: 'Fix, on the video',
        say: "Each picture has a Fix button. It opens the video page at exactly that frame, where "
          + "the box can be dragged back onto the animal, as in the annotation tool.",
        async act({ page }) {
          await ring(page, panel(page).locator('figure.pic').nth(1).locator('[data-fix]'), 5000);
        }
      },
      {
        caption: 'Back to the page',
        say: "Closing the panel … the tile now says flagged, and the bar for that picture is amber.",
        async act({ page, store }) {
          await clickOn(page, panel(page).locator('[data-act="close-pictures"]'));
          await expect(panel(page)).toBeHidden();
          const tile = page.locator(`.tile[data-id="${store.id}"]`);
          await expect(tile.locator('.badge')).toContainText('FLAGGED');
          await ring(page, tile, 4000);
        }
      },
      {
        caption: 'Promote the page',
        say: "Promoting the page … every picture on it that nobody flagged is promoted, and the "
          + "flagged one is recorded with its reason, on the observation itself.",
        async act({ page, store }) {
          await clickOn(page, page.locator('#commit'));
          const tile = page.locator(`.tile[data-id="${store.id}"]`);
          await expect(tile.locator('.badge')).toContainText('FLAGGED');
          await expect(tiles(page).locator('.badge:has-text("CHECKED")').first()).toBeVisible();
          await pause(page, 1500);
        }
      },
      {
        caption: 'What the next dataset takes',
        say: "From now on, every dataset built leaves that one picture out, and still uses the "
          + "rest of the track. It stays out until somebody fixes it and promotes it again."
      },
      {
        caption: 'And what it never takes',
        say: "A build also leaves out any picture showing a Bat star that wasn't taken into the "
          + "dataset, one nobody has reviewed yet, for example. It would be in the picture with no "
          + "box. On this dataset that left out fifty two of two hundred and sixty pictures."
      },
      {
        caption: 'Finding them again',
        say: "To come back to the flagged ones later, the Pictures filter has: has a flagged picture.",
        async act({ page }) {
          const filter = page.locator('text=Has a flagged picture').first();
          await filter.scrollIntoViewIfNeeded();
          await ring(page, filter, 4500);
        }
      }
    ]
  }
};
