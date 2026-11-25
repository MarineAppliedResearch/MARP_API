/**
 * A dataset's pictures, and the decisions reviewers make about them (#271).
 *
 * A picture is one frame of one observation in a built dataset. The build records them
 * (`dataset_pictures`); reviewing a dataset in the Mosaic decides them (`picture_reviews`).
 *
 * @fileoverview Reads and writes for dataset_pictures and picture_reviews.
 * @module repository/dataset-picture
 */

'use strict';

const db = require('../model');

/** Rows per insert: well under PostgreSQL's 65,535 bind parameters at nine a row. */
const CHUNK = 1000;

/**
 * Record a build's pictures. A picture already recorded is left as it was, so a build
 * resumed after a restart can record its pictures again.
 *
 * @async
 * @param {Array<Object>} rows - `{dataset_id, observation_id, video_source, framenum, split,
 *   drawn, picture}`.
 * @returns {Promise<number>} How many were offered.
 */
async function recordPictures(rows) {
    for (let at = 0; at < rows.length; at += CHUNK) {
        const chunk = rows.slice(at, at + CHUNK);
        const bind = [];
        const values = chunk.map((row) => {
            const base = bind.length;

            bind.push(row.dataset_id, row.observation_id, row.video_source, row.framenum,
                row.split, JSON.stringify(row.drawn), row.picture, row.crop || null,
                row.crop_rect ? JSON.stringify(row.crop_rect) : null);

            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, `
                + `$${base + 7}, $${base + 8}, $${base + 9}::jsonb)`;
        });

        await db.sequelize.query(
            `INSERT INTO dataset_pictures
                 (dataset_id, observation_id, video_source, framenum, split, drawn, picture, crop, crop_rect)
             VALUES ${values.join(', ')}
             ON CONFLICT (dataset_id, observation_id, framenum) DO NOTHING`,
            { bind }
        );
    }

    return rows.length;
}

/**
 * A dataset's pictures of some observations, with each one's current decision.
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @param {Array<number>} observationIds - Whose pictures.
 * @returns {Promise<Array<Object>>} Ordered by observation, then frame.
 */
async function picturesOf(datasetId, observationIds) {
    if (!observationIds.length) return [];

    return db.sequelize.query(
        `SELECT dp.observation_id, dp.framenum, dp.split, dp.drawn, dp.picture, dp.crop, dp.crop_rect,
                pr.decision, pr.reason, pr.note, pr.reviewer_id,
                -- Every other box the dataset drew on the same picture, so a missing one shows.
                (SELECT coalesce(json_agg(json_build_object('observation_id', o2.observation_id, 'drawn', o2.drawn)
                                          ORDER BY o2.observation_id), '[]'::json)
                   FROM dataset_pictures o2
                  WHERE o2.dataset_id = dp.dataset_id AND o2.video_source = dp.video_source
                    AND o2.framenum = dp.framenum AND o2.observation_id <> dp.observation_id) AS others
           FROM dataset_pictures dp
           LEFT JOIN picture_review_current pr
                  ON pr.observation_id = dp.observation_id AND pr.framenum = dp.framenum
          WHERE dp.dataset_id = $1 AND dp.observation_id = ANY($2::int[])
          ORDER BY dp.observation_id, dp.framenum`,
        { bind: [datasetId, observationIds], type: db.Sequelize.QueryTypes.SELECT }
    );
}

/**
 * Where one picture's file is -- the whole picture, or this observation's crop of it -- or
 * null when the dataset has no such picture.
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @param {number} observationId - The observation.
 * @param {number} framenum - The frame.
 * @param {string} [kind] - `picture` or `crop`.
 * @returns {Promise<?string>} Relative to the dataset directory.
 */
async function pictureFile(datasetId, observationId, framenum, kind = 'picture') {
    const [row] = await db.sequelize.query(
        `SELECT picture, crop FROM dataset_pictures
          WHERE dataset_id = $1 AND observation_id = $2 AND framenum = $3`,
        { bind: [datasetId, observationId, framenum], type: db.Sequelize.QueryTypes.SELECT }
    );

    if (!row) return null;

    return kind === 'crop' ? row.crop : row.picture;
}

/**
 * Record decisions about pictures, one log row each.
 *
 * @async
 * @param {Array<Object>} decisions - `{observation_id, framenum, decision, reason, note}`.
 * @param {number} reviewerId - Who decided.
 * @param {?number} datasetId - The dataset they were reviewing.
 * @returns {Promise<number>} How many were written.
 */
async function recordDecisions(decisions, reviewerId, datasetId) {
    if (!decisions.length) return 0;

    const bind = [];
    const values = decisions.map((d) => {
        const base = bind.length;

        bind.push(d.observation_id, d.framenum, d.decision, d.reason || null, d.note || null,
            reviewerId, datasetId);

        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    await db.sequelize.query(
        `INSERT INTO picture_reviews
             (observation_id, framenum, decision, reason, note, reviewer_id, dataset_id)
         VALUES ${values.join(', ')}`,
        { bind }
    );

    return decisions.length;
}

module.exports = {
    picturesOf,
    pictureFile,
    recordDecisions,
    recordPictures,
};
