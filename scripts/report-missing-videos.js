/**
 * File: scripts/report-missing-videos.js
 * Purpose: List the videos MARP's annotations name that the media server does not have.
 * Context: Isaac, 2026-11-12, reviewing habitat stretches on a production copy: "if videos
 *          are coming up that aren't on the jellyfin server, get me a log of those". The
 *          thumbnail extractor already records it, per observation, when Jellyfin has no
 *          such video or only a match too weak to trust (`NO_VIDEO_ERRORS`); this gathers
 *          those into one line per video, with where its observations come from, so the
 *          videos can be found and put on the server.
 *
 *          It reports what the extractor has tried. A video nothing has asked a picture
 *          of yet is not in it; it appears once a page showing one of its observations has
 *          been looked at, or the extractor's sweep has reached it.
 *
 * Usage:
 *   node scripts/report-missing-videos.js                    CSV to the terminal
 *   node scripts/report-missing-videos.js --out <file.csv>   CSV to a file
 *   node scripts/report-missing-videos.js --type Habitat     only one session type
 *
 * Reads the same DB_* settings as everything else, through model/index.js. Reads only.
 */

'use strict';

const fs = require('fs');

const db = require('../model');
const { NO_VIDEO_ERRORS } = require('../repository/observation-thumbnail.repository');

/**
 * The value after a flag, or null.
 *
 * @param {string} flag
 * @returns {?string}
 */
function option(flag) {
    const at = process.argv.indexOf(flag);
    return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : null;
}

/** One CSV field, quoted when it has to be. */
const field = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function main() {
    const type = option('--type');
    const rows = await db.sequelize.query(
        `SELECT o.video_source,
                CASE WHEN bool_or(t.last_error LIKE :weak) THEN 'weak match' ELSE 'not found' END AS why,
                max(substring(t.last_error from 'scored ([0-9]+)'))::int AS best_score,
                count(*)::int AS observations,
                string_agg(DISTINCT coalesce(p.name, ''), '; ') AS projects,
                string_agg(DISTINCT coalesce(s.dive, ''), '; ') AS dives,
                string_agg(DISTINCT coalesce(s.line, ''), '; ') AS lines,
                string_agg(DISTINCT coalesce(s.type, ''), '; ') AS session_types,
                max(t.updated_at) AS last_tried
           FROM observation_thumbnails t
           JOIN observations o ON o.observation_id = t.observation_id
           LEFT JOIN sessions s ON s.session_id = o.session_id
           -- Older observations carry no project of their own; their session does.
           LEFT JOIN projects p ON p.project_id = coalesce(o.project_id, s.project_id)
          WHERE t.status = 'failed' AND t.permanent
            AND (t.last_error LIKE :missing OR t.last_error LIKE :weak)
            AND (CAST(:type AS text) IS NULL OR s.type = :type)
          GROUP BY o.video_source
          ORDER BY projects, dives, o.video_source`,
        {
            replacements: { missing: `${NO_VIDEO_ERRORS.noMatch}%`, weak: `${NO_VIDEO_ERRORS.weakMatch}%`, type },
            type: db.Sequelize.QueryTypes.SELECT,
            logging: false,
        }
    );

    const columns = ['video_source', 'why', 'best_score', 'observations', 'projects', 'dives', 'lines', 'session_types', 'last_tried'];
    const csv = [columns.join(','), ...rows.map((row) => columns.map((c) => field(
        c === 'last_tried' && row[c] ? new Date(row[c]).toISOString() : row[c]
    )).join(','))].join('\n') + '\n';

    const out = option('--out');
    if (out) {
        fs.writeFileSync(out, csv, 'utf8');
        console.log(`${rows.length} videos the media server does not have, written to ${out}`);
    } else {
        process.stdout.write(csv);
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exit(1);
    });
