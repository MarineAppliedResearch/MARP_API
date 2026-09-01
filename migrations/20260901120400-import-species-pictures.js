/**
 * Imports the annotation GUI's species pictures into `species_pictures`, and
 * copies the files into `storage/species-pictures/` where the API serves them
 * from.
 *
 * The pictures are checked in under `seed-data/species/images/`, so this
 * migration is what puts them on any machine the API is deployed to -- nobody
 * has to copy 663 files onto production by hand.
 *
 * Matching a picture to a species is the whole job, because the association only
 * ever existed as a filename. Files are named
 * `Common Name_taxserial_FI20200619.png` and sit in a folder named after their
 * list, so the folder gives the list and the filename gives the taxserial, which
 * together identify a species row. The GUI resolved this by scanning the
 * directory for `_<taxserial>_` at display time and recording nothing.
 *
 * Files that do not match are reported rather than dropped quietly. Some are
 * pictures for entries that have since been removed or renumbered, which is
 * worth a person seeing.
 *
 * Refs #52.
 *
 * @fileoverview Migration importing species pictures and copying the files into storage.
 * @author Isaac Travers
 * @module migrations/import-species-pictures
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { IMAGES_DIR } = require('../seed-data/species/species-source');

/**
 * Runtime directory the API serves pictures from, and where an upload page will
 * later write to. Deliberately outside `seed-data/`, which is read-only source
 * material.
 *
 * @constant
 * @type {string}
 */
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'species-pictures');

/**
 * File extension to MIME type. Anything not listed is skipped rather than
 * served with a guessed type.
 *
 * @constant
 * @type {Object<string, string>}
 */
const CONTENT_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

/**
 * Pulls the taxserial out of a GUI picture filename.
 *
 * The convention is `<name>_<taxserial>_<suffix>.png`, so the number sits
 * between the first pair of underscores. A few files have no number at all
 * (`UI Urchin Type 1 IMG_0130.png`) and cannot be matched to anything.
 *
 * @param {string} filename - Basename of the picture file.
 * @returns {number|null} The taxserial, or null when the name carries none.
 */
function taxserialFromFilename(filename) {
    const match = /_(\d+)_/.exec(filename);
    if (!match) {
        return null;
    }
    return Number.parseInt(match[1], 10);
}

/** @type {Object} */
module.exports = {
    /**
     * Copies every matched picture into storage and records it.
     *
     * Re-runnable: the unique index on `(species_id, filename)` means a second
     * run updates the same rows, and files are overwritten rather than
     * duplicated.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once every matched picture is stored and recorded.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            const species = await sequelize.query(
                'SELECT id, species_list, taxserial FROM species WHERE species_list IS NOT NULL',
                { type: QueryTypes.SELECT, transaction }
            );

            /** @type {Map<string, number>} */
            const speciesIdByKey = new Map(
                species.map((row) => [`${row.species_list} ${row.taxserial}`, row.id])
            );

            fs.mkdirSync(STORAGE_DIR, { recursive: true });

            /** @type {Array<string>} */
            const unmatched = [];
            /** @type {Array<string>} */
            const unparsable = [];
            /** @type {Map<number, number>} */
            const perSpeciesCount = new Map();
            let stored = 0;

            const listDirs = fs.readdirSync(IMAGES_DIR, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort();

            for (const speciesList of listDirs) {
                const listDir = path.join(IMAGES_DIR, speciesList);

                // Sorted so which picture becomes the default is the same on
                // every machine, rather than whatever order the filesystem
                // happens to return.
                const files = fs.readdirSync(listDir).sort();

                for (const file of files) {
                    const extension = path.extname(file).toLowerCase();
                    const contentType = CONTENT_TYPES[extension];
                    if (!contentType) {
                        unparsable.push(`${speciesList}/${file} (unsupported type)`);
                        continue;
                    }

                    const taxserial = taxserialFromFilename(file);
                    if (taxserial === null) {
                        unparsable.push(`${speciesList}/${file} (no taxserial in the name)`);
                        continue;
                    }

                    const speciesId = speciesIdByKey.get(`${speciesList} ${taxserial}`);
                    if (!speciesId) {
                        unmatched.push(`${speciesList}/${file} (no ${speciesList} entry with taxserial ${taxserial})`);
                        continue;
                    }

                    const ordinal = (perSpeciesCount.get(speciesId) || 0) + 1;
                    perSpeciesCount.set(speciesId, ordinal);

                    const storedName = `${speciesId}-${ordinal}${extension}`;
                    const source = path.join(listDir, file);
                    fs.copyFileSync(source, path.join(STORAGE_DIR, storedName));
                    const byteSize = fs.statSync(source).size;

                    // The first picture for a species becomes its default. The
                    // GUI effectively picked one at random; this makes the
                    // choice recorded and repeatable.
                    await sequelize.query(
                        `INSERT INTO species_pictures
                           (species_id, filename, original_name, content_type, byte_size, is_default, created_at, updated_at)
                         VALUES (:speciesId, :filename, :originalName, :contentType, :byteSize, :isDefault, NOW(), NOW())
                         ON CONFLICT (species_id, filename) DO UPDATE
                           SET original_name = EXCLUDED.original_name,
                               content_type  = EXCLUDED.content_type,
                               byte_size     = EXCLUDED.byte_size,
                               updated_at    = NOW()`,
                        {
                            replacements: {
                                speciesId,
                                filename: storedName,
                                originalName: file,
                                contentType,
                                byteSize,
                                isDefault: ordinal === 1,
                            },
                            transaction,
                        }
                    );

                    stored += 1;
                }
            }

            const withSeveral = [...perSpeciesCount.values()].filter((count) => count > 1).length;

            console.log(
                `[species pictures] ${stored} pictures stored for ${perSpeciesCount.size} species `
                + `(${withSeveral} with more than one); ${unmatched.length} unmatched, `
                + `${unparsable.length} unusable`
            );
            for (const line of unparsable) {
                console.log(`[species pictures]   skipped ${line}`);
            }
            for (const line of unmatched) {
                console.log(`[species pictures]   unmatched ${line}`);
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes every picture row and the copied files.
     *
     * Safe to delete here, unlike the species rows: nothing references a
     * picture, and the originals are still checked in under `seed-data/`, so
     * this is genuinely reversible by running `up` again.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once rows and files are gone.
     */
    async down(queryInterface) {
        await queryInterface.sequelize.query('DELETE FROM species_pictures');

        if (fs.existsSync(STORAGE_DIR)) {
            fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
        }

        console.log('[species pictures] down: removed every picture row and the stored files');
    },
};
