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
 *   at all -- which the mosaic query coalesces to `queued`, the state a row that has never
 *   been asked for is in.
 * @param {boolean} [options.permanent] - Mark the thumbnail beyond retrying.
 * @param {string} [options.sessionType] - The session's `type`, which is what decides
 *   which species list the correction panel searches. `'Other'` names none, which is the
 *   case #130 R5 is about and which no session in the corpus happens to be in.
 * @returns {Promise<Object>} `{line, ids, address, remove}`.
 */
export async function seedPage({
  count = 4, thumbnail = 'ready', permanent = false, sessionType = 'Invert'
} = {}) {
  const client = await connect();

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

    /* `observation_id` is assigned here rather than left to the column default: the
       repository sets it as max + 1 and the sequence has drifted behind the table as a
       result (#62). Taking max + 1 is what every other writer here does. */
    const { rows: [{ next }] } = await client.query(
      'SELECT coalesce(max(observation_id), 0) + 1 AS next FROM observations'
    );

    const ids = [];
    for (let n = 0; n < count; n += 1) {
      const id = Number(next) + n;
      await client.query(
        `INSERT INTO observations
           (observation_id, project_id, session_id, "obsID", confidence, comname,
            species_id, tc, version, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), NOW())`,
        [id, project.project_id, session.session_id, 900000 + n, 0.5 + (n / 1000),
          `${MARK} organism`, species.id, '10:00:00']
      );
      ids.push(id);
    }

    /* Files written beside the testing database's own thumbnails, so `remove` can take
       them away again. Empty unless something was copied. */
    const files = [];

    if (thumbnail !== 'none') {
      /**
       * **A `ready` row needs a file of its own, and the constraint is why.**
       *
       * `observation_thumbnails.filename` is UNIQUE, so several seeded rows cannot point
       * at one existing picture and none of them may borrow a corpus row's name. Each
       * gets its own name and a copy of some corpus JPEG's bytes -- which picture it is
       * does not matter, because what these checks are about is what the row's *status*
       * makes the client do, and a `ready` row whose file is missing draws a broken image
       * rather than the thing under test.
       */
      const { rows: [existing] } = await client.query(
        "SELECT filename FROM observation_thumbnails WHERE status = 'ready' AND filename IS NOT NULL LIMIT 1"
      );

      const store = thumbnailStore();
      if (thumbnail === 'ready' && existing && store) mkdirSync(store, { recursive: true });

      for (const [index, id] of ids.entries()) {
        let filename = null;

        if (thumbnail === 'ready' && existing && store) {
          filename = `${MARK}-${stamp}-${index}.jpg`;
          copyFileSync(join(store, existing.filename), join(store, filename));
          files.push(join(store, filename));
        }

        await client.query(
          `INSERT INTO observation_thumbnails
             (observation_id, status, permanent, filename, content_type, generation,
              attempts, requested_at, completed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'image/jpeg', 1, 1, NOW(), NOW(), NOW(), NOW())`,
          [id, thumbnail, permanent, filename]
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
  } finally {
    await client.end();
  }
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
