/**
 * A ready row still serves its picture, and two rows do not serve the same one.
 *
 * **This is the tier that can see it and the only one that can.** Thumbnails are
 * two things -- a filename in `observation_thumbnails` and a JPEG on disk -- and a
 * unit test that proves the naming rule stays green while every file on disk is
 * called something else. Nothing above this tier had ever fetched the bytes: the
 * mosaic row carries `thumbnail_status`, so the render checks prove a tile drew
 * and prove nothing at all about what came back down the wire.
 *
 * The check exists because the stored name changed (#62). It used to be
 * `${observation_id}.jpg` and it is a hash of the tile's own bytes now, and every
 * file in the corpus was renamed to match. What had to survive that is exactly
 * these two sentences:
 *
 * - **a ready row answers 200 with a JPEG.** `routes/thumbnail.routes.js` looks up
 *   the row, joins its `filename` to the storage directory and checks only
 *   `fs.existsSync`, so a row left holding a name nothing wrote is a 404 and a
 *   rename that updated the files and not the rows would be caught here and
 *   nowhere else.
 * - **two observations do not come back as the same picture.** That is the defect
 *   the rename was for. `observation_id` is `max(observation_id) + 1` per database
 *   (#62), so two databases both own `582.jpg` -- and because serving compares no
 *   `byte_size`, no `width` and no `height` against the row, a collision is not a
 *   broken tile. It is a 200, a plausible ETag, and a confident picture of the
 *   wrong animal, which a reviewer reads as a bad detection and may delete.
 *
 * **Nothing here writes.** It is a read of two rows and two pictures, so there is
 * no `finally` and nothing to restore.
 *
 * Refs #62.
 */

import crypto from 'node:crypto';

import { test, expect } from '@playwright/test';

import { pageOf, whateverItsStatus } from './support.mjs';

/** The first two bytes of every JPEG. A 404 body or an HTML error page is not this. */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);

/**
 * Two rows whose picture the corpus says is ready.
 *
 * Swept rather than pinned. `LONE_SPECIES = 622` was a pinned id once and seven
 * dives landed the same night; an observation id here would go the same way, and a
 * test that pins a row in one person's corpus is a test nobody else can run.
 *
 * @param {import('@playwright/test').APIRequestContext} request Signed-in context.
 * @returns {Promise<Array<Object>>} Two mosaic rows with a ready thumbnail.
 */
async function twoReadyRows(request) {
  /* `whateverItsStatus` rather than a bare `{}`: DEFAULT_FILTERS carries
     Scientific's opening status filter, so a query with no filters sees a
     different set of rows than the mosaic ever shows. */
  const served = await pageOf(request, whateverItsStatus(), { page: 1, pageSize: 50 });

  const ready = served.rows.filter((row) => row.thumbnail_status === 'ready');

  expect(ready.length, 'the first page holds fewer than two rows with a ready picture, so '
    + 'there is nothing to compare. `npm run testing-db status` says what is in the '
    + 'corpus; a database with no extracted thumbnails cannot answer this.')
    .toBeGreaterThanOrEqual(2);

  return ready.slice(0, 2);
}

/**
 * Fetch one observation's thumbnail and insist it is a picture.
 *
 * @param {import('@playwright/test').APIRequestContext} request Signed-in context.
 * @param {number} observationId Whose picture.
 * @returns {Promise<Buffer>} The bytes.
 */
async function fetchTile(request, observationId) {
  const res = await request.get(`/api/v2/observations/${observationId}/thumbnail`);

  expect(res.status(), `observation ${observationId} says its thumbnail is ready, and the `
    + 'endpoint did not serve it. A 404 here means the row names a file that is not on '
    + `disk: ${await res.text().catch(() => 'no body')}`).toBe(200);

  expect(res.headers()['content-type']).toContain('image/jpeg');

  const body = Buffer.from(await res.body());

  /* Asserted rather than assumed. `sendFile` on a file of the wrong kind is still a
     200, and a test that only counts bytes would pass on anything at all. */
  expect(body.subarray(0, 2).equals(JPEG_MAGIC),
    `what came back for observation ${observationId} does not start like a JPEG.`).toBe(true);
  expect(body.length).toBeGreaterThan(1024);

  return body;
}

test.describe('a renamed corpus still serves its pictures', () => {

  test('#62: a ready row answers 200 with the JPEG the row names', async ({ request }) => {
    const [row] = await twoReadyRows(request);

    await fetchTile(request, row.observation_id);
  });

  test('#62: two observations do not serve the same picture', async ({ request }) => {
    const [first, second] = await twoReadyRows(request);

    const one = await fetchTile(request, first.observation_id);
    const other = await fetchTile(request, second.observation_id);

    /* Compared by digest rather than by length: two different crops of the same
       frame can land on the same byte count, and a length check would call that
       agreement. The digest is also what the filename now is, so this is the same
       comparison the storage directory makes. */
    const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

    expect(digest(one), `observations ${first.observation_id} and ${second.observation_id} `
      + 'served byte-identical pictures. Either the two rows name one file -- the '
      + 'collision content addressing exists to make impossible -- or the corpus really '
      + 'does hold two identical tiles, which is worth knowing either way.')
      .not.toBe(digest(other));
  });

});
