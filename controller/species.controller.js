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
}
module.exports = new SpeciesController();