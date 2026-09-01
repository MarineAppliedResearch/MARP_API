/**
 * Controller layer for species and model-species API endpoints.
 *
 * Delegates incoming requests to the species service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview Species and model-species request delegation.
 * @author Isaac Assegai Travers
 * @module controller/species
 */

const speciesService  = require('../service/species.service');
const logger = require('../logger/api.logger');

/**
 * Handles species and model-species HTTP request delegation.
 *
 * @class SpeciesController
 */
class SpeciesController {

    /**
     * Fetch every species record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All species records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getSpecies() {
        logger.info('Controller: getSpecies')
        return await speciesService.getSpecies();
    }

    /**
     * Fetch a single species record by common name.
     *
     * @async
     * @param {Object} req - Express request; `req.params.comname` supplies the common name to match, case-insensitively.
     * @param {Object} res - Accepted for signature consistency with the service; not used by this implementation.
     * @returns {Promise<Object|null>} The matching species record, or null
     * if not found or the underlying query fails.
     */
    async getSpeciesByComname(req, res){
        logger.info('Controller: getSpeciesByComname')
        return await speciesService.getSpeciesByComname(req, res);
    }

    /**
     * Fetch a single species record by its id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to fetch, taken from `req.params.id` by the caller in app.js.
     * @returns {Promise<Object|null>} The matching species record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getSpeciesById(speciesId) {
        logger.info('Controller: getSpeciesById', speciesId);
        return await speciesService.getSpeciesById(speciesId);
    }

    /**
     * Create a new species record.
     *
     * @async
     * @param {Object} species - Species fields to insert (taxserial, comname, species, observation_type, etc.), taken from `req.body.species` by the caller in app.js.
     * @returns {Promise<Object>} The created species record. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async createSpecies(species) {
        logger.info('Controller: createSpecies', species);
        return await speciesService.createSpecies(species);
    }

    /**
     * Update an existing species record by id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to update, taken from `req.params.id` by the caller in app.js.
     * @param {Object} newData - Species fields to update, taken from `req.body.species` by the caller in app.js.
     * @returns {Promise<Object|null>} The updated species record, or null if
     * no row matched the given id. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateSpecies(speciesId, newData) {
        logger.info('Controller: updateSpecies', speciesId);
        return await speciesService.updateSpecies(speciesId, newData);
    }

    /**
     * Delete a species record by id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to delete, taken from `req.params.id` by the caller in app.js.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteSpecies(speciesId) {
        logger.info('Controller: deleteSpecies', speciesId);
        return await speciesService.deleteSpecies(speciesId);
    }

    /**
     * Create a new model_species linkage record.
     *
     * @async
     * @param {Object} req - Express request; `req.body` supplies the model_species fields to insert directly (model_id, species_id, and related metrics).
     * @param {Object} res - Accepted for signature consistency with the service; not used by this implementation.
     * @returns {Promise<Object>} The created model_species record, or an
     * `{ error: string }` object if the insert failed. A failed insert
     * resolves rather than throwing, so callers must check for an `error`
     * property; the route in server.js does not set a non-200 status in
     * that case.
     */
    async createModelSpecies(req, res){
        logger.info('Controller: createModelSpecies')
        return await speciesService.createModelSpecies(req, res);
    }

    /**
     * Fetch a single model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to fetch, taken from `req.params.id` by the caller in app.js.
     * @returns {Promise<Object|null>} The matching model_species record, or
     * null if not found. Rejects on a database failure rather than
     * resolving to a fallback value.
     */
    async getModelSpeciesById(id) {
        logger.info('Controller: getModelSpeciesById', id);
        return await speciesService.getModelSpeciesById(id);
    }

    /**
     * Update an existing model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to update, taken from `req.params.id` by the caller in app.js.
     * @param {Object} newData - model_species fields to update, taken from `req.body.model_species` by the caller in app.js.
     * @returns {Promise<Object|null>} The updated model_species record, or
     * null if no row matched the given ID. Rejects on a database failure
     * rather than resolving to an error value.
     */
    async updateModelSpecies(id, newData) {
        logger.info('Controller: updateModelSpecies', id);
        return await speciesService.updateModelSpecies(id, newData);
    }

