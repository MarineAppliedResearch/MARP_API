/**
 * Surveys timecode sync consistency across every session. Read-only.
 *
 * Written to be run against production as well as development. Every finding in
 * MarineAppliedResearch/VIDEO_PROCESSING_GUI#213 came from the development
 * database, and production has years more annotation in it -- so the numbers that
 * matter for deciding how to fix sync are the production ones, and they have to be
 * obtainable without a developer improvising queries.
 *
 * Reports three things:
 *
 * - how many sessions hold more than one sync offset, which means either a
 *   deliberate resync, the day rollover, or the millisecond jitter from reading
 *   the two clocks separately
 * - which of those gaps are ~24 hours, i.e. the day rollover rather than a resync
 * - the shape of stored `tc` values, including the `d.hh:mm:ss` form that a
 *   rollover produces and anything malformed
 *
 * Usage:
 *   node scripts/survey-timecode-sync.js
 *   node scripts/survey-timecode-sync.js --out survey.md
 *
 * Point it at a different database by changing the connection settings in `.env`,
 * the same way the API itself is pointed. The report names the host and database
 * it actually read, so a production survey cannot be mistaken for a development
 * one.
 *
 * Runs no INSERT, UPDATE or DELETE. Safe against production.
 *
 * @fileoverview Read-only survey of timecode sync consistency.
 * @author Isaac Travers
 * @module scripts/survey-timecode-sync
 */

'use strict';

const fs = require('fs');

const db = require('../model');

/**
 * Tolerance, in seconds, for calling a gap between two offset clusters a day
 * rollover rather than a resync.
 *
 * Generous on purpose: the two positions are recorded in separate calls, so a
 * rollover gap measured 86,400.074 s rather than exactly 86,400.
 *
 * @constant
 * @type {number}
 */
const ROLLOVER_TOLERANCE_SECONDS = 5;

/** Seconds in a day. @constant @type {number} */
const SECONDS_PER_DAY = 86400;

/** How many rows each "worst offenders" table lists. @constant @type {number} */
const TABLE_LIMIT = 20;

/**
 * Describe the database actually connected to.
 *
 * Printed at the top of every report. Development and production share one
 * config shape and are selected by `.env`, so without this a report gives no
 * indication of which database it describes -- and these two databases hold very
 * different amounts of data.
 *
 * @async
 * @returns {Promise<string>} A one-line description.
 */
async function describeConnection() {
    const { QueryTypes } = db.Sequelize;
    const rows = await db.sequelize.query(
        'SELECT current_database() AS database, inet_server_addr()::text AS host, inet_server_port() AS port',
        { type: QueryTypes.SELECT }
    );

    const { database, host, port } = rows[0];
    const options = db.sequelize.config || {};

    return `database "${database}" on ${host || options.host || 'unknown host'}:${port || options.port || '?'}`;
}

/**
 * Per-session sync offset clusters.
 *
 * The offset in force for an observation is `actualPosition - mediaPosition`.
 * Rounded to the nearest second, which absorbs the sub-100ms jitter from reading
 * the two clocks in separate calls while leaving a genuine resync -- minutes to
 * hours -- distinct.
 *
 * @async
 * @returns {Promise<Array<Object>>} One row per session that has any offset.
 */
async function surveyOffsets() {
    const { QueryTypes } = db.Sequelize;

    return db.sequelize.query(
        `WITH offsets AS (
           SELECT o.session_id,
                  ROUND(EXTRACT(EPOCH FROM o."actualPosition"::interval)
                      - EXTRACT(EPOCH FROM o."mediaPosition"::interval))::bigint AS offset_seconds
             FROM observations o
            WHERE o."mediaPosition"  ~ '^[0-9]+:[0-9]{2}:[0-9]{2}'
              AND o."actualPosition" ~ '^[0-9]+:[0-9]{2}:[0-9]{2}'
         )
         SELECT offsets.session_id,
                s.dive, s.line, s.type,
                COUNT(*)::int                         AS observations,
                COUNT(DISTINCT offset_seconds)::int   AS clusters,
                MIN(offset_seconds)                   AS min_offset_seconds,
                MAX(offset_seconds)                   AS max_offset_seconds
           FROM offsets
           LEFT JOIN sessions s ON s.session_id = offsets.session_id
          GROUP BY offsets.session_id, s.dive, s.line, s.type
          ORDER BY clusters DESC, observations DESC`,
        { type: QueryTypes.SELECT }
    );
}

/**
 * The shape of stored `tc` values.
 *
 * `tc` is a varchar holding a formatted TimeSpan, so a sync that runs past
 * midnight produces `d.hh:mm:ss` instead of `hh:mm:ss` -- and anything that went
 * wrong at write time is visible here as a length nobody intended.
 *
 * @async
 * @returns {Promise<Array<Object>>} One row per distinct shape.
 */
