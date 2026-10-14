'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class WorkerReleases extends Model {
        static associate(models) {
            this.belongsTo(models.users, { as: 'approvedBy', foreignKey: 'approved_by_user_id' });
            this.hasMany(models.gpu_workers, { as: 'targetedWorkers', foreignKey: 'desired_release_id' });
        }
    }

    WorkerReleases.init({
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        version: { type: DataTypes.STRING(64), allowNull: false },
        platform: { type: DataTypes.STRING(32), allowNull: false },
        architecture: { type: DataTypes.STRING(32), allowNull: false },
        compute_runtime: { type: DataTypes.STRING(32), allowNull: false },
        download_url: { type: DataTypes.TEXT, allowNull: false },
        size_bytes: { type: DataTypes.BIGINT, allowNull: false },
        sha256: { type: DataTypes.STRING(64), allowNull: false },
        approved_at: { type: DataTypes.DATE, allowNull: false },
        approved_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
    }, {
        sequelize,
        modelName: 'worker_releases',
        tableName: 'worker_releases',
        schema: 'public',
        timestamps: true,
    });
    return WorkerReleases;
};
