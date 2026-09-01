/**
 * Adds `width` and `height` to `species_pictures`, and backfills them for the
 * imported set.
 *
 * Worth storing rather than reading off disk each time: a species picker asks
 * for a couple of hundred picture records at once and wants to lay out boxes
 * before any image has loaded, and opening 200 files to answer that is work the
 * database can do for free.
 *
 * Also makes the vetting rule visible. Every one of the 646 imported pictures is
 * exactly 244 pixels wide -- 633 of them are 244x176 -- because the annotation
 * GUI's species buttons are built around that width. Uploads are resized to
 * match, and recording the dimensions is what lets anyone check that held.
 *
 * Refs #52.
 *
 * @fileoverview Migration adding and backfilling species_pictures width/height.
 * @author Isaac Travers
 * @module migrations/add-species-picture-dimensions
 */

'use strict';

const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

/**
 * Directory the picture files live in.
 *
 * @constant
 * @type {string}
 */
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'species-pictures');

/** @type {Object} */
module.exports = {
    /**
     * Adds both columns, then measures every stored file.
     *
     * Rows whose file is missing are left null and reported: storage can be
     * restored separately from the database, and a missing file is worth seeing
     * rather than failing the whole migration over.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once both columns exist and are backfilled.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            for (const [column, comment] of [
                ['width', 'Width of the picture in pixels. Uploads are resized so this is 244, matching the width the annotation GUI\'s species buttons are built around.'],
                ['height', 'Height of the picture in pixels. Varies with the source image\'s aspect ratio.'],
            ]) {
                await queryInterface.addColumn(
                    'species_pictures',
                    column,
                    { type: Sequelize.INTEGER, allowNull: true, comment },
                    { transaction }
                );
            }

            const pictures = await sequelize.query(
                'SELECT id, filename FROM species_pictures ORDER BY id',
                { type: QueryTypes.SELECT, transaction }
            );

            let measured = 0;
            /** @type {Array<string>} */
            const missing = [];
            /** @type {Array<string>} */
            const unreadable = [];
            /** @type {Object<string, number>} */
            const widths = {};

            for (const picture of pictures) {
                const filePath = path.join(STORAGE_DIR, picture.filename);

                if (!fs.existsSync(filePath)) {
                    missing.push(picture.filename);
                    continue;
                }

                let metadata;
                try {
                    metadata = await sharp(filePath).metadata();
                } catch (readError) {
                    unreadable.push(`${picture.filename} (${readError.message})`);
                    continue;
                }

                await sequelize.query(
                    'UPDATE species_pictures SET width = :width, height = :height, updated_at = NOW() WHERE id = :id',
                    {
                        replacements: { width: metadata.width, height: metadata.height, id: picture.id },
                        transaction,
                    }
                );

                widths[metadata.width] = (widths[metadata.width] || 0) + 1;
                measured += 1;
            }

            const widthSummary = Object.entries(widths)
                .sort((a, b) => b[1] - a[1])
                .map(([width, count]) => `${width}px x${count}`)
                .join(', ');

            console.log(
                `[species picture dimensions] measured ${measured} of ${pictures.length} pictures; `
                + `widths: ${widthSummary || 'none'}`
            );
            for (const filename of missing) {
                console.log(`[species picture dimensions]   file missing from storage: ${filename}`);
            }
            for (const detail of unreadable) {
                console.log(`[species picture dimensions]   could not read: ${detail}`);
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes both columns. The dimensions are derivable from the files, so
     * nothing is lost.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once both columns are gone.
     * @throws {Error} Re-throws after rolling back if removal fails.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeColumn('species_pictures', 'height', { transaction });
            await queryInterface.removeColumn('species_pictures', 'width', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
