/**
 * Habitat segments: a line's habitat stretches cut into pieces of one combination of
 * substrates (#342, decided 2026-11-10).
 *
 * A habitat observation is one substrate's stretch, and stretches overlap, so "Mud alone" or
 * "Mud and Boulder at once" are questions about moments rather than stretches. A segment
 * answers them: each session's timeline is cut wherever any substrate starts or stops, so every
 * piece has a fixed combination, labelled with it ("Mud + Boulder").
 *
 * Decided on #342, and kept here:
 * - **Worked out when the query runs**, from the stretches, so segments always match the
 *   current data and need no table of their own.
 * - **Segments shorter than 2 seconds are left out**, the protocol's minimum stretch: they are
 *   mostly two stretches overlapping by a moment.
 * - **The picture is the segment's middle frame**, so each segment says where its middle is:
 *   which video, and how far into it.
 * - **Filters**: chosen substrates, then "includes all of these", "exactly these" or "any of
 *   these".
 *
 * Pure: rows in, segments out.
 *
 * @fileoverview Cutting habitat stretches into segments, and filtering them.
 * @module service/habitat-segments
 */

'use strict';

const { parseTimeSpan } = require('../db/timecode');

/** The substrates, in the order a segment's label lists them: the models' own order, as #342 writes "Mud + Boulder". */
const SUBSTRATE_ORDER = ['Rock', 'Mud', 'Sand', 'Gravel', 'Cobble', 'Boulder'];

/** Segments shorter than this are left out (#342: the protocol's minimum stretch). */
const MIN_SEGMENT_MS = 2000;

/** How a filter's substrates are matched against a segment's. */
const MATCH_MODES = ['all', 'exactly', 'any'];

/** A substrate's place in a label: the known ones in order, anything else after, by name. */
const rank = (name) => {
    const i = SUBSTRATE_ORDER.indexOf(name);
    return i === -1 ? SUBSTRATE_ORDER.length : i;
};
const byLabelOrder = (a, b) => rank(a) - rank(b) || a.localeCompare(b);

/**
 * One stretch on its session's clock, from an observation row, or null when its times do not
 * read.
 *
 * The start is the stretch's clock position (`actualPosition`); its length is `etc - tc`, as the
 * habitat protocol records it; its file and offset say where in which video it is.
 *
 * @param {Object} row - `{observation_id, comname, actualPosition, mediaPosition, tc, etc, video_source}`.
 * @returns {?Object} `{id, substrate, start, end, video, offset}` in milliseconds.
 */
function stretchOf(row) {
    const actual = parseTimeSpan(row.actualPosition);
    const media = parseTimeSpan(row.mediaPosition);
    const tc = parseTimeSpan(row.tc);
    const etc = parseTimeSpan(row.etc);
    if ([actual, media, tc, etc].some((v) => v === null) || etc <= tc) return null;
    return {
        id: row.observation_id,
        substrate: row.comname,
        start: actual,
        end: actual + (etc - tc),
        video: row.video_source || null,
        offset: actual - media,
    };
}

/**
 * The segments of one session's stretches.
 *
 * @param {Array<Object>} rows - The session's habitat observations.
 * @param {Object} [options] - `{ minMs }`.
 * @returns {Array<Object>} `{substrates, label, start_ms, end_ms, length_ms, stretch_ids,
 *   middle: {video_source, media_ms}}`, in time order. Times are on the session's clock.
 */
function segmentsOf(rows, { minMs = MIN_SEGMENT_MS } = {}) {
    const stretches = rows.map(stretchOf).filter(Boolean);
    const cuts = [...new Set(stretches.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);

    // Each piece between two cuts, with the stretches covering all of it.
    const pieces = [];
    for (let i = 0; i + 1 < cuts.length; i += 1) {
        const [a, b] = [cuts[i], cuts[i + 1]];
        const covering = stretches.filter((s) => s.start <= a && s.end >= b);
        if (!covering.length) continue;
        const substrates = [...new Set(covering.map((s) => s.substrate))].sort(byLabelOrder);
        const last = pieces[pieces.length - 1];
        // A cut where nothing changed (one stretch ending as another of the same substrate
        // begins) is not a boundary: the pieces join.
        if (last && last.end === a && last.substrates.join('|') === substrates.join('|')) {
            last.end = b;
            covering.forEach((s) => last.ids.add(s.id));
            last.covering.push(...covering);
        } else {
            pieces.push({ start: a, end: b, substrates, ids: new Set(covering.map((s) => s.id)), covering: [...covering] });
        }
    }

    return pieces
        .filter((p) => p.end - p.start >= minMs)
        .map((p) => {
            const middle = Math.round((p.start + p.end) / 2);
            // Where the middle is in a video: a covering stretch that contains it says which
            // file and how far in.
            const at = p.covering.find((s) => s.start <= middle && middle <= s.end && s.video) || p.covering[0];
            return {
                substrates: p.substrates,
                label: p.substrates.join(' + '),
                start_ms: p.start,
                end_ms: p.end,
                length_ms: p.end - p.start,
                stretch_ids: [...p.ids].sort((x, y) => x - y),
                middle: { video_source: at.video, media_ms: middle - at.offset },
            };
        });
}

/**
 * Whether a segment answers a substrate filter.
 *
 * @param {Object} segment - From `segmentsOf`.
 * @param {Object} filter - `{ substrates: [...], mode: 'all' | 'exactly' | 'any' }`; none chosen
 *   matches everything.
 * @returns {boolean}
 */
function matches(segment, { substrates = [], mode = 'all' } = {}) {
    if (!substrates.length) return true;
    const has = new Set(segment.substrates);
    if (mode === 'exactly') return has.size === substrates.length && substrates.every((s) => has.has(s));
    if (mode === 'any') return substrates.some((s) => has.has(s));
    return substrates.every((s) => has.has(s));
}

module.exports = { SUBSTRATE_ORDER, MIN_SEGMENT_MS, MATCH_MODES, stretchOf, segmentsOf, matches };
