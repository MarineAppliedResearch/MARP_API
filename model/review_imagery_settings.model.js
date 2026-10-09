/** Persisted administrator policy for the shared review-imagery cache. */

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class ReviewImagerySettings extends Model {}

    ReviewImagerySettings.init({
        id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, defaultValue: 1 },
        max_bytes: { type: DataTypes.BIGINT, allowNull: false },
        low_watermark_percent: { type: DataTypes.SMALLINT, allowNull: false },
        eviction_order: { type: DataTypes.STRING(32), allowNull: false },
        changed_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
        changed_at: { type: DataTypes.DATE, allowNull: false },
    }, {
        sequelize,
        modelName: 'review_imagery_settings',
        tableName: 'review_imagery_settings',
        schema: 'public',
        timestamps: false,
    });

    return ReviewImagerySettings;
};
