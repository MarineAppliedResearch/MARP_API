/**
 * A habitat session of a check's own, in a real video, for the video page's habitat checks
 * (#360): stretches recorded the way the annotation GUI records them, so the page draws their
 * boxes and its timeline shows them. Everything in the session is removed afterwards, a piece a
 * cut made included.
 */
import { connect, MARK } from './seed.mjs';

/* .NET TimeSpan text for milliseconds, as the annotation GUI writes positions. */
function timeSpan(ms) {
  const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0');
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}.${pad((ms % 1000) * 10000, 7)}`;
}

/* The clock the stretches are recorded against: 10:00:00 at the video's first frame. */
const CLOCK_MS = 10 * 3600000;

/**
 * @param {Object} options
 * @param {string} options.videoSource - A video the test's Jellyfin account can play.
 * @param {Array<{start: number, end: number, substrate: string}>} options.stretches - Seconds
 *   into the video, and the substrate's name, found in the species table so each sits in its
 *   own lane.
 * @returns {Promise<Object>} `{ sessionId, ids, remove }`.
 */
export async function seedHabitat({ videoSource, stretches }) {
  const planted = { sessionId: null };
  const remove = async () => {
    if (planted.sessionId == null) return;
    const cleaner = await connect();
    try {
      // Keyframes, reviews and pictures' rows go with their observations, by cascade.
      await cleaner.query('DELETE FROM observations WHERE session_id = $1', [planted.sessionId]);
      await cleaner.query('DELETE FROM sessions WHERE session_id = $1', [planted.sessionId]);
    } finally {
      await cleaner.end();
    }
  };

  const client = await connect();
  try {
    const { rows: [project] } = await client.query('SELECT project_id FROM projects ORDER BY project_id LIMIT 1');
    const line = `${MARK}-habitat-${`${Date.now()}`.slice(-9)}`;
    const { rows: [session] } = await client.query(
      `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $3, 'Habitat', NOW(), NOW()) RETURNING session_id`,
      [project.project_id, `${MARK} dive`, line]
    );
    planted.sessionId = session.session_id;

    const { rows: [{ next }] } = await client.query('SELECT coalesce(max(observation_id), 0) + 1 AS next FROM observations');
    const ids = [];
    for (const [n, stretch] of stretches.entries()) {
      const { rows: [species] } = await client.query(
        'SELECT id, comname FROM species WHERE lower(comname) = lower($1) ORDER BY id LIMIT 1', [stretch.substrate]
      );
      if (!species) throw new Error(`the testing database has no species called ${stretch.substrate}`);
      const id = Number(next) + n;
      const clock = (seconds) => timeSpan(CLOCK_MS + Math.round(seconds * 1000)).slice(0, 8);
      await client.query(
        `INSERT INTO observations (observation_id, project_id, session_id, "obsID", species_id, comname, count,
                                   tc, etc, "actualPosition", "mediaPosition", video_source, version,
                                   "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, 1, NOW(), NOW())`,
        [id, project.project_id, session.session_id, 900000 + n, species.id, species.comname,
          clock(stretch.start), clock(stretch.end), timeSpan(CLOCK_MS + stretch.start * 1000),
          timeSpan(stretch.start * 1000), videoSource]
      );
      ids.push(id);
      /* Its picture marked as done with, so the server does not start cutting one from this
         same video in Jellyfin while the page is opening it: with that running, the page was
         seen to sit at "Opening the video..." for minutes. These checks are not about pictures. */
      await client.query(
        `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, last_error,
                                             requested_at, created_at, updated_at)
         VALUES ($1, 'failed', true, 1, 1, 'seeded by a habitat check', NOW(), NOW(), NOW())
         ON CONFLICT (observation_id) DO UPDATE SET status = 'failed', permanent = true`,
        [id]
      );
    }
    /* Ids were taken as the highest plus one, as the other seeders take them; the counter the
       application takes them from is moved past them, or the next one it hands out -- a piece a
       cut makes -- is one of these and is refused as a duplicate (#62). */
    await client.query("SELECT setval('observations_observation_id_seq', (SELECT max(observation_id) FROM observations))");
    return { sessionId: session.session_id, ids, remove };
  } catch (error) {
    await remove();
    throw error;
  } finally {
    await client.end();
  }
}
