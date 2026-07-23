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
     * @returns {Promise<Object>} The created model_species record, or an
     * `{ error: string }` object if the insert failed. A failed insert
     * resolves rather than rejecting, so callers must check for an `error`
     * property.
     */
    async createModelSpecies(req, res){
        try {
            const data = await speciesRepository.createModelSpecies(req.body);
            return data; // response handled by .then() in route
        } catch (err) {
            console.error('Error creating model_species record:', err);
            return { error: 'Failed to create model_species record' };
        }
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

}

module.exports = new SpeciesService();