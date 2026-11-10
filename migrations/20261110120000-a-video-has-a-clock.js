'use strict';

/**
 * A video has a clock, and an observation has the moment it was seen (#76).
 *
 * Settled with Isaac on 2026-11-09 (MARP_API#76): every observation carries the real date
 * and time it was seen, in UTC. The clock belongs to the **video file**, not the session --
 * a session spans several files and a file can sit in several sessions -- so:
 *
 * - `videos`, one row per file as observations name it (`video_source`), holds when its
 *   recording started and how that was learned: accepted from the file name, entered by
 *   hand, or synced by reading the clock burnt into a frame. A row exists only once
 *   somebody sets a clock; a video with none keeps video-position times, and says so.
 * - `observations.observed_at` is that start plus the observation's position in the video.
 *   Null where the video has no clock.
 *
 * **Nothing existing is rewritten.** Both are new and start empty; existing observations
 * gain a time when their video's clock is set, one video at a time (Isaac: not in bulk).
 * `down` drops both, and nothing else changed.
 *
 * @fileoverview Migration adding videos and observations.observed_at.
 * @module migrations/a-video-has-a-clock
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.createTable('videos', {
                id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
                video_source: {
                    type: Sequelize.STRING(512),
                    allowNull: false,
                    unique: true,
                    comment: 'The file, as observations name it in video_source: Jellyfin\'s file name, extension included.',
                },
                jellyfin_item_id: {
                    type: Sequelize.STRING(64),
                    allowNull: true,
                    comment: 'The Jellyfin item last seen for this file, where known.',
                },
                recorded_start: {
                    type: Sequelize.DATE,
                    allowNull: true,
                    comment: 'When the recording started, UTC. Null until somebody sets the clock.',
                },
                start_source: {
                    type: Sequelize.STRING(16),
                    allowNull: true,
                    comment: 'How the start was learned: file-name (accepted from the name), entered (typed), synced (read off the clock in a frame).',
                },
                start_set_by: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    references: { model: 'users', key: 'user_id' },
                    onDelete: 'SET NULL',
                    comment: 'Who set the clock.',
                },
                start_set_at: {
                    type: Sequelize.DATE,
                    allowNull: true,
                    comment: 'When the clock was set.',
                },
                created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
                updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
            }, { transaction });

            await queryInterface.sequelize.query(
                `ALTER TABLE videos ADD CONSTRAINT videos_start_source_check
                   CHECK (start_source IS NULL OR start_source IN ('file-name', 'entered', 'synced'))`,
                { transaction }
            );
            await queryInterface.addIndex('videos', ['jellyfin_item_id'], { name: 'videos_jellyfin_item_id_idx', transaction });

            await queryInterface.addColumn('observations', 'observed_at', {
                type: Sequelize.DATE,
                allowNull: true,
                comment: 'When the observation was seen, UTC: its video\'s recorded start plus its position in the video (#76). Null where the video has no clock.',
            }, { transaction });
            await queryInterface.addIndex('observations', ['observed_at'], { name: 'observations_observed_at_idx', transaction });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.removeIndex('observations', 'observations_observed_at_idx', { transaction });
            await queryInterface.removeColumn('observations', 'observed_at', { transaction });
            await queryInterface.dropTable('videos', { transaction });
        });
    },
};
