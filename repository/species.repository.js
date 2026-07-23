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
            const [rowsUpdated, [updatedSpecies]] = await this.db.species.update(
                newData,
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
     * Unlike most repository methods in this codebase, a failure here does
     * not resolve to an empty array or null — it resolves to an
     * `{ error: string }` object. Callers must check for that property
     * explicitly, and note that the API route built on this method
     * (`POST /api/model_species`) still responds with HTTP 200 in that
     * case.
     *
     * @async
     * @param {Object} record - model_species fields to insert (model_id, species_id, dataset_size, balance_weight, precision_mean, recall_mean, f1_mean, notes).
     * @returns {Promise<Object>} The created model_species record, or an
     * `{ error: string }` object if the insert failed.
     */
    async createModelSpecies(record) {
        try {
            const newRecord = await this.db.model_species.create(record);
            console.log('model_species record created:', newRecord.id);
            return newRecord;
        } catch (err) {
            console.error('Error in createModelSpecies:', err);
            return { error: 'Database insert failed' };
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

}

module.exports = new SpeciesRepository();