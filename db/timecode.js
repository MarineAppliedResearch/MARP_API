/**
 * Reading and writing the timecode columns on observations, and checking whether
 * the derived ones can be trusted.
 *
 * `mediaPosition`, `actualPosition`, `tc`, `etc` and `frame` are all
 * `varchar(255)` holding .NET `TimeSpan` text, so anything working with them has to
 * agree exactly on how that text parses. Getting it slightly wrong is not a
 * rounding error, it is a changed scientific record: parsing ticks with a rounding
 * division instead of a truncating one moves 7,501 frame indices by one and carries
 * `.9995` into the next whole second. Hence one module rather than a copy per
 * caller.
 *
 * Refs MarineAppliedResearch/VIDEO_PROCESSING_GUI#213.
 *
 * @fileoverview Timecode parsing, formatting and derived-column verification.
 * @author Isaac Travers
 * @module db/timecode
 */

'use strict';

/**
 * Frames per second the GUI assumes when deriving `frame`. Hardcoded there too;
 * VIDEO_PROCESSING_GUI#221 is about measuring it instead.
 *
 * @constant
 * @type {number}
 */
const ASSUMED_FPS = 25;

/**
 * Ticks per millisecond, as .NET counts them.
 *
 * @constant
 * @type {number}
 */
const TICKS_PER_MS = 10000;

/**
 * Parses .NET `TimeSpan` text to milliseconds.
 *
 * Accepts `hh:mm:ss`, `hh:mm:ss.fffffff` and the `d.hh:mm:ss.fffffff` form a day
 * rollover produces. The fractional part is **truncated** to whole milliseconds,
 * which is what `TimeSpan.Milliseconds` does -- the GUI derived `frame` from that
 * property, so anything reproducing its arithmetic must truncate the same way.
 *
 * @param {string} text - TimeSpan text, or null.
 * @returns {number|null} Milliseconds, or null when the text is not a TimeSpan.
 */
function parseTimeSpan(text) {
    if (text === null || text === undefined || text === '') {
        return null;
    }

    // The sign sits in front of everything, not inside the optional day group:
    // formatTimeSpan writes "-17:36:09.0800000" for a negative value, and a parser
    // that only accepted "-1.00:00:05" could not read back what it had just written.
    const match = /^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/
        .exec(String(text).trim());

    if (!match) {
        return null;
    }

    const [, sign, days, hh, mm, ss, frac] = match;

    let ms = ((Number(days || 0) * 86400)
        + (Number(hh) * 3600)
        + (Number(mm) * 60)
        + Number(ss)) * 1000;

    if (frac) {
        ms += Math.floor(Number(frac.padEnd(7, '0')) / TICKS_PER_MS);
    }

    return sign === '-' ? -ms : ms;
}

/**
 * Formats milliseconds as the `TimeSpan.ToString()` text the columns hold.
 *
 * Seven fractional digits, and a day part only past 24 hours -- so a value written
 * here is indistinguishable in shape from one the GUI wrote.
 *
 * @param {number} totalMs - Milliseconds. May exceed a day.
 * @returns {string} TimeSpan text.
 */
function formatTimeSpan(totalMs) {
    const negative = totalMs < 0;
    let ms = Math.abs(Math.round(totalMs));

    const days = Math.floor(ms / 86400000);
    ms -= days * 86400000;

    const hours = Math.floor(ms / 3600000);
    ms -= hours * 3600000;

    const minutes = Math.floor(ms / 60000);
    ms -= minutes * 60000;

    const seconds = Math.floor(ms / 1000);
    ms -= seconds * 1000;

    const pad = (value, width) => String(value).padStart(width, '0');

    const body = `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`
        + `.${pad(ms * TICKS_PER_MS, 7)}`;

    return `${negative ? '-' : ''}${days > 0 ? `${days}.` : ''}${body}`;
}

