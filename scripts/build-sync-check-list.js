/**
 * Writes the check list the annotation GUI's `--synccheck` mode reads.
 *
 * The database cannot tell a correct sync from a consistently wrong one: every
 * session looks self-consistent either way, because `tc` is derived from the same
 * offset that would be wrong. The only external truth is the clock burnt into the
 * video, and reading that needs a person.
 *
 * So this picks frames worth looking at -- spread across a session's clip, since a
 * constant error and a drifting one look different -- and writes them in the shape
 * the GUI steps through. Each line carries the media position to seek to and the
 * real-world time the database holds for that frame. The operator reads the clock
 * in the picture and says whether it matches.
 *
 * Refs MarineAppliedResearch/VIDEO_PROCESSING_GUI#213.
 *
 * Usage:
 *   node scripts/build-sync-check-list.js --session 3693
 *   node scripts/build-sync-check-list.js --session 3693 --checks 6
 *   node scripts/build-sync-check-list.js --recent 10
 *
 * `--location` overrides where the clip is loaded from while keeping the session's
 * own seek points, which is how the same clip can be checked twice -- once as a
 * local file and once through Jellyfin. If the frame at a given media position
 * differs between the two, the load path is at fault rather than the sync:
 *
 *   node scripts/build-sync-check-list.js --session 3926 \
 *     --location jellyfin:item:4404b9c7b2d26aa9be7ea6d218261e6a
 *
 * `--recent` lists candidate sessions and their offsets without writing anything,
 * so a session can be chosen before a file is produced. Read-only in every mode
 * except the file it writes.
 *
 * @fileoverview Builds the GUI's sync-check list from stored observations.
 * @author Isaac Travers
 * @module scripts/build-sync-check-list
 */

'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../model');

/** Where the GUI reads its check list from, relative to the GUI's build output. */
const DEFAULT_OUTPUT = path.join(
    'C:', 'MARE_CODE_DEVELOPMENT', 'MARP', 'VIDEO_PROCESSING_GUI',
    'MAREGUI_PROOFofCONCEPT', 'bin', 'Debug', 'data', 'sync_checks.txt',
);

/** How many frames to look at per session unless asked otherwise. */
const DEFAULT_CHECKS = 4;

/**
 * Parses a .NET TimeSpan string to milliseconds.
 *
 * @param {string} text - e.g. `00:15:01.4400000`, `1.00:04:43.1200000`, `00:15:01`.
 * @returns {number|null} Milliseconds, or null when the text is not a TimeSpan.
 */
function parseTimeSpan(text) {
    if (!text) return null;

    const match = /^(?:(-?)(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/.exec(String(text).trim());
    if (!match) return null;

    const [, sign, days, hh, mm, ss, frac] = match;
    let ms = ((Number(days || 0) * 86400) + (Number(hh) * 3600) + (Number(mm) * 60) + Number(ss)) * 1000;
    if (frac) ms += Math.round(Number(`0.${frac}`) * 1000);

    return sign === '-' ? -ms : ms;
}

/**
 * Parses `--flag value` arguments.
 *
 * @param {Array<string>} argv - Arguments after the script path.
 * @returns {Object<string, string|boolean>} Parsed flags.
 */
function parseArgs(argv) {
    const args = {};

    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith('--')) continue;

        const name = argv[i].slice(2);
        const next = argv[i + 1];

        if (next === undefined || next.startsWith('--')) {
            args[name] = true;
        } else {
            args[name] = next;
            i += 1;
        }
    }

    return args;
}

/**
 * Lists recent sessions with the offset each one holds, so one can be chosen.
 *
 * @async
 * @param {number} limit - How many sessions to list.
 * @returns {Promise<void>}
 */
async function listRecent(limit) {
    const rows = await db.sequelize.query(
        'SELECT o.session_id, count(*) AS observations, '
        + 'max(o.video_source) AS video_source, max(o."videoLocation") AS location, '
        + 'min(o."mediaPosition") AS first_media, max(o."mediaPosition") AS last_media, '
        + 'min(o."actualPosition") AS first_actual '
        + 'FROM observations o WHERE o."mediaPosition" IS NOT NULL '
        + 'GROUP BY o.session_id ORDER BY o.session_id DESC LIMIT :limit',
        { type: db.Sequelize.QueryTypes.SELECT, logging: false, replacements: { limit } },
    );

    console.log('');

    for (const row of rows) {
        const media = parseTimeSpan(row.first_media);
        const actual = parseTimeSpan(row.first_actual);
        const offset = media === null || actual === null ? null : (actual - media) / 1000;

        console.log(`session ${row.session_id}  ${row.observations} observations`);
        console.log(`  clip     ${row.video_source}`);
        console.log(`  at       ${String(row.location || '').slice(0, 100)}`);
        console.log(`  media    ${row.first_media} .. ${row.last_media}`);
        console.log(`  offset   ${offset === null ? '(unreadable)' : `${offset.toFixed(2)} s`}`);
        console.log('');
    }
}