    /**
     * Delete a model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to delete, taken from `req.params.id` by the caller in app.js.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteModelSpecies(id) {
        logger.info('Controller: deleteModelSpecies', id);
        return await speciesService.deleteModelSpecies(id);
    }

    // -----------------------------------------------------------------
    // Annotation lists and species pictures
    // -----------------------------------------------------------------
    /**
     * Fetch the annotation lists, with how many entries each holds.
     *
     * @async
     * @returns {Promise<Array<Object>>} `{ species_list, entry_count }` per list, name ascending.
     */
    async getSpeciesLists() {
        logger.info('Controller: getSpeciesLists');
        return await speciesService.getSpeciesLists();
    }

    /**
     * Fetch every entry on one list, in display order, with its pictures.
     *
     * @async
     * @param {string} speciesList - List name, e.g. 'Fish'.
     * @returns {Promise<Array<Object>>} Entries in display order; empty array when the list does not exist.
     */
    async getSpeciesByList(speciesList) {
        logger.info('Controller: getSpeciesByList');
        return await speciesService.getSpeciesByList(speciesList);
    }

    /**
     * Search one list by common, scientific or display name.
     *
     * @async
     * @param {string} speciesList - List to search within.
     * @param {string} query - Substring to match, case-insensitive.
     * @returns {Promise<Array<Object>>} Matching entries in display order.
     */
    async searchSpeciesInList(speciesList, query) {
        logger.info('Controller: searchSpeciesInList');
        return await speciesService.searchSpeciesInList(speciesList, query);
    }

    /**
     * Fetch one entry by the list and taxserial pair that identifies it.
     *
     * @async
     * @param {string} speciesList - List the entry belongs to.
     * @param {number|string} taxserial - Taxserial within that list.
     * @returns {Promise<Object|null>} The entry with its pictures, or null when none matches.
     */
    async getSpeciesByListAndTaxserial(speciesList, taxserial) {
        logger.info('Controller: getSpeciesByListAndTaxserial');
        return await speciesService.getSpeciesByListAndTaxserial(speciesList, taxserial);
    }

    /**
     * Fetch the pictures recorded for one species, default first.
     *
     * @async
     * @param {number|string} speciesId - `species.id` to fetch pictures for.
     * @returns {Promise<Array<Object>>} Picture records, the default first.
     */
    async getPicturesForSpecies(speciesId) {
        logger.info('Controller: getPicturesForSpecies');
        return await speciesService.getPicturesForSpecies(speciesId);
    }

    /**
     * Fetch one picture record by id.
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id`.
     * @returns {Promise<Object|null>} The picture record, or null if not found.
     * @throws {Error} If the lookup itself fails, so a caller can answer 500 rather than 404.
     */
    async getPictureById(pictureId) {
        logger.info('Controller: getPictureById');
        return await speciesService.getPictureById(pictureId);
    }

    /**
     * Record an uploaded picture for a species.
     *
     * @async
     * @param {Object} details - See `SpeciesRepository#createPicture`.
     * @returns {Promise<Object|null>} The created picture, or null if no species
     * has that id.
     * @throws {Error} If the insert fails.
     */
    async createPicture(details) {
        logger.info('Controller: createPicture');
        return await speciesService.createPicture(details);
    }

    /**
     * Make one picture the default for its species.
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id` to promote.
     * @returns {Promise<Object|null>} The updated picture, or null if not found.
     * @throws {Error} If the update fails.
     */
    async setDefaultPicture(pictureId) {
        logger.info('Controller: setDefaultPicture');
        return await speciesService.setDefaultPicture(pictureId);
    }

    /**
     * Delete one picture record, promoting another default if needed.
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id` to delete.
     * @returns {Promise<Object|null>} The deleted picture, including its
     * `filename`, or null if not found.
     * @throws {Error} If the delete fails.
     */
    async deletePicture(pictureId) {
        logger.info('Controller: deletePicture');
        return await speciesService.deletePicture(pictureId);
    }

}
module.exports = new SpeciesController();