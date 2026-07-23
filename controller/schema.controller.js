/**
 * Controller layer for schema introspection API endpoints.
 *
 * Delegates schema metadata requests to the service layer and logs each call.
 *
 * @fileoverview Schema introspection request delegation.
 * @author Isaac Travers
 * @module controller/schema
 */

const schemaService = require('../service/schema.service');
const logger = require('../logger/api.logger');

/**
 * Handles schema introspection HTTP request delegation.
 *
 * @class SchemaController
 */
class SchemaController {

    /**
     * Fetch metadata for every table in the public schema.
     *
     * @async
     * @returns {Promise<Array<Object>>} Table metadata list.
     */
    async getPublicTables() {
        logger.info('Controller: getPublicTables');
        return await schemaService.getPublicTables();
    }

    /**
     * Fetch metadata for every view in the public schema.
     *
     * @async
     * @returns {Promise<Array<Object>>} View metadata list.
     */
    async getPublicViews() {
        logger.info('Controller: getPublicViews');
        return await schemaService.getPublicViews();
    }

    /**
     * Fetch all foreign-key relationships in the public schema.
     *
     * @async
     * @returns {Promise<Array<Object>>} Relationship edge list.
     */
    async getPublicRelationships() {
        logger.info('Controller: getPublicRelationships');
        return await schemaService.getPublicRelationships();
    }
}

module.exports = new SchemaController();