/**
 * Picks indices spread across a list, so a constant error and a drifting one look
 * different. First and last always included.
 *
 * @param {number} length - How many items there are.
 * @param {number} wanted - How many to pick.
 * @returns {Array<number>} Indices, ascending and unique.
 */
function spreadIndices(length, wanted) {
    if (length <= wanted) {
        return Array.from({ length }, (unused, i) => i);
    }

    const picks = [];

    for (let i = 0; i < wanted; i += 1) {
        picks.push(Math.round((i * (length - 1)) / (wanted - 1)));
    }

    return [...new Set(picks)];
}

/**
 * Builds the check list for one session and writes it.
 *
 * @async
 * @param {number} sessionId - Session to check.
 * @param {number} wanted - How many frames to look at.
 * @param {string} outputPath - Where to write the list.
 * @param {string} [locationOverride] - Load the clip from here instead of the
 * location the observations recorded, keeping the same seek points.
 * @returns {Promise<void>}
 */
async function buildForSession(sessionId, wanted, outputPath, locationOverride) {
    const session = await db.sessions.findByPk(sessionId, {
        include: [{ model: db.users, as: 'user' }, { model: db.projects, as: 'project' }],
    });

    if (!session) {
        console.error(`No session ${sessionId}.`);
        process.exitCode = 1;
        return;
    }

    const rows = await db.sequelize.query(
        'SELECT "obsID", tc, comname, video_source, "videoLocation", '
        + '"mediaPosition" AS media, "actualPosition" AS actual '
        + 'FROM observations WHERE session_id = :id AND "mediaPosition" IS NOT NULL '
        + 'ORDER BY "mediaPosition"',
        { type: db.Sequelize.QueryTypes.SELECT, logging: false, replacements: { id: sessionId } },
    );

    if (rows.length === 0) {
        console.error(`Session ${sessionId} has no observations with a media position.`);
        process.exitCode = 1;
        return;
    }

    const plain = session.get({ plain: true });
    const processor = (plain.user && plain.user.name) || '';
    const project = (plain.project && plain.project.name) || '';

    // Same six fields, in the same order, as data/last_session.txt.
    const lines = [
        String(sessionId),
        processor,
        project,
        String(plain.line === null || plain.line === undefined ? '' : plain.line),
        String(plain.dive === null || plain.dive === undefined ? '' : plain.dive),
        String(plain.type || ''),
    ];

    lines.push('');
    lines.push('# mediaPosition|tc|videoLocation|videoSource|note');
    lines.push(`# session ${sessionId}, ${processor}, ${project}`);
    lines.push('# F9 in the video player steps to the next one.');

    const picks = spreadIndices(rows.length, wanted);

    console.log(`\nsession ${sessionId}  ${processor}  ${project}`);
    console.log(`clip  ${rows[0].video_source}`);
    console.log(`at    ${locationOverride || rows[0].videoLocation}`);
    if (locationOverride) {
        console.log(`      (overridden; the observations recorded ${rows[0].videoLocation})`);
    }
    console.log('');

    for (const index of picks) {
        const row = rows[index];
        const media = parseTimeSpan(row.media);
        const actual = parseTimeSpan(row.actual);
        const offset = media === null || actual === null ? null : (actual - media) / 1000;

        lines.push([
            row.media,
            row.actual,
            locationOverride || row.videoLocation || '',
            // Blank under an override. The GUI treats a row whose video_source
            // names the loaded clip as already loaded and seeks instead of
            // reloading, which would quietly defeat the whole point of pointing
            // the same clip at a different source.
            locationOverride ? '' : (row.video_source || ''),
            `obsID ${row.obsID} ${row.comname || ''}`.trim(),
        ].join('|'));

        console.log(
            `  seek ${String(row.media).padEnd(20)} database says ${String(row.tc).padEnd(12)}`
            + `offset ${offset === null ? '?' : `${offset.toFixed(2)} s`}`,
        );
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${lines.join('\r\n')}\r\n`, 'utf8');

    console.log(`\n${picks.length} checks written to ${outputPath}`);
    console.log('Run the GUI with --synccheck, then press F9 for each one.');
}

/**
 * Entry point.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const args = parseArgs(process.argv.slice(2));

    const config = db.sequelize.config;
    console.log(`Database: ${config.database} on ${config.host}:${config.port}`);

    if (args.recent) {
        await listRecent(args.recent === true ? 10 : Number(args.recent));
        return;
    }

    if (!args.session || args.session === true) {
        console.error('Give --session <id>, or --recent [n] to see candidates.');
        process.exitCode = 1;
        return;
    }

    const wanted = args.checks && args.checks !== true ? Number(args.checks) : DEFAULT_CHECKS;
    const outputPath = args.out && args.out !== true ? args.out : DEFAULT_OUTPUT;

    const locationOverride = args.location && args.location !== true ? args.location : null;

    await buildForSession(Number(args.session), wanted, outputPath, locationOverride);
}

main()
    .then(() => db.sequelize.close())
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
        return db.sequelize.close();
    });
