/** Database state for full frames and the shared review-imagery cache policy. */

'use strict';

const db = require('../model');
const { QueryTypes } = db.Sequelize;

async function readSettings() {
    const [row] = await db.sequelize.query(
        `SELECT max_bytes, low_watermark_percent, eviction_order,
                changed_by_user_id, changed_at
           FROM review_imagery_settings WHERE id = 1`,
        { type: QueryTypes.SELECT }
    );
    return row;
}

async function writeSettings(settings, userId) {
    const [row] = await db.sequelize.query(
        `UPDATE review_imagery_settings
            SET max_bytes = :maxBytes,
                low_watermark_percent = :lowWatermarkPercent,
                eviction_order = :evictionOrder,
                changed_by_user_id = :userId,
                changed_at = NOW()
          WHERE id = 1
      RETURNING max_bytes, low_watermark_percent, eviction_order,
                changed_by_user_id, changed_at`,
        { replacements: { ...settings, userId }, type: QueryTypes.SELECT }
    );
    return row;
}

async function usage() {
    const [row] = await db.sequelize.query(
        `SELECT (SELECT coalesce(sum(bytes), 0)::bigint FROM (
                    SELECT max(byte_size)::bigint AS bytes
                      FROM observation_thumbnails
                     WHERE status = 'ready' AND filename IS NOT NULL
                     GROUP BY filename
                ) thumbnails) AS thumbnail_bytes,
                (SELECT coalesce(sum(bytes), 0)::bigint FROM (
                    SELECT max(full_frame_byte_size)::bigint AS bytes
                      FROM observation_thumbnails
                     WHERE full_frame_status = 'ready' AND full_frame_filename IS NOT NULL
                     GROUP BY full_frame_filename
                ) full_frames) AS full_frame_bytes`,
        { type: QueryTypes.SELECT }
    );
    return row;
}

async function evictionCandidates() {
    return db.sequelize.query(
        `SELECT 'thumbnail' AS kind, min(observation_id) AS observation_id, filename,
                max(byte_size)::bigint AS byte_size,
                max(coalesce(thumbnail_accessed_at, completed_at, created_at)) AS accessed_at
           FROM observation_thumbnails
          WHERE status = 'ready' AND filename IS NOT NULL AND byte_size IS NOT NULL
          GROUP BY filename
         UNION ALL
         SELECT 'full_frame' AS kind, min(observation_id) AS observation_id,
                full_frame_filename AS filename,
                max(full_frame_byte_size)::bigint AS byte_size,
                max(coalesce(full_frame_accessed_at, full_frame_completed_at, created_at)) AS accessed_at
           FROM observation_thumbnails
          WHERE full_frame_status = 'ready' AND full_frame_filename IS NOT NULL
            AND full_frame_byte_size IS NOT NULL
          GROUP BY full_frame_filename`,
        { type: QueryTypes.SELECT }
    );
}

async function referenceCount(kind, filename) {
    const [row] = kind === 'full_frame'
        ? await db.sequelize.query(
            `SELECT count(*)::int AS count FROM observation_thumbnails
              WHERE full_frame_status = 'ready' AND full_frame_filename = :filename`,
            { replacements: { filename }, type: QueryTypes.SELECT }
        )
        : await db.sequelize.query(
            `SELECT count(*)::int AS count FROM observation_thumbnails
              WHERE status = 'ready' AND filename = :filename`,
            { replacements: { filename }, type: QueryTypes.SELECT }
        );
    return Number(row.count);
}

/** Clears every ready row sharing one content-addressed file before its bytes go. */
async function markFileEvicted(kind, expectedFilename) {
    if (kind === 'full_frame') {
        const rows = await db.sequelize.query(
            `UPDATE observation_thumbnails
                SET full_frame_status = NULL, full_frame_filename = NULL,
                    full_frame_content_type = NULL, full_frame_byte_size = NULL,
                    full_frame_width = NULL, full_frame_height = NULL,
                    full_frame_accessed_at = NULL, full_frame_evicted_at = NOW(),
                    updated_at = NOW()
              WHERE full_frame_status = 'ready'
                AND full_frame_filename = :expectedFilename
          RETURNING observation_id`,
            { replacements: { expectedFilename }, type: QueryTypes.SELECT }
        );
        return rows.length;
    }

    const rows = await db.sequelize.query(
        `UPDATE observation_thumbnails
            SET status = 'failed', permanent = false, filename = NULL,
                content_type = NULL, byte_size = NULL, width = NULL, height = NULL,
                last_error = 'Evicted from the review imagery cache; it will be regenerated when viewed.',
                thumbnail_accessed_at = NULL, thumbnail_evicted_at = NOW(), updated_at = NOW()
          WHERE status = 'ready' AND filename = :expectedFilename
      RETURNING observation_id`,
        { replacements: { expectedFilename }, type: QueryTypes.SELECT }
    );
    return rows.length;
}

async function touch(kind, observationId) {
    const column = kind === 'full_frame' ? 'full_frame_accessed_at' : 'thumbnail_accessed_at';
    await db.sequelize.query(
        `UPDATE observation_thumbnails SET ${column} = NOW()
          WHERE observation_id = :observationId`,
        { replacements: { observationId }, type: QueryTypes.UPDATE }
    );
}

module.exports = {
    evictionCandidates,
    markFileEvicted,
    readSettings,
    referenceCount,
    touch,
    usage,
    writeSettings,
};
