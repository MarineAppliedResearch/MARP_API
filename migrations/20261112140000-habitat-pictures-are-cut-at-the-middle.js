/**
 * Habitat stretches' pictures are cut again, at the middle of the stretch (#287).
 *
 * Isaac, 2026-11-12: a habitat stretch's tile is how a reviewer tells whether its substrate
 * is right, and the thumbnail extractor now cuts it midway between the stretch's first and
 * last keyframe instead of at its start -- the start is where the substrate changes, so the
 * picture showed the one before. Pictures already made were cut at the start, so they are
 * queued again, the way `requestRefresh` queues a picture whose keyframes were edited: from
 * the first candidate, which is now the middle.
 *
 * Only habitat sessions' ready pictures. Ordinary priority (0), behind anything a reviewer
 * asks for. The old file stays until the new one replaces it; while a stretch waits its tile
 * shows it as queued.
 *
 * `down` puts nothing back: a picture cut at the middle is not worse than one at the start.
 *
 * Refs #287.
 *
 * @fileoverview Migration re-queueing habitat stretches' pictures.
 * @module migrations/habitat-pictures-are-cut-at-the-middle
 */

'use strict';

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
                AND t.status = 'ready'`
        );
        console.log(`[habitat pictures] ${result && result.rowCount !== undefined ? result.rowCount : '?'} habitat pictures queued to be cut at the middle`);
    },

    async down() {
        // Nothing to undo: see the header.
    },
};
