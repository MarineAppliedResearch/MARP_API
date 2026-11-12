/**
 * A habitat segment's picture is kept once it is cut (#287, A21).
 *
 * Settled with Isaac on 2026-11-12: a segment's picture is cut on request from its middle
 * frame with the habitat crop, and kept like a thumbnail. A segment is worked out when the
 * Mosaic's query runs and has no row of its own, so its picture is kept by what it is a
 * picture of: the video, the moment in it, and the crop. The JPEG lives beside the
 * observation thumbnails, in a folder of its own; this records which file it is, or why it
 * could not be cut and when that was last tried.
 *
 * Refs #287.
 *
 * @fileoverview Migration adding habitat_segment_pictures.
 * @module migrations/a-habitat-segment-keeps-its-picture
 */

'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('habitat_segment_pictures', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            video_source: {
                type: Sequelize.STRING(255), allowNull: false,
                comment: 'The video, as observations record it.',
            },
            media_ms: {
                type: Sequelize.INTEGER, allowNull: false,
                comment: 'The moment in the video file the picture is cut at: the segment\'s middle, in milliseconds.',
            },
            crop: {
                type: Sequelize.STRING(64), allowNull: false,
                comment: 'The crop, as x0,y0,x1,y1 fractions of the frame.',
            },
            status: {
                type: Sequelize.STRING(16), allowNull: false,
                comment: '"ready", or "failed" with last_error; a failure is tried again after a while.',
            },
            filename: { type: Sequelize.STRING(255), allowNull: true },
            last_error: { type: Sequelize.TEXT, allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        });
        await queryInterface.addIndex('habitat_segment_pictures', ['video_source', 'media_ms', 'crop'], {
            unique: true, name: 'habitat_segment_pictures_moment',
        });
        await queryInterface.sequelize.query(
            "COMMENT ON TABLE habitat_segment_pictures IS 'The picture of a habitat segment in the Mosaic, cut from its middle frame with the habitat crop (#287).'"
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('habitat_segment_pictures');
    },
};
