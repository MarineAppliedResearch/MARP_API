/**
 * Habitat stretches failed for having no keyframes are queued for a picture once (#287).
 *
 * Settled with Isaac on 2026-11-12 (A20, A22): every habitat observation has a start and an
 * end keyframe with the habitat crop as the box, worked out from its times and never
 * written. The thumbnail extractor now works them out, so an annotator's habitat stretch can
 * have a picture. But every one the extractor saw before this was failed permanently with
 * "The observation has no keyframes...", and a permanent failure is never retried: left
 * alone they would stay without a picture until somebody pressed Retry on each.
 *
 * So those rows, and only those -- habitat sessions, that exact failure -- go back on the
 * queue at ordinary priority (0), behind anything a reviewer asks for. No observation or
 * keyframe is touched; only the picture queue. No request reached the media server for these
 * rows: they were failed before a stream was opened.
 *
 * `down` puts nothing back: a re-queued row is either made or failed again on its own terms.
 *
 * Refs #287.
 *
 * @fileoverview Migration re-queueing no-keyframes failures of habitat stretches.
 * @module migrations/habitat-stretches-get-their-pictures
 */

'use strict';

/** The failure, as the extractor records it (`NO_KEYFRAMES_ERROR`) on the day this was written. */
const NO_KEYFRAMES_ERROR = 'The observation has no keyframes, so it has no bounding box and can never have a cropped picture.';

module.exports = {
    async up(queryInterface) {
        const [, result] = await queryInterface.sequelize.query(
            `UPDATE observation_thumbnails t
                SET status = 'queued',
                    permanent = false,
                    request_priority = 0,
                    candidate_index = 0,
                    claimed_at = NULL,
                    completed_at = NULL,
                    requested_at = NOW(),
                    updated_at = NOW()
               FROM observations o
               JOIN sessions s ON s.session_id = o.session_id
              WHERE t.observation_id = o.observation_id
                AND s.type = 'Habitat'
                AND t.status = 'failed'
                AND t.permanent
                AND t.last_error = :error`,
            { replacements: { error: NO_KEYFRAMES_ERROR } }
        );
        console.log(`[habitat pictures] ${result && result.rowCount !== undefined ? result.rowCount : '?'} habitat stretches queued for a picture`);
    },

    async down() {
        // Nothing to undo: see the header.
    },
};