async function surveyTimecodeShapes() {
    const { QueryTypes } = db.Sequelize;

    return db.sequelize.query(
        `SELECT CASE
                  WHEN tc IS NULL                                    THEN 'null'
                  WHEN tc ~ '^[0-9]{2}:[0-9]{2}:[0-9]{2}$'           THEN 'hh:mm:ss'
                  WHEN tc ~ '^[0-9]+\\.[0-9]{2}:[0-9]{2}:[0-9]{2}$'  THEN 'd.hh:mm:ss (day rollover)'
                  ELSE 'unexpected'
                END                                     AS shape,
                COUNT(*)::int                           AS observations,
                COUNT(DISTINCT session_id)::int         AS sessions,
                MIN(tc)                                 AS example_low,
                MAX(tc)                                 AS example_high
           FROM observations
          GROUP BY shape
          ORDER BY observations DESC`,
        { type: QueryTypes.SELECT }
    );
}

/**
 * Render the report as Markdown, so it can be pasted straight into the issue.
 *
 * @param {string} connection - As returned by {@link describeConnection}.
 * @param {Array<Object>} offsets - As returned by {@link surveyOffsets}.
 * @param {Array<Object>} shapes - As returned by {@link surveyTimecodeShapes}.
 * @returns {string} Markdown report.
 */
function renderReport(connection, offsets, shapes) {
    const lines = [];
    const hours = (seconds) => (Math.abs(Number(seconds)) / 3600).toFixed(2);

    const multi = offsets.filter((row) => row.clusters > 1);
    const rollover = multi.filter((row) => Math.abs(
        Math.abs(Number(row.max_offset_seconds) - Number(row.min_offset_seconds)) - SECONDS_PER_DAY
    ) <= ROLLOVER_TOLERANCE_SECONDS);
    const observationsInMulti = multi.reduce((total, row) => total + row.observations, 0);

    lines.push('# Timecode sync survey');
    lines.push('');
    lines.push(`Read from ${connection}.`);
    lines.push('');
    lines.push('Read-only: this survey runs no INSERT, UPDATE or DELETE.');
    lines.push('');
    lines.push('## Sessions by sync consistency');
    lines.push('');
    lines.push('| | Sessions | Observations |');
    lines.push('| --- | --- | --- |');
    lines.push(`| Have a sync offset at all | ${offsets.length} | ${offsets.reduce((t, r) => t + r.observations, 0)} |`);
    lines.push(`| One consistent offset | ${offsets.length - multi.length} | ${offsets.reduce((t, r) => t + r.observations, 0) - observationsInMulti} |`);
    lines.push(`| **More than one offset** | **${multi.length}** | **${observationsInMulti}** |`);
    lines.push(`| of those, gap is ~24 h (day rollover) | ${rollover.length} | ${rollover.reduce((t, r) => t + r.observations, 0)} |`);
    lines.push(`| of those, a real resync to investigate | ${multi.length - rollover.length} | ${observationsInMulti - rollover.reduce((t, r) => t + r.observations, 0)} |`);
    lines.push('');

    lines.push(`## Worst by number of distinct offsets (top ${TABLE_LIMIT})`);
    lines.push('');
    lines.push('| Session | Dive | Line | Type | Observations | Clusters | Spread | Day rollover |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of multi.slice(0, TABLE_LIMIT)) {
        const spread = Math.abs(Number(row.max_offset_seconds) - Number(row.min_offset_seconds));
        const isRollover = Math.abs(spread - SECONDS_PER_DAY) <= ROLLOVER_TOLERANCE_SECONDS;
        lines.push(
            `| ${row.session_id} | ${row.dive || ''} | ${row.line || ''} | ${row.type || ''} `
            + `| ${row.observations} | ${row.clusters} | ${hours(spread)} h | ${isRollover ? 'yes' : ''} |`
        );
    }
    lines.push('');

    lines.push('## Stored `tc` shapes');
    lines.push('');
    lines.push('| Shape | Observations | Sessions | Lowest | Highest |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of shapes) {
        lines.push(
            `| ${row.shape} | ${row.observations} | ${row.sessions} `
            + `| \`${row.example_low}\` | \`${row.example_high}\` |`
        );
    }
    lines.push('');
    lines.push('A `d.hh:mm:ss` value is a sync that ran past midnight. An `unexpected`');
    lines.push('shape is a value nothing intended to write and is worth looking at directly.');
    lines.push('');
    lines.push('## Caveat');
    lines.push('');
    lines.push('An offset is taken as `actualPosition - mediaPosition`, which assumes the pair');
    lines.push('was recorded as a snapshot. It was not -- the two are read in separate calls --');
    lines.push('so clusters within a second or two of each other may be one sync rather than');
    lines.push('several. Rounding to the nearest second absorbs the jitter seen so far.');
    lines.push('');
    lines.push('A session with one consistent offset can still be synced to the **wrong** time.');
    lines.push('This survey bounds the inconsistent problem, not the incorrect one.');

    return lines.join('\n');
}

/**
 * Run the survey and print or save the report.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const outIndex = process.argv.indexOf('--out');
    const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];

    const connection = await describeConnection();
    const [offsets, shapes] = await Promise.all([surveyOffsets(), surveyTimecodeShapes()]);
    const report = renderReport(connection, offsets, shapes);

    if (outPath) {
        fs.writeFileSync(outPath, report);
        console.log(`Survey written to ${outPath} (read from ${connection})`);
    } else {
        console.log(report);
    }

    await db.sequelize.close();
}

main().catch((error) => {
    console.error('Survey failed:', error.message);
    process.exit(1);
});