/**
 * Derives `tc` from an actual position, the way the GUI does when recording.
 *
 * Truncated at the second, keeping a day prefix when there is one -- FishWindow
 * splits on the last `.` precisely so a rolled-over day survives.
 *
 * @param {number} actualMs - Actual position in milliseconds.
 * @returns {string} Timecode text.
 */
function deriveTc(actualMs) {
    const text = formatTimeSpan(actualMs);

    return text.slice(0, text.lastIndexOf('.'));
}

/**
 * Derives `frame` from an actual position: the sub-second frame index, 0..24.
 *
 * Not an absolute frame number. `keyframes.framenum` is absolute and derived from
 * media time; two different quantities sharing a name.
 *
 * @param {number} actualMs - Actual position in milliseconds.
 * @returns {string} Frame index as text, since the column is a string.
 */
function deriveFrame(actualMs) {
    const withinSecond = ((actualMs % 1000) + 1000) % 1000;

    return String(Math.floor((withinSecond * ASSUMED_FPS) / 1000));
}

/**
 * The absolute frame number a media position corresponds to.
 *
 * This is what `keyframes.framenum` holds, and what the GUI's `getCurrentFrame()`
 * computes from the displayed frame's media time. Distinct from
 * {@link deriveFrame}, which is the sub-second index stored on an observation.
 *
 * @param {number} mediaMs - Media position in milliseconds.
 * @returns {number} Absolute frame number.
 */
function absoluteFrame(mediaMs) {
    return Math.floor((mediaMs * ASSUMED_FPS) / 1000);
}

/**
 * Shifts a truncated timecode such as `tc` or `etc`.
 *
 * These carry no sub-second part, so a shift under a second usually leaves them
 * unchanged. That is their recorded resolution, not a loss.
 *
 * @param {string} text - Existing value.
 * @param {number} shiftMs - Milliseconds to add.
 * @returns {string|null} Shifted value, or the original when unparseable.
 */
function shiftTruncated(text, shiftMs) {
    if (text === null || text === undefined || text === '') {
        return text;
    }

    const ms = parseTimeSpan(text);

    return ms === null ? text : deriveTc(ms + shiftMs);
}

/**
 * Reports whether one observation's derived columns are ones we can reproduce.
 *
 * A derived column is only safe to rewrite if it currently equals what the
 * derivation produces. Where it does not, something else wrote it -- the DaVinci
 * Resolve era left `frame` values like `'06'`, zero-padded, that no formula here
 * produces -- and rewriting it would replace a recorded value with a guess.
 *
 * @param {Object} row - Observation with tc, frame, mediaPosition, actualPosition.
 * @returns {{readable: boolean, tcDerivable: boolean, frameDerivable: boolean,
 * actualMs: number|null, mediaMs: number|null}} What can be trusted about it.
 */
function classifyRow(row) {
    const actualMs = parseTimeSpan(row.actualPosition);
    const mediaMs = parseTimeSpan(row.mediaPosition);

    if (actualMs === null) {
        return { readable: false, tcDerivable: false, frameDerivable: false, actualMs, mediaMs };
    }

    return {
        readable: mediaMs !== null,
        tcDerivable: deriveTc(actualMs) === row.tc,
        frameDerivable: deriveFrame(actualMs) === (row.frame === null ? null : String(row.frame)),
        actualMs,
        mediaMs,
    };
}

/**
 * Audits the derived timecode columns across a set of observations.
 *
 * Answers the question a resync has to ask before it writes anything: how much of
 * this data was produced by the arithmetic we are about to reapply?
 *
 * @async
 * @param {Object} sequelize - Sequelize instance.
 * @param {Object} [options]
 * @param {number} [options.sessionId] - Restrict to one session.
 * @param {Object} [options.transaction] - Transaction to read inside.
 * @returns {Promise<Object>} Counts, plus a few examples of each problem.
 */
