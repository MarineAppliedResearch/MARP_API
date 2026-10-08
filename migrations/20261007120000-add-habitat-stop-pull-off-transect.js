/**
 * Puts Pull, Stop and Off Transect on the Habitat list wherever they are missing.
 *
 * Pull (666009) and Stop (666010) were added to production's Habitat list by hand
 * on 2026-10-07, so every other database -- development, CI, a fresh workspace --
 * lacked them. The annotation GUI's stop/pull import (VIDEO_PROCESSING_GUI#254)
 * turns the field log's "Off" rows into Off Transect, which no database had yet.
 *
 * Each item is inserted only when the Habitat list has neither its taxserial nor
 * its name, so production keeps the rows it already has, with their ids and
 * button order, and running twice adds nothing.
 *
 * Pull and Stop take the button order production gave them. Off Transect goes at
 * the end of the HAB tab, after whatever is there now.
 *
 * @fileoverview Migration adding the stop/pull/off-transect habitat items.
 * @author Isaac Travers
 * @module migrations/add-habitat-stop-pull-off-transect
 */

'use strict';

const { QueryTypes } = require('sequelize');
const { guardDataIntegrity } = require('../db/data-integrity');

const LIST = 'Habitat';

// Production's own values for the two it already has.
const ITEMS = [
    { taxserial: 666009, name: 'Pull', order: '6' },
    { taxserial: 666010, name: 'Stop', order: '7' },
    { taxserial: 666011, name: 'Off Transect', order: null },
];

const OFF_TRANSECT = ITEMS[2];

/**
 * The next free button position on the HAB tab. The order columns are text, so
 * only the numeric ones count.
 *
 * @async
 * @param {Object} sequelize - Sequelize instance.
 * @param {Object} transaction - Transaction to read in.
 * @returns {Promise<string>} One past the highest item or home order on the tab.
 */
async function nextHabOrder(sequelize, transaction) {
    const [row] = await sequelize.query(
        `SELECT COALESCE(max(GREATEST(
                    CASE WHEN gui_item_order ~ '^[0-9]+$' THEN gui_item_order::int END,
                    CASE WHEN gui_home_order ~ '^[0-9]+$' THEN gui_home_order::int END)), 0) + 1 AS next
           FROM species
          WHERE species_list = :list AND gui_maintab = 'HAB'`,
        { replacements: { list: LIST }, type: QueryTypes.SELECT, transaction }
    );

    return String(row.next);
}

/** @type {Object} */
module.exports = {
    /**
     * Inserts each item the Habitat list does not already have.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface.
     * @returns {Promise<void>} Resolves once all three items exist.
     * @throws {Error} If a taxserial is already used on the list by another name.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'habitat stop/pull/off',
                tables: ['species'],
                work: async () => {
                    for (const item of ITEMS) {
                        const existing = await sequelize.query(
                            `SELECT id, taxserial, comname FROM species
                              WHERE species_list = :list
                                AND (taxserial = :taxserial OR lower(comname) = lower(:name))`,
                            { replacements: { list: LIST, ...item }, type: QueryTypes.SELECT, transaction }
                        );

                        if (existing.length > 0) {
                            // Same number under another name is a different item; stop
                            // rather than give the import the wrong button.
                            const clash = existing.find(
                                (r) => Number(r.taxserial) === item.taxserial
                                    && r.comname.toLowerCase() !== item.name.toLowerCase()
                            );

                            if (clash) {
                                throw new Error(
                                    `${LIST} taxserial ${item.taxserial} is already '${clash.comname}' `
                                    + `(id ${clash.id}), not '${item.name}'`
                                );
                            }

                            console.log(`[habitat stop/pull/off] ${item.name}: already present (id ${existing[0].id})`);
                            continue;
                        }

                        const order = item.order || await nextHabOrder(sequelize, transaction);

                        // Same tab, sub-tab and shape as the other HAB buttons.
                        await sequelize.query(
                            `INSERT INTO species (taxserial, comname, gui_display_name, species_list,
                                                  gui_maintab, gui_subtab, gui_main_tab_order,
                                                  gui_sub_tab_order, gui_item_order, gui_home_order,
                                                  is_active, created_at, updated_at)
                             VALUES (:taxserial, :name, :name, :list, 'HAB', 'TYPE1', '1', '1',
                                     :order, :order, true, NOW(), NOW())`,
                            { replacements: { list: LIST, ...item, order }, transaction }
                        );

                        console.log(`[habitat stop/pull/off] ${item.name}: added at order ${order}`);
                    }
                },
            });

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    },

    /**
     * Removes Off Transect, the one item no database had before this. Pull and Stop
     * stay: production had them first, and this cannot tell its rows from ours.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface.
     * @returns {Promise<void>} Resolves once Off Transect is gone.
     * @throws {Error} If an observation already records Off Transect.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;

        // An observation names its item by taxserial and comname, with no foreign
        // key, so the guard cannot see this loss; refuse it here instead.
        const [used] = await sequelize.query(
            'SELECT count(*)::int AS n FROM observations WHERE taxserial = :taxserial',
            { replacements: { taxserial: String(OFF_TRANSECT.taxserial) }, type: QueryTypes.SELECT }
        );

        if (used.n > 0) {
            throw new Error(
                `${used.n} observation(s) record Off Transect (${OFF_TRANSECT.taxserial}); not removing it`
            );
        }

        await sequelize.query(
            'DELETE FROM species WHERE species_list = :list AND taxserial = :taxserial',
            { replacements: { list: LIST, taxserial: OFF_TRANSECT.taxserial } }
        );
    },
};
