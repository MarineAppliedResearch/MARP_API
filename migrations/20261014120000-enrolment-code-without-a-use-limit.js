'use strict';

/**
 * Lets an enrolment code have no use limit at all (#208).
 *
 * The code baked into the volunteer installer was capped at 10,000 machines. Past that the
 * installer people had already downloaded would simply stop working, and the only fix would
 * be to build and distribute a new one -- for a number nobody is watching. Isaac, 2026-10-14:
 * *"if someone has OUR build of our worker, then it should work"*.
 *
 * So `max_uses` becomes nullable and **null means no limit**. A code minted by hand for one
 * machine still carries 1, which is what makes it single-use; nothing existing changes.
 * Revoking is unaffected and still stops every machine at once, and each worker's own
 * credential stays individually revocable -- those are the controls, not a counter.
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('worker_activation_codes', 'max_uses', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: 1,
            comment: 'How many machines may activate with this code. NULL means no limit (#208).',
        });
    },

    async down(queryInterface, Sequelize) {
        // Anything unlimited becomes the old ceiling rather than failing the column's NOT NULL.
        await queryInterface.sequelize.query(
            'UPDATE worker_activation_codes SET max_uses = 10000 WHERE max_uses IS NULL'
        );
        await queryInterface.changeColumn('worker_activation_codes', 'max_uses', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 1,
        });
    },
};