async function auditDerivedColumns(sequelize, options = {}) {
    const { QueryTypes } = sequelize.constructor;
    const { sessionId, transaction } = options;

    const rows = await sequelize.query(
        'SELECT observation_id, session_id, tc, etc, frame, '
        + '"mediaPosition", "actualPosition" FROM observations'
        + (sessionId ? ' WHERE session_id = :sessionId' : ''),
        {
            type: QueryTypes.SELECT,
            logging: false,
            transaction,
            replacements: sessionId ? { sessionId } : undefined,
        },
    );

    const audit = {
        observations: rows.length,
        unreadableActual: 0,
        unreadableMedia: 0,
        tcDerivable: 0,
        tcNotDerivable: 0,
        frameDerivable: 0,
        frameNotDerivable: 0,
        withEtc: 0,
        examples: { unreadable: [], tc: [], frame: [] },
    };

    const keep = (bucket, example) => {
        if (audit.examples[bucket].length < 5) {
            audit.examples[bucket].push(example);
        }
    };

    for (const row of rows) {
        const verdict = classifyRow(row);

        if (row.etc !== null && row.etc !== '') {
            audit.withEtc += 1;
        }

        if (verdict.actualMs === null) {
            audit.unreadableActual += 1;
            keep('unreadable', {
                observation_id: row.observation_id,
                actualPosition: row.actualPosition,
            });
            continue;
        }

        if (verdict.mediaMs === null) {
            audit.unreadableMedia += 1;
            keep('unreadable', {
                observation_id: row.observation_id,
                mediaPosition: row.mediaPosition,
            });
        }

        if (verdict.tcDerivable) {
            audit.tcDerivable += 1;
        } else {
            audit.tcNotDerivable += 1;
            keep('tc', {
                observation_id: row.observation_id,
                actualPosition: row.actualPosition,
                stored: row.tc,
                derived: deriveTc(verdict.actualMs),
            });
        }

        if (verdict.frameDerivable) {
            audit.frameDerivable += 1;
        } else {
            audit.frameNotDerivable += 1;
            keep('frame', {
                observation_id: row.observation_id,
                actualPosition: row.actualPosition,
                stored: row.frame,
                derived: deriveFrame(verdict.actualMs),
            });
        }
    }

    return audit;
}

/**
 * Prints an audit in a fixed shape, so a development run and a production run can
 * be compared line by line.
 *
 * @param {Object} audit - As returned by {@link auditDerivedColumns}.
 * @param {string} [label] - Prefix for each line.
 * @returns {void}
 */
function reportAudit(audit, label = 'timecode') {
    const percent = (n) => (audit.observations === 0 ? '0.00' : ((n / audit.observations) * 100).toFixed(2));

    console.log(`[${label}] observations examined: ${audit.observations}`);
    console.log(`[${label}] unreadable actualPosition: ${audit.unreadableActual}`);
    console.log(`[${label}] unreadable mediaPosition:  ${audit.unreadableMedia}`);
    console.log(`[${label}] tc reproducible from actualPosition:    `
        + `${audit.tcDerivable} (${percent(audit.tcDerivable)}%)`);
    console.log(`[${label}] tc NOT reproducible:                    `
        + `${audit.tcNotDerivable} (${percent(audit.tcNotDerivable)}%)`);
    console.log(`[${label}] frame reproducible from actualPosition: `
        + `${audit.frameDerivable} (${percent(audit.frameDerivable)}%)`);
    console.log(`[${label}] frame NOT reproducible:                 `
        + `${audit.frameNotDerivable} (${percent(audit.frameNotDerivable)}%)`);
    console.log(`[${label}] carrying an etc: ${audit.withEtc}`);
    console.log(`[${label}] a column that is not reproducible is never rewritten by a resync,`);
    console.log(`[${label}] because something other than this arithmetic produced it`);
}

module.exports = {
    ASSUMED_FPS,
    parseTimeSpan,
    formatTimeSpan,
    deriveTc,
    deriveFrame,
    absoluteFrame,
    shiftTruncated,
    classifyRow,
    auditDerivedColumns,
    reportAudit,
};
