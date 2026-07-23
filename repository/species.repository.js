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


}

module.exports = new SpeciesRepository();