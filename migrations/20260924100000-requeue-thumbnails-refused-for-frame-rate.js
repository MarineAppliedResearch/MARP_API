'use strict';

/**
 * Put back in the queue the thumbnails refused for their video's frame rate (#231).
 *
 * The extractor compared the video's **average** frame rate with 25 and refused,
 * **permanently**, any video where they differed, because the same video reports the
 * same rate on every retry. But an average below 25 is usually a 25 fps video whose
 * timestamps jump, and frame numbers are on the playback clock, so those rows were
 * refused for nothing. The extractor now reads the nominal rate. Nothing else would
 * ever retry these rows, because a permanent failure is not re-queued.
 *
 * Every row with that refusal. One on a video whose nominal rate really is not 25 is
 * refused again on its next pass, which costs one probe.
 *
 * It changes queue state in `observation_thumbnails`, which is derived and remade from the
 * database alone, and it touches no observation. Safe to run twice.
 *
 * **No meaningful `down`.** Under the old code the next pass refuses these rows again by
 * itself, so there is nothing to restore by hand.
 *
 * @fileoverview Re-queues thumbnails refused for a non-25 frame rate.
 * @author Isaac Travers
 * @module migrations/requeue-thumbnails-refused-for-frame-rate
 */

/** The start of the refusal `frameRateRefusal` writes, and nothing else writes. */
const REFUSAL = 'Source frame rate is %';

module.exports = {
    /**
     * Re-queue the refused tiles and full frames.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when they are queued.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;

        const [, tiles] = await sequelize.query(
            `UPDATE observation_thumbnails t
                SET status = 'queued', permanent = false,
                    claimed_at = NULL, completed_at = NULL,
                    requested_at = NOW(), updated_at = NOW()
               FROM observations o
              WHERE o.observation_id = t.observation_id
                AND t.status = 'failed' AND t.permanent
                AND t.last_error LIKE :refusal`,
            { replacements: { refusal: REFUSAL } }
        );

        const [, frames] = await sequelize.query(
            `UPDATE observation_thumbnails t
                SET full_frame_status = 'queued', full_frame_permanent = false,
                    full_frame_claimed_at = NULL, full_frame_completed_at = NULL,
                    full_frame_requested_at = NOW(), updated_at = NOW()
               FROM observations o
              WHERE o.observation_id = t.observation_id
                AND t.full_frame_status = 'failed' AND t.full_frame_permanent
                AND t.full_frame_last_error LIKE :refusal`,
            { replacements: { refusal: REFUSAL } }
        );

        console.log(
            `[thumbnails] re-queued ${tiles.rowCount ?? 0} tile(s) and ${frames.rowCount ?? 0} full frame(s) `
            + 'refused for a non-25 frame rate.'
        );
    },

    /**
     * Deliberately nothing. See this file's header.
     *
     * @async
     * @returns {Promise<void>} Resolves immediately.
     */
    async down() {
        console.log('[thumbnails] down is a no-op: the old code refuses these rows again on its next pass.');
    },
};
