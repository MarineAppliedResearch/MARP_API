/**
 * Repository module for species and model-species database operations.
 *
 * This file contains Sequelize queries used to retrieve species taxonomy
 * and GUI display records, and to create model-species linkage records
 * consumed by the machine-learning pipeline.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview Species and model-species database queries and persistence operations.
 * @author Isaac Assegai Travers
 * @module repository/species
 */


/**
 * Shared database registry containing the configured Sequelize connection,
 * initialized models, and model associations.
 *
 * @constant
 * @type {Object}
 */
const db = require('../model');


/**
 * Application logger used to record repository errors, warnings, and
 * diagnostic information.
 *
 * @constant
 * @type {Object}
 */
const logger = require('../logger/api.logger');


/**
 * Repository for species and model-species database operations.
 *
 * @class SpeciesRepository
 */
class SpeciesRepository {

    /**
     * Fields {@link SpeciesRepository#updateSpecies} is allowed to write.
     *
     * `id`, `species_list` and `taxserial` are absent deliberately: together the
     * last two identify an entry, and letting an ordinary edit change them means
     * an entry can silently move to another list, collide with the
     * `(species_list, taxserial)` unique constraint, or leave every observation
     * pointing at it describing something else. Moving an entry between lists is
     * a deliberate act, not a side effect of correcting a name.
     *
     * `itis_tsn` is absent for the same reason: it is derived from `taxserial`,
     * so allowing it to be set independently lets the two disagree.
     *
     * Same protection as `KeyframeRepository.UPDATABLE_FIELDS`, added for the
     * same reason (see MARE_API#42).
     *
     * @constant
     * @type {Array<string>}
     */
    static get UPDATABLE_FIELDS() {
        return [
            'comname', 'species', 'taxonomic_level', 'report_group',
            'observation_type', 'depth_min', 'depth_max', 'habitat_preference',
            'region', 'likelihood', 'max_size', 'record_max', 'notes',
            'gui_home_order', 'gui_maintab', 'gui_subtab',
            'gui_main_tab_order', 'gui_sub_tab_order', 'gui_item_order',
            'gui_display_name',
        ];
    }

    db = {};

    constructor() {
        this.db = db;
        // For Development

        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/

    }


    /**
     * Fetch every species record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero species and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All species records. Returns an
     * empty array when none exist or when the database query fails.
     */
    async getSpecies() {

        try {
            const species = await this.db.species.findAll();
            console.log('species:::', species);
            return species;
        } catch (err) {
            console.log(err);
            return [];
        }
    }


    /**
     * Fetch a single species record by its common name (case-insensitive).
     *
     * The comparison lowercases both the stored `comname` column and the
     * supplied value using SQL `LOWER()`, so callers do not need to
     * normalize case themselves.
     *
     * Database errors are logged and converted to `null`. As a result,
     * callers cannot distinguish between "no species matched" and "the
     * database query failed" from the return value alone.
     *
     * @async
     * @param {Object} req - Express request; `req.params.comname` supplies the common name to match.
     * @param {Object} res - Accepted for signature consistency with the calling service; not used by this implementation.
     * @returns {Promise<Object|null>} The matching species record, or null
     * if not found or the query fails.
     */
    async getSpeciesByComname(req, res) {
        try {
            const comname = req.params.comname;
            const species = await this.db.species.findOne({
            where: this.db.Sequelize.where(
                this.db.Sequelize.fn('LOWER', this.db.Sequelize.col('comname')),
                comname.toLowerCase()
            ),
            });

            return species;
        } catch (err) {
            console.error('Error in getSpeciesByComname:', err);
            return null;
        }
    }

