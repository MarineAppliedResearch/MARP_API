/**
 * Service layer for species and model-species operations.
 *
 * Coordinates between the species controller and the species repository.
 * This layer currently passes most calls through directly; additional
 * business logic (validation, coordination across repositories, etc.)
 * should be added here rather than in the controller or repository.
 *
 * @fileoverview Species and model-species service operations.
 * @author Isaac Assegai Travers
 * @module service/species
 */

const speciesRepository  = require('../repository/species.repository');

/**
 * Coordinates species and model-species operations between the controller
 * and repository layers.
 *
 * @class SpeciesService
 */
class SpeciesService {

    constructor() {}

    /**
     * Fetch every species record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All species records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getSpecies() {
        return await speciesRepository.getSpecies();
    }

    /**
     * Fetch a single species record by common name.
     *
     * @async
     * @param {Object} req - Express request; `req.params.comname` supplies the common name to match, case-insensitively.
     * @param {Object} res - Accepted for signature consistency with the repository; not used by this implementation.
     * @returns {Promise<Object|null>} The matching species record, or null
     * if not found or the underlying query fails.
     */
    async getSpeciesByComname(req, res){
        return await speciesRepository.getSpeciesByComname(req, res);
    }

    /**
     * Fetch a single species record by its id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to fetch.
     * @returns {Promise<Object|null>} The matching species record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getSpeciesById(speciesId) {
        return await speciesRepository.getSpeciesById(speciesId);
    }

    /**
     * Create a new species record.
     *
     * @async
     * @param {Object} species - Species fields to insert (taxserial, comname, species, observation_type, etc.).
     * @returns {Promise<Object>} The created species record. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async createSpecies(species) {
        return await speciesRepository.createSpecies(species);
    }

    /**
     * Update an existing species record by id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to update.
     * @param {Object} newData - Species fields to update.
     * @returns {Promise<Object|null>} The updated species record, or null if
     * no row matched the given id. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateSpecies(speciesId, newData) {
        return await speciesRepository.updateSpecies(speciesId, newData);
    }

    /**
     * Delete a species record by id.
     *
     * @async
     * @param {number|string} speciesId - id of the species record to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteSpecies(speciesId) {
        return await speciesRepository.deleteSpecies(speciesId);
    }

    /**
     * Create a new model_species linkage record.
     *
     * @async
     * @param {Object} req - Express request; `req.body` supplies the model_species fields to insert directly.
     * @param {Object} res - Accepted for signature consistency with the controller; not used by this implementation.
     * @returns {Promise<Object>} The created model_species record.
     * Rejects on a database failure rather than resolving to an ad-hoc
     * error object.
     */
    async createModelSpecies(req, res){
        return await speciesRepository.createModelSpecies(req.body);
    }

    /**
     * Fetch a single model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to fetch.
     * @returns {Promise<Object|null>} The matching model_species record, or
     * null if not found. Rejects on a database failure rather than
     * resolving to a fallback value.
     */
    async getModelSpeciesById(id) {
        return await speciesRepository.getModelSpeciesById(id);
    }

    /**
     * Update an existing model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to update.
     * @param {Object} newData - model_species fields to update.
     * @returns {Promise<Object|null>} The updated model_species record, or
     * null if no row matched the given ID. Rejects on a database failure
     * rather than resolving to an error value.
     */
    async updateModelSpecies(id, newData) {
        return await speciesRepository.updateModelSpecies(id, newData);
    }

    /**
     * Delete a model_species join record by ID.
     *
     * @async
     * @param {number|string} id - ID of the model_species record to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteModelSpecies(id) {
        return await speciesRepository.deleteModelSpecies(id);
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
        return await speciesRepository.getSpeciesLists();
    }

    /**
     * Fetch every entry on one list, in display order, with its pictures.
     *
     * @async
     * @param {string} speciesList - List name, e.g. 'Fish'.
     * @returns {Promise<Array<Object>>} Entries in display order; empty array when the list does not exist.
     */
    async getSpeciesByList(speciesList) {
        return await speciesRepository.getSpeciesByList(speciesList);
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
        return await speciesRepository.searchSpeciesInList(speciesList, query);
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
        return await speciesRepository.getSpeciesByListAndTaxserial(speciesList, taxserial);
    }

    /**
     * Fetch the pictures recorded for one species, default first.
     *
     * @async
     * @param {number|string} speciesId - `species.id` to fetch pictures for.
     * @returns {Promise<Array<Object>>} Picture records, the default first.
     */
    async getPicturesForSpecies(speciesId) {
        return await speciesRepository.getPicturesForSpecies(speciesId);
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
        return await speciesRepository.getPictureById(pictureId);
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
        return await speciesRepository.createPicture(details);
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
        return await speciesRepository.setDefaultPicture(pictureId);
    }

    /**
     * Delete one picture record, promoting another default if needed.
     *
     * @async
     * @param {number|string} pictureId - `species_pictures.id` to delete.
     * @returns {Promise<Object|null>} The deleted picture, including its
     * `filename` so the caller can remove the file, or null if not found.
     * @throws {Error} If the delete fails.
     */
    async deletePicture(pictureId) {
        return await speciesRepository.deletePicture(pictureId);
    }

}

module.exports = new SpeciesService();