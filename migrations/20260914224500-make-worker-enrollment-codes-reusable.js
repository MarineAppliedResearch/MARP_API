'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('worker_activation_codes', 'max_uses', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 1,
        });
        await queryInterface.addColumn('worker_activation_codes', 'use_count', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
        });
        await queryInterface.addColumn('worker_activation_codes', 'revoked_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('worker_activation_codes', 'revoked_at');
        await queryInterface.removeColumn('worker_activation_codes', 'use_count');
        await queryInterface.removeColumn('worker_activation_codes', 'max_uses');
    },
};
