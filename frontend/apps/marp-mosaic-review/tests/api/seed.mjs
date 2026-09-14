/**
 * Observations a check may destroy, and thumbnail states the corpus does not have.
 *
 * Three of the checks #157 moved need data no corpus can be relied on to hold:
 *
 * - **A page where every picture failed.** The mosaic has no thumbnail-status filter --
 *   the status is a field on the row, not a dimension -- so a page of broken tiles cannot
 *   be *asked* for. The corpus has fifteen failed rows scattered through two thousand.
 * - **`queued` and `permanent`.** Neither is in the corpus at all: extraction has either
 *   finished or given up, and `permanent` reaches the client from a retry's answer.
 * - **Something to delete.** A delete is a real permanent delete. The API tier's rules say
 *   a test may create rows and must remove them, and may never delete a row it did not
 *   create -- so the check that proves a confirmed deletion deletes destroys its own.
 *
 * **Rewriting the endpoint's answer with `page.route` was the alternative, and it was
 * rejected.** #157 exists to stop a browser tier grading a thing that is not the server;
 * a response body edited on the way past is exactly that, in the one place the issue is
 * about. Seeded rows are served by the real query, joined, paged, ordered and counted by
 * the real SQL, and deleted by the real route.
 *
 * **It writes straight to the testing database**, which is the one thing in this directory
 * that reaches past the application -- `MARP_TESTING_DB_NAME` is handed to the test process
 * for exactly this, and it is named rather than assumed so a seeder cannot silently reach
 * the development corpus. Everything a check *asserts* still goes through the API.
 *
 * The rows land in a session of their own, so `?line=<its line>` is a page holding nothing
 * but them and the check never touches a row somebody else's check reads.
 *
 * Refs #157.
 *
 * @module tests/api/seed
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

/** A prefix nothing else uses, so a leaked row is identifiable and a stale one findable. */
const MARK = 'marp-157-seed';

/**
 * Connect to the testing database, refusing to guess which one it is.
 *
 * @returns {Promise<Object>} A connected `pg` client.
 */
async function connect() {
  const database = process.env.MARP_TESTING_DB_NAME;

  if (!database) {
    throw new Error(
      'MARP_TESTING_DB_NAME is not set, so this seeder does not know which database it is '
      + 'allowed to write to -- and guessing would mean writing to the development corpus. '
      + '`npm run test:app:mosaic-review:api` sets it; see scripts/test-on-testing-database.js.'
    );
  }

  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
  });

  await client.connect();
  return client;
}

/**
 * Put `count` observations of this check's own into a session of their own.
 *
 * @param {Object} options - What to make.
 * @param {number} [options.count] - How many observations.
 * @param {string} [options.thumbnail] - `ready`, `failed`, `queued`, or `none` for no row
 *   at all. `queued` is seeded **already claimed**, because the running extractor takes an
 *   unclaimed one within a second and fails it; see the note beside the insert. `none` is
 *   not a substitute -- the mosaic coalesces a missing row to `queued`, but the page
 *   query's own backstop then inserts a real one and the runner claims that.
 * @param {boolean} [options.permanent] - Mark the thumbnail beyond retrying.
 * @param {string} [options.sessionType] - The session's `type`, which is what decides
 *   which species list the correction panel searches. `'Other'` names none, which is the
 *   case #130 R5 is about and which no session in the corpus happens to be in.
 * @param {string} [options.tc] - The timecode. A value that is not a clock -- `'n/a'` --
 *   is a row the date filter cannot answer for, which is what its "could not see" note
 *   counts and which every `tc` in the corpus happens to be readable enough to avoid.
 * @param {number|null} [options.confidence] - A specific confidence for every seeded row.
 *   Omit it for the ordinary increasing values. `null` exists for #172's rendering check:
 *   a corpus cannot be relied on to contain a null-confidence row on a visible page.
 * @param {boolean} [options.tie] - Give every row the **same** confidence and a different
 *   number of keyframes, so the primary sort ties and the secondary has work to do. A
 *   corpus of inference output ties rarely, and never reliably on page one.
 * @returns {Promise<Object>} `{line, ids, address, remove}`.
 */
