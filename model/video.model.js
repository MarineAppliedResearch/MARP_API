/**
 * A video file and its clock (#76).
 *
 * One row per file as observations name it in `video_source`, created when somebody sets
 * its clock. The clock is when the recording started, in UTC; an observation's moment is
 * that plus its position in the video (`observations.observed_at`).
 *
 * @fileoverview Sequelize model for videos.
 * @module model/video
 */

'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    /**
     * One video file, and when its recording started.
     *
     * @class videos
     * @extends Model
     */
    class videos extends Model {}

    videos.init(
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            video_source: {
                type: DataTypes.STRING(512),
                allowNull: false,
                unique: true,
                comment: 'The file, as observations name it in video_source.',
            },
            jellyfin_item_id: { type: DataTypes.STRING(64), allowNull: true },
            recorded_start: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: 'When the recording started, UTC. Null until somebody sets the clock.',
            },
            start_source: {
                type: DataTypes.STRING(16),
                allowNull: true,
                comment: 'file-name, entered or synced.',
            },
            start_set_by: { type: DataTypes.INTEGER, allowNull: true },
            start_set_at: { type: DataTypes.DATE, allowNull: true },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        {
            sequelize,
            modelName: 'videos',
            tableName: 'videos',
            timestamps: false,
        }
    );

    return videos;
};
