'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class WorkerActivationCodes extends Model {
        static associate(models) {
            this.belongsTo(models.gpu_workers, { as: 'consumedByWorker', foreignKey: 'consumed_by_worker_id' });
            this.belongsTo(models.users, { as: 'createdBy', foreignKey: 'created_by_user_id' });
        }
    }

    WorkerActivationCodes.init({
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        code_prefix: { type: DataTypes.STRING(16), allowNull: false },
        code_hash: { type: DataTypes.STRING(64), allowNull: false },
        label: { type: DataTypes.STRING(255), allowNull: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        consumed_at: { type: DataTypes.DATE, allowNull: true },
        consumed_by_worker_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
    }, {
        sequelize,
        modelName: 'worker_activation_codes',
        tableName: 'worker_activation_codes',
        schema: 'public',
        timestamps: true,
    });
    return WorkerActivationCodes;
};
