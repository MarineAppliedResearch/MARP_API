'use strict';

/**
 * A session says how the timecode on its video counts frames.
 *
 * MarineAppliedResearch/VIDEO_PROCESSING_GUI#221. The annotation GUI syncs a session
 * by having someone type the timecode burned into the picture, and it assumed that
 * timecode counts 25 a second. DEPR2's video is 25 fps but its timecode is 29.97
 * drop-frame, so a typed frame was read wrongly and the clock disagreed with the
 * picture. The rate is not in the video file, so the GUI asks for it once per session
 * and keeps it here.
 *
 * It only says how to read and show the timecode. `observations.frame` is still the
 * video's own frame, derived at the file's rate.
 *
 * Adds one nullable column and changes no row: null means 25, which is what every
 * existing session was recorded with. `down` drops it.
 *
 * @fileoverview Migration adding sessions.timecode_rate.
 * @module migrations/a-session-says-how-its-timecode-counts
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('sessions', 'timecode_rate', {
            type: Sequelize.STRING(16),
            allowNull: true,
            comment: "How the video's burned-in timecode counts: '25' or '29.97DF' (VIDEO_PROCESSING_GUI#221); null means 25.",
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('sessions', 'timecode_rate');
    },
};