export async function seedPage({
  count = 4, thumbnail = 'ready', permanent = false, sessionType = 'Invert',
  tc = '10:00:00', confidence = undefined, tie = false, fullFrame = false
} = {}) {
  const client = await connect();

  /* What has actually been inserted so far, so a seed that dies halfway can take it away
     again. `ids`, `sessionId` and `files` below are views onto this. */
  const planted = { ids: [], sessionId: null, files: [] };

  try {
    /* A line of its own, unique per run, is what makes `?line=...` a page holding only
       these rows. The suffix is the clock rather than a counter, because two runs of the
       same check must not collide if one of them left something behind. */
    const stamp = `${Date.now()}`.slice(-9);
    const line = `${MARK}-${stamp}`;

    const { rows: [project] } = await client.query(
      'SELECT project_id FROM projects ORDER BY project_id LIMIT 1'
    );
    const { rows: [species] } = await client.query(
      'SELECT id FROM species ORDER BY id LIMIT 1'
    );

    if (!project || !species) {
      throw new Error('the testing database has no project or no species, so nothing can '
        + 'be seeded into it. `npm run testing-db reset` rebuilds it from the dump.');
    }

    const { rows: [session] } = await client.query(
      `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $3, $4, NOW(), NOW())
       RETURNING session_id`,
      [project.project_id, `${MARK} dive`, line, sessionType]
    );
    planted.sessionId = session.session_id;

    /* `observation_id` is assigned here rather than left to the column default: the
       repository sets it as max + 1 and the sequence has drifted behind the table as a
       result (#62). Taking max + 1 is what every other writer here does. */
    const { rows: [{ next }] } = await client.query(
      'SELECT coalesce(max(observation_id), 0) + 1 AS next FROM observations'
    );

    const ids = planted.ids;
    for (let n = 0; n < count; n += 1) {
      const id = Number(next) + n;
      await client.query(
        `INSERT INTO observations
           (observation_id, project_id, session_id, "obsID", confidence, comname,
            species_id, tc, version, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), NOW())`,
        [id, project.project_id, session.session_id, 900000 + n,
          confidence === undefined ? (tie ? 0.5 : 0.5 + (n / 1000)) : confidence,
          `${MARK} organism`, species.id, tc]
      );
      ids.push(id);

      /* `keyframe_count` is a lateral count over this table, and it is the secondary sort
         term. A different number per row is what makes the tie-break observable once the
         primary ties -- and it is the only way to make it observable at all, because a
         corpus of inference output happens not to tie on page one. */
      if (tie) {
        for (let k = 0; k <= n; k += 1) {
          await client.query(
            `INSERT INTO keyframes
               (observation_id, subset, comname, type, framenum, x, y, width, height,
                "createdAt", "updatedAt")
             VALUES ($1, 'test', $2, 'box', $3, 0.1, 0.1, 0.2, 0.2, NOW(), NOW())`,
            [id, `${MARK} organism`, 1000 + k]
          );
        }
      }
    }

    /* Files written beside the testing database's own thumbnails, so `remove` can take
       them away again. Empty unless something was copied. */
    const files = planted.files;

    if (thumbnail !== 'none') {
      /**
       * **A `ready` row needs a file of its own.**
       *
       * Each seed gets its own name even though content-addressed files may be shared,
       * because cleanup must never remove bytes belonging to a corpus row. Which picture
       * is copied does not matter: these checks are about what the row's *status* makes
       * the client do, and a `ready` row whose file is missing draws a broken image rather
       * than the thing under test.
       */
      const { rows: [existing] } = await client.query(
        "SELECT filename FROM observation_thumbnails WHERE status = 'ready' AND filename IS NOT NULL LIMIT 1"
      );

      const store = thumbnailStore();
      if (thumbnail === 'ready' && existing && store) mkdirSync(store, { recursive: true });

      for (const [index, id] of ids.entries()) {
        let filename = null;
        let fullFrameFilename = null;

        if (thumbnail === 'ready' && existing && store) {
          filename = `${MARK}-${stamp}-${index}.jpg`;
          copyFileSync(join(store, existing.filename), join(store, filename));
          files.push(join(store, filename));
          if (fullFrame) {
            const fullFrameStore = `${store}-full-frames`;
            mkdirSync(fullFrameStore, { recursive: true });
            fullFrameFilename = `${MARK}-${stamp}-${index}-full.jpg`;
            copyFileSync(join(store, existing.filename), join(fullFrameStore, fullFrameFilename));
            files.push(join(fullFrameStore, fullFrameFilename));
          }
        }

        /**
         * **`ON CONFLICT`, because the server gets there first.**
         *
         * The API is running while this seeds, and its thumbnail extraction loop ticks
         * every second and enqueues a row for any observation that has none -- so between
         * inserting the observations and inserting their thumbnails there is a window in
         * which the row already exists. A plain insert then dies on
         * `observation_thumbnails_observation_id_key`, which reads like a seeding mistake
         * and is the application doing its job.
         */
        /**
         * **A `queued` row is seeded already claimed, and that is what makes it stay
         * queued long enough to be looked at.**
         *
         * The API is running, and its extraction loop ticks every second: `claimBatch`
         * takes any `queued` row whose `claimed_at` is null or older than the claim
         * timeout, finds a seeded observation has no keyframes and no `video_source`, and
         * records a permanent failure. So a row seeded plainly `queued` is `failed` about
         * a second later, and a check that reads it races the runner -- which is exactly
         * how this was found, passing at one viewport and failing at the other in the same
         * run.
         *
         * `claimed_at = NOW()` is not a trick to hide from the runner. It is the state a
         * picture somebody is *currently extracting* is genuinely in, and the lease is two
         * minutes, which is far longer than any check.
         */
        const claimed = thumbnail === 'queued';

        await client.query(
          `INSERT INTO observation_thumbnails
             (observation_id, status, permanent, filename, content_type, generation,
              framenum, subset, attempts, requested_at, claimed_at, completed_at,
              full_frame_status, full_frame_permanent, full_frame_framenum,
              full_frame_subset, full_frame_box, full_frame_filename,
              full_frame_content_type, full_frame_byte_size, full_frame_width,
              full_frame_height, full_frame_completed_at, full_frame_accessed_at,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'image/jpeg', 1, 1, 'test', 1, NOW(),
                   CASE WHEN $5 THEN NOW() ELSE NULL END, NOW(),
                   CASE WHEN $6 THEN 'ready' ELSE NULL END, false,
                   CASE WHEN $6 THEN 1 ELSE NULL END,
                   CASE WHEN $6 THEN 'test' ELSE NULL END,
                   CASE WHEN $6 THEN '{"x":0.5,"y":0.5,"width":0.2,"height":0.2}'::jsonb ELSE NULL END,
                   $7, CASE WHEN $6 THEN 'image/jpeg' ELSE NULL END,
                   CASE WHEN $6 THEN 100 ELSE NULL END,
                   CASE WHEN $6 THEN 640 ELSE NULL END,
                   CASE WHEN $6 THEN 480 ELSE NULL END,
                   CASE WHEN $6 THEN NOW() ELSE NULL END,
                   CASE WHEN $6 THEN NOW() ELSE NULL END, NOW(), NOW())
           ON CONFLICT (observation_id) DO UPDATE
              SET status = EXCLUDED.status,
                  permanent = EXCLUDED.permanent,
                  filename = EXCLUDED.filename,
                  framenum = EXCLUDED.framenum,
                  subset = EXCLUDED.subset,
                  claimed_at = EXCLUDED.claimed_at,
                  full_frame_status = EXCLUDED.full_frame_status,
                  full_frame_framenum = EXCLUDED.full_frame_framenum,
                  full_frame_subset = EXCLUDED.full_frame_subset,
                  full_frame_box = EXCLUDED.full_frame_box,
                  full_frame_filename = EXCLUDED.full_frame_filename,
                  full_frame_content_type = EXCLUDED.full_frame_content_type,
                  full_frame_byte_size = EXCLUDED.full_frame_byte_size,
                  full_frame_width = EXCLUDED.full_frame_width,
                  full_frame_height = EXCLUDED.full_frame_height,
                  full_frame_completed_at = EXCLUDED.full_frame_completed_at,
                  full_frame_accessed_at = EXCLUDED.full_frame_accessed_at,
                  last_error = NULL,
                  updated_at = NOW()`,
          [id, thumbnail, permanent, filename, claimed, fullFrame, fullFrameFilename]
        );
      }
    }

    return {
      line,
      ids,
      /** The address that opens the mosaic on nothing but these rows. */
      address: `./?line=${encodeURIComponent(line)}`,

      /**
       * Take them away again, whatever the check did to them.
       *
       * Tolerant of rows the application already destroyed -- that is the point of the
       * one check that seeds in order to delete.
       *
       * @returns {Promise<void>} Resolves when nothing is left behind.
       */
      async remove() {
        const second = await connect();
        try {
          await second.query('DELETE FROM keyframes WHERE observation_id = ANY($1)', [ids]);
          await second.query('DELETE FROM observation_thumbnails WHERE observation_id = ANY($1)', [ids]);
          await second.query('DELETE FROM observation_reviews WHERE observation_id = ANY($1)', [ids]);
          await second.query('DELETE FROM observation_review_current WHERE observation_id = ANY($1)', [ids]);
          await second.query('DELETE FROM observations WHERE observation_id = ANY($1)', [ids]);
          await second.query('DELETE FROM sessions WHERE session_id = $1', [session.session_id]);
        } finally {
          await second.end();
        }

        /* The pictures too. A row and its JPEG are one corpus, so leaving the file is
           leaving an orphan the next load's manifest check would count. */
        for (const file of files) rmSync(file, { force: true });
      }
    };
  } catch (error) {
    /**
     * **A seed that dies halfway still has to take its rows away.**
     *
     * Everything before the  is inserts, so a throw in the middle leaves
     * observations and a session behind and hands the caller nothing to remove them with.
     * Eighteen observations and three sessions were left in the testing database exactly
     * that way, and the next seed then looked like the failure rather than the sequel to
     * one.
     */
    await sweepUp(planted).catch(() => { /* the original failure is the one worth reading */ });
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Delete whatever a half-finished seed managed to insert.
 *
 * @param {Object} planted - `{ids, sessionId, files}`, filled as the seed proceeds.
 * @returns {Promise<void>} Resolves when nothing is left behind.
 */
async function sweepUp({ ids, sessionId, files }) {
  if (!ids.length && sessionId == null) return;

  const client = await connect();
  try {
    if (ids.length) {
      await client.query('DELETE FROM keyframes WHERE observation_id = ANY($1)', [ids]);
      await client.query('DELETE FROM observation_thumbnails WHERE observation_id = ANY($1)', [ids]);
      await client.query('DELETE FROM observation_reviews WHERE observation_id = ANY($1)', [ids]);
      await client.query('DELETE FROM observation_review_current WHERE observation_id = ANY($1)', [ids]);
      await client.query('DELETE FROM observations WHERE observation_id = ANY($1)', [ids]);
    }
    if (sessionId != null) {
      await client.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
    }
  } finally {
    await client.end();
  }

  for (const file of files) rmSync(file, { force: true });
}

/**
 * Where the testing database keeps its pictures.
 *
 * The launcher hands `THUMBNAIL_STORAGE_DIR` to the **API** rather than to the test
 * process, so it is not in this process's environment -- but the provisioning wrote it
 * down, and that file is the record of which database this is. Null when there is no
 * stamp, which makes a seeded `ready` row a row with no file rather than a crash.
 *
 * @returns {?string} The directory, or null.
 */
function thumbnailStore() {
  try {
    const stamp = JSON.parse(readFileSync(
      new URL('../../../../../.marp/local/testing-database.json', import.meta.url), 'utf8'
    ));
    return stamp.thumbnails || null;
  } catch {
    return null;
  }
}
