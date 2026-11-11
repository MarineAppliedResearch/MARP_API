/**
 * The Mosaic's habitat segments, as a query (#342, decided 2026-11-10).
 *
 * Reads the habitat stretches the Mosaic's filters select -- project, dive, line, session,
 * model, run, as tiles are filtered -- cuts each session's into segments (`service/
 * habitat-segments.js`), and keeps the segments the substrate filter and the review filter ask
 * for. Worked out when the query runs, from the stretches, so it always matches the data.
 *
 * **A segment's review is its stretches'.** Review decisions stay per observation (#287 question
 * 11): approving a segment approves every stretch under it, and flagging one of its substrates
 * flags that substrate's stretch, both through the Mosaic's existing review routes. So each
 * segment carries its stretches with their version and current decision, and its own state is
 * worked out from theirs: flagged when any is, reviewed when all are, otherwise unreviewed.
 *
 * @fileoverview Habitat segments for the Mosaic.
 * @module repository/habitat-segments
 */

'use strict';

const db = require('../model');
const { binder, predicates, MosaicRequestError } = require('./mosaic.repository');
const { segmentsOf, matches, MATCH_MODES } = require('../service/habitat-segments');

/** The session type whose observations are habitat stretches. */
const HABITAT_TYPE = 'Habitat';

/** The most segments one page may hold. */
const MAX_PAGE_SIZE = 500;

/** A segment's review state, from its stretches' current scientific decisions. */
function reviewOf(stretches) {
    if (stretches.some((s) => s.decision === 'flagged')) return 'flagged';
    if (stretches.length && stretches.every((s) => s.decision === 'reviewed')) return 'reviewed';
    return 'unreviewed';
}

/**
 * One page of habitat segments.
 *
 * @async
 * @param {Object} request - `{ filters, substrates, mode, review, page, pageSize }`: the
 *   Mosaic's filters (species and status dimensions are not used: a segment's substrates and
 *   review state are its own); the substrates to match and how (`all`, `exactly`, `any`); the
 *   review states to keep, none meaning all; the page, from 1.
 * @returns {Promise<Object>} `{ total, page, pageSize, segments }`, in project, dive, line and
 *   time order.
 * @throws {MosaicRequestError} When the request is malformed.
 */
async function habitatSegments(request = {}) {
    const filters = request.filters && typeof request.filters === 'object' ? request.filters : {};
    const substrates = Array.isArray(request.substrates) ? request.substrates.map(String) : [];
    const mode = request.mode || 'all';
    if (!MATCH_MODES.includes(mode)) throw new MosaicRequestError(`mode must be one of ${MATCH_MODES.join(', ')}`);
    const review = Array.isArray(request.review) ? request.review : [];
    const page = Number.isInteger(request.page) && request.page > 0 ? request.page : 1;
    const pageSize = Number.isInteger(request.pageSize) && request.pageSize > 0 ? Math.min(request.pageSize, MAX_PAGE_SIZE) : 60;

    // The Mosaic's own filters, without the species and status dimensions.
    const bind = binder();
    const where = predicates({ ...filters, species: null, sessionType: null, reviewStatus: null, trainingDisposition: null },
        bind, { status: false });
    where.push(`s.type = ${bind.add(HABITAT_TYPE)}`);

    const rows = await db.sequelize.query(
        `SELECT o.observation_id, o.version, o.comname, o."actualPosition", o."mediaPosition", o.tc, o.etc,
                o.video_source, o.session_id, s.dive, s.line, p.name AS project_name,
                rc.decision AS decision, rt.decision AS training_decision
           FROM observations o
           JOIN sessions s ON s.session_id = o.session_id
           LEFT JOIN projects p ON p.project_id = o.project_id
           LEFT JOIN observation_review_current rc
                  ON rc.observation_id = o.observation_id AND rc.purpose = 'scientific'
           LEFT JOIN observation_review_current rt
                  ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
          WHERE ${where.join(' AND ')}
          ORDER BY p.name, s.dive, s.line, o.session_id, o.observation_id`,
        { bind: bind.values, type: db.Sequelize.QueryTypes.SELECT }
    );

    // Each session's segments, with their stretches' review state.
    const bySession = new Map();
    for (const row of rows) {
        if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
        bySession.get(row.session_id).push(row);
    }
    const all = [];
    for (const [sessionId, sessionRows] of bySession) {
        const byId = new Map(sessionRows.map((r) => [r.observation_id, r]));
        const first = sessionRows[0];
        for (const segment of segmentsOf(sessionRows)) {
            if (!matches(segment, { substrates, mode })) continue;
            const stretches = segment.stretch_ids.map((id) => {
                const r = byId.get(id);
                return {
                    observation_id: id, substrate: r.comname, version: r.version,
                    decision: r.decision || null, training_decision: r.training_decision || null,
                };
            });
            const state = reviewOf(stretches);
            if (review.length && !review.includes(state)) continue;
            all.push({
                session_id: sessionId,
                project_name: first.project_name,
                dive: first.dive,
                line: first.line,
                ...segment,
                review: state,
                stretches,
            });
        }
    }

    const start = (page - 1) * pageSize;
    return { total: all.length, page, pageSize, segments: all.slice(start, start + pageSize) };
}

module.exports = { HABITAT_TYPE, MAX_PAGE_SIZE, habitatSegments, reviewOf };
