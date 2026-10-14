'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

module.exports = {
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        await sequelize.transaction(async (transaction) => {
          await guardDataIntegrity({
            sequelize,
            transaction,
            tables: ['gpu_workers', 'service_tokens'],
            label: 'worker-activation-releases',
            work: async () => {
            await queryInterface.createTable('worker_releases', {
                id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
                version: { type: Sequelize.STRING(64), allowNull: false },
                platform: { type: Sequelize.STRING(32), allowNull: false },
                architecture: { type: Sequelize.STRING(32), allowNull: false },
                compute_runtime: { type: Sequelize.STRING(32), allowNull: false },
                download_url: { type: Sequelize.TEXT, allowNull: false },
                size_bytes: { type: Sequelize.BIGINT, allowNull: false },
                sha256: { type: Sequelize.STRING(64), allowNull: false },
                approved_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
                approved_by_user_id: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    references: { model: { tableName: 'users', schema: 'public' }, key: 'user_id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'SET NULL',
                },
                createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
                updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
            }, { transaction });
            await queryInterface.addConstraint('worker_releases', {
                fields: ['version', 'platform', 'architecture', 'compute_runtime'],
                type: 'unique',
                name: 'worker_releases_version_platform_arch_runtime_unique',
                transaction,
            });

            await queryInterface.createTable('worker_activation_codes', {
                id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
                code_prefix: { type: Sequelize.STRING(16), allowNull: false },
                code_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
                label: { type: Sequelize.STRING(255), allowNull: true },
                expires_at: { type: Sequelize.DATE, allowNull: false },
                consumed_at: { type: Sequelize.DATE, allowNull: true },
                consumed_by_worker_id: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    references: { model: { tableName: 'gpu_workers', schema: 'public' }, key: 'id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'SET NULL',
                },
                created_by_user_id: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    references: { model: { tableName: 'users', schema: 'public' }, key: 'user_id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'SET NULL',
                },
                createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
                updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
            }, { transaction });

            await queryInterface.addColumn('gpu_workers', 'service_token_id', {
                type: Sequelize.INTEGER,
                allowNull: true,
                unique: true,
                references: { model: { tableName: 'service_tokens', schema: 'public' }, key: 'service_token_id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'platform', { type: Sequelize.STRING(32), allowNull: true }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'architecture', { type: Sequelize.STRING(32), allowNull: true }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'compute_runtime', { type: Sequelize.STRING(32), allowNull: true }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'desired_release_id', {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: { tableName: 'worker_releases', schema: 'public' }, key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'update_state', {
                type: Sequelize.STRING(32), allowNull: false, defaultValue: 'current',
            }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'update_message', { type: Sequelize.TEXT, allowNull: true }, { transaction });
            await queryInterface.addColumn('gpu_workers', 'update_reported_at', { type: Sequelize.DATE, allowNull: true }, { transaction });
            },
          });
        });
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        await sequelize.transaction(async (transaction) => {
          await guardDataIntegrity({
            sequelize,
            transaction,
            tables: ['gpu_workers', 'service_tokens'],
            label: 'worker-activation-releases-down',
            work: async () => {
            for (const column of ['update_reported_at', 'update_message', 'update_state', 'compute_runtime', 'architecture', 'platform']) {
                await queryInterface.removeColumn('gpu_workers', column, { transaction });
            }
            },
          });
            // These columns participate in foreign keys discovered by the
            // guard. Drop them afterwards so its second snapshot never tries
            // to inspect a column that ceased to exist.
            await queryInterface.removeColumn('gpu_workers', 'desired_release_id', { transaction });
            await queryInterface.removeColumn('gpu_workers', 'service_token_id', { transaction });
            await queryInterface.dropTable('worker_activation_codes', { transaction });
            await queryInterface.dropTable('worker_releases', { transaction });
        });
    },
};