    /**
     * Fetch a single species record by its id.
     *
     * Unlike most methods on this class, a database failure here is logged
     * and re-thrown rather than swallowed to a fallback value, so callers
     * must catch/handle a rejected promise. A "not found" result, by
     * contrast, resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to fetch.
     * @returns {Promise<Object|null>} The matching species record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getSpeciesById(speciesId) {
        try {
            const species = await this.db.species.findByPk(speciesId);
            return species || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Create a new species record.
     *
     * The caller is responsible for supplying a unique `taxserial` (see the
     * `species_taxserial_idx` unique index in model/species.model.js).
     *
     * @async
     * @param {Object} speciesData - Species fields to insert (taxserial, comname, species, observation_type, taxonomic_level, etc.).
     * @returns {Promise<Object>} The created species record. A database
     * failure is logged and re-thrown, so the returned promise rejects
     * rather than resolving to an error value.
     */
    async createSpecies(speciesData) {
        try {
            const species = await this.db.species.create(speciesData);
            return species;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Update an existing species record by id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to update.
     * @param {Object} newData - Species fields to update.
     * @returns {Promise<Object|null>} The updated species record, or null if
     * no row matched `speciesId`. A database failure is logged and
     * re-thrown, so the returned promise rejects rather than resolving to
     * an error value.
     */
    async updateSpecies(speciesId, newData) {
        try {
            const fields = {};
            for (const field of SpeciesRepository.UPDATABLE_FIELDS) {
                if (newData && newData[field] !== undefined) {
                    fields[field] = newData[field];
                }
            }

            // Nothing writable was supplied. Sequelize would issue an empty
            // UPDATE and report zero rows, which reads as "no such species"
            // and is a different problem to report.
            if (Object.keys(fields).length === 0) {
                return null;
            }

            const [rowsUpdated, [updatedSpecies]] = await this.db.species.update(
                fields,
                { where: { id: speciesId }, returning: true }
            );

            if (rowsUpdated === 0) {
                return null;
            }

            return updatedSpecies;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Delete a species record by id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteSpecies(speciesId) {
        try {
            const rowsDeleted = await this.db.species.destroy({ where: { id: speciesId } });
            return rowsDeleted;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Create a new model_species join record linking an ML model to a
     * species.
     *
     * The supplied record is inserted as-is; no validation is performed
     * here, so the caller is responsible for providing valid `model_id` and
     * `species_id` values.
     *
    * A database failure is logged and re-thrown, so callers can handle
    * errors via the API error contract middleware.
     *
     * @async
     * @param {Object} record - model_species fields to insert (model_id, species_id, dataset_size, balance_weight, precision_mean, recall_mean, f1_mean, notes).
     * @returns {Promise<Object>} The created model_species record.
     */
    async createModelSpecies(record) {
        try {
            const newRecord = await this.db.model_species.create(record);
            console.log('model_species record created:', newRecord.id);
            return newRecord;
        } catch (err) {
            console.error('Error in createModelSpecies:', err);
            throw err;
        }
    }

    /**
     * Fetch a single model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to fetch.
     * @returns {Promise<Object|null>} The matching model_species record, or
     * null if not found. A database failure is logged and re-thrown, so
     * the returned promise rejects rather than resolving to a fallback
     * value.
     */
    async getModelSpeciesById(id) {
        try {
            const record = await this.db.model_species.findByPk(id);
            return record || null;
        } catch (err) {
            console.error(`Error in getModelSpeciesById(${id}):`, err);
            throw err;
        }
    }

    /**
     * Update an existing model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to update.
     * @param {Object} newData - model_species fields to update.
     * @returns {Promise<Object|null>} The updated model_species record, or
     * null if no row matched `id`. A database failure is logged and
     * re-thrown, so the returned promise rejects rather than resolving to
     * an error value.
     */
    async updateModelSpecies(id, newData) {
        try {
            const [rowsUpdated, [updatedRecord]] = await this.db.model_species.update(
                newData,
                { where: { id }, returning: true }
            );

            if (rowsUpdated === 0) {
                return null;
            }

            return updatedRecord;
        } catch (err) {
            console.error(`Error in updateModelSpecies(${id}):`, err);
            throw err;
        }
    }

    /**
     * Delete a model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteModelSpecies(id) {
        try {
            const rowsDeleted = await this.db.model_species.destroy({ where: { id } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteModelSpecies(${id}):`, err);
            throw err;
        }
    }

    // -----------------------------------------------------------------
    // Annotation lists
    //
    // A species is identified by its list plus its taxserial, not by
    // taxserial alone: values below 10000 are local codes invented per list
    // and reused across lists, so 59 taxserials appear on more than one.
    // Every query below is therefore scoped to a list.
    // -----------------------------------------------------------------

    /**
     * Ordering for a list, chosen so a client can build its tab tree straight
     * from the response.
     *
     * `gui_item_order` is a string, because one row can place a species in
     * several spots and then holds one slot per placement (`17_4`). Those sort
     * last within their group: their order is per-placement and only means
     * something once the client splits them, which is the GUI's job.
     *
     * @returns {Array} Sequelize `order` clause.
     */
    get LIST_ORDER() {
        const { literal } = this.db.Sequelize;
        return [
            literal('gui_maintab ASC NULLS LAST'),
            literal('gui_subtab ASC NULLS LAST'),
            literal("CASE WHEN gui_item_order ~ '^[0-9]+$' THEN gui_item_order::int END ASC NULLS LAST"),
            literal('gui_display_name ASC NULLS LAST'),
        ];
    }

    /**
     * Include clause attaching a species' pictures.
     *
     * @returns {Array<Object>} Sequelize `include` clause.
     */
    get PICTURES_INCLUDE() {
        return [{
            model: this.db.species_pictures,
            as: 'pictures',
            required: false,
            // width and height included deliberately: a picker lays out boxes
            // before any image has loaded, which is why they are stored at all.
            attributes: ['id', 'filename', 'content_type', 'byte_size', 'width', 'height', 'is_default'],
        }];
    }

    /**
     * Fetch the annotation lists, with how many entries each holds.
     *
     * Rows with no list are excluded. Those are historical records kept only
     * because machine-learning metrics reference them; they are not on any
     * current list and nothing should offer them for annotation.
     *
     * @async
     * @returns {Promise<Array<Object>>} `{ species_list, entry_count }`, list
     * name ascending. Empty array on failure.
     */
    async getSpeciesLists() {
        try {
            const { fn, col, Op } = this.db.Sequelize;
            const lists = await this.db.species.findAll({
                attributes: [
                    'species_list',
                    [fn('COUNT', col('id')), 'entry_count'],
                ],
                where: { species_list: { [Op.ne]: null } },
                group: ['species_list'],
                order: [['species_list', 'ASC']],
                raw: true,
            });

            // COUNT arrives as a string from postgres.
            return lists.map(list => ({
                species_list: list.species_list,
                entry_count: Number(list.entry_count),
            }));
        } catch (err) {
            logger.error('Error in getSpeciesLists:' + err);
            return [];
        }
    }

    /**
     * Fetch every entry on one list, in display order, with its pictures.
     *
     * @async
     * @param {string} speciesList - List name, e.g. 'Fish'.
     * @returns {Promise<Array<Object>>} Entries in display order. Empty array
     * when the list does not exist or the query fails.
     */
    async getSpeciesByList(speciesList) {
        try {
            return await this.db.species.findAll({
                where: { species_list: speciesList },
                include: this.PICTURES_INCLUDE,
                order: this.LIST_ORDER,
            });
        } catch (err) {
            logger.error('Error in getSpeciesByList(' + speciesList + '):' + err);
            return [];
        }
    }

    /**
     * Search one list by common name, scientific name or display name.
     *
     * Scoped to a list because a common name is not unique across all seven:
     * TSN 169237 is 'UI croaker' on Fish and 'Drum' on GULF_Fish.
     *
     * @async
     * @param {string} speciesList - List to search within.
     * @param {string} query - Substring to match, case-insensitive.
     * @returns {Promise<Array<Object>>} Matching entries in display order.
     * Empty array when nothing matches or the query fails.
     */
    async searchSpeciesInList(speciesList, query) {
        try {
            const { Op } = this.db.Sequelize;
            const pattern = '%' + query + '%';

            return await this.db.species.findAll({
                where: {
                    species_list: speciesList,
                    [Op.or]: [
                        { comname: { [Op.iLike]: pattern } },
                        { species: { [Op.iLike]: pattern } },
                        { gui_display_name: { [Op.iLike]: pattern } },
                    ],
                },
                include: this.PICTURES_INCLUDE,
                order: this.LIST_ORDER,
            });
        } catch (err) {
            logger.error('Error in searchSpeciesInList(' + speciesList + ', ' + query + '):' + err);
            return [];
        }
    }

    /**
     * Fetch one entry by its list and taxserial -- the pair that identifies it.
     *
     * @async
     * @param {string} speciesList - List the entry belongs to.
     * @param {number|string} taxserial - Taxserial within that list.
     * @returns {Promise<Object|null>} The entry with its pictures, or null when
     * no entry matches or the query fails.
     */
    async getSpeciesByListAndTaxserial(speciesList, taxserial) {
        try {
            return await this.db.species.findOne({
                where: { species_list: speciesList, taxserial },
                include: this.PICTURES_INCLUDE,
            });
        } catch (err) {
            logger.error('Error in getSpeciesByListAndTaxserial(' + speciesList + ', ' + taxserial + '):' + err);
            return null;
        }
    }

    /**
     * Fetch the pictures recorded for one species, default first.
     *
     * @async
     * @param {number|string} speciesId - `species.id` to fetch pictures for.
     * @returns {Promise<Array<Object>>} Picture records, the default first.
     * Empty array when the species has none or the query fails.
     */
    async getPicturesForSpecies(speciesId) {
        try {
            return await this.db.species_pictures.findAll({
                where: { species_id: speciesId },
                order: [['is_default', 'DESC'], ['id', 'ASC']],
            });
        } catch (err) {
            logger.error('Error in getPicturesForSpecies(' + speciesId + '):' + err);
            return [];
        }
    }

    /**
     * Fetch one picture record by id.
     *
     * Unlike most methods here a database failure is re-thrown rather than
     * swallowed, because the caller serves file bytes and has to tell "no such
     * picture" (404) apart from "the lookup failed" (500).
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id`.
     * @returns {Promise<Object|null>} The picture record, or null if not found.
     * @throws {Error} If the query itself fails.
     */
    async getPictureById(pictureId) {
        try {
            const picture = await this.db.species_pictures.findByPk(pictureId);
            return picture || null;
        } catch (err) {
            logger.error('Error in getPictureById(' + pictureId + '):' + err);
            throw err;
        }
    }

    /**
     * Record an uploaded picture for a species.
     *
     * Picks the stored filename itself, as `<species_id>-<n><extension>` with
     * the lowest `n` not already taken for that species. The caller cannot
     * choose it: a client-supplied name would let one upload overwrite another
     * species' file, and the original name is kept separately anyway.
     *
     * The first picture a species gets becomes its default, so a species with
     * pictures always has one.
     *
     * Returns the filename to write to; the caller owns the storage directory
     * and writes the bytes, which keeps this class free of filesystem concerns.
     * A caller that fails to write must delete the record, or the row will
     * outlive the file.
     *
     * @async
     * @param {Object} details
     * @param {number|string} details.speciesId - Species the picture belongs to.
     * @param {string} details.extension - File extension including the dot, lowercased.
     * @param {string} details.originalName - Filename as supplied by the client.
     * @param {string} details.contentType - MIME type to serve the file as.
     * @param {number} details.byteSize - Size of the file in bytes.
     * @param {number} details.width - Width in pixels, after resizing.
     * @param {number} details.height - Height in pixels, after resizing.
     * @param {number|null} [details.uploadedBy] - User who uploaded it, where known.
     * @returns {Promise<Object|null>} The created picture record, or null if no
     * species has that id.
     * @throws {Error} If the insert fails.
     */
    async createPicture(details) {
        const {
            speciesId, extension, originalName, contentType, byteSize,
            width, height, uploadedBy = null,
        } = details;

        const transaction = await this.db.sequelize.transaction();

        try {
            const species = await this.db.species.findByPk(speciesId, { transaction });

            if (!species) {
                await transaction.rollback();
                return null;
            }

            const existing = await this.db.species_pictures.findAll({
                where: { species_id: speciesId },
                attributes: ['filename'],
                transaction,
            });

            const taken = new Set(existing.map(picture => picture.filename));

            // Lowest free ordinal rather than count + 1, so deleting picture 1
            // of 2 and uploading again reuses 1 instead of colliding on 2.
            let ordinal = 1;
            while (taken.has(`${speciesId}-${ordinal}${extension}`)) {
                ordinal += 1;
            }

            const picture = await this.db.species_pictures.create({
                species_id: speciesId,
                filename: `${speciesId}-${ordinal}${extension}`,
                original_name: originalName,
                content_type: contentType,
                byte_size: byteSize,
                width,
                height,
                is_default: existing.length === 0,
                uploaded_by: uploadedBy,
            }, { transaction });

            await transaction.commit();

            return picture;
        } catch (err) {
            await transaction.rollback();
            logger.error('Error in createPicture(' + speciesId + '):' + err);
            throw err;
        }
    }

    /**
     * Make one picture the default for its species.
     *
     * Clears the species' existing default first, in one transaction, because a
     * partial unique index allows only one default per species and setting the
     * new one before clearing the old would collide.
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id` to promote.
     * @returns {Promise<Object|null>} The updated picture, or null if no picture
     * has that id.
     * @throws {Error} If the update fails, so the caller can answer 500.
     */
    async setDefaultPicture(pictureId) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const picture = await this.db.species_pictures.findByPk(pictureId, { transaction });

            if (!picture) {
                await transaction.rollback();
                return null;
            }

            await this.db.species_pictures.update(
                { is_default: false },
                { where: { species_id: picture.species_id, is_default: true }, transaction }
            );

            await picture.update({ is_default: true }, { transaction });
            await transaction.commit();

            return picture;
        } catch (err) {
            await transaction.rollback();
            logger.error('Error in setDefaultPicture(' + pictureId + '):' + err);
            throw err;
        }
    }

    /**
     * Delete one picture record, promoting another default if this was it.
     *
     * A species that still has pictures should always have one marked default,
     * otherwise "the" picture becomes ambiguous again -- which is the problem
     * this table was introduced to fix.
     *
     * Does not touch the file. The caller owns the storage directory and unlinks
     * using the returned `filename`, which keeps this class free of filesystem
     * concerns.
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id` to delete.
     * @returns {Promise<Object|null>} A plain object describing the deleted
     * picture (including its `filename`), or null if no picture has that id.
     * @throws {Error} If the delete fails.
     */
    async deletePicture(pictureId) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const picture = await this.db.species_pictures.findByPk(pictureId, { transaction });

            if (!picture) {
                await transaction.rollback();
                return null;
            }

            const deleted = picture.get({ plain: true });
            await picture.destroy({ transaction });

            if (deleted.is_default) {
                const replacement = await this.db.species_pictures.findOne({
                    where: { species_id: deleted.species_id },
                    order: [['id', 'ASC']],
                    transaction,
                });

                if (replacement) {
                    await replacement.update({ is_default: true }, { transaction });
                }
            }

            await transaction.commit();

            return deleted;
        } catch (err) {
            await transaction.rollback();
            logger.error('Error in deletePicture(' + pictureId + '):' + err);
            throw err;
        }
    }

}

module.exports = new SpeciesRepository();