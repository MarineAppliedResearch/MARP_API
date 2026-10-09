/**
 * Service layer for schema introspection endpoints.
 *
 * Keeps schema metadata orchestration out of controllers and delegates all
 * catalog-query logic to the repository layer.
 *
 * @fileoverview Schema introspection service operations.
 * @author Isaac Travers
 * @module service/schema
 */

const schemaRepository = require('../repository/schema.repository');

/**
 * Coordinates schema introspection operations between controller and repository.
 *
 * @class SchemaService
 */
class SchemaService {

    constructor() {}

    /**
     * Fetch metadata for all public tables.
     *
     * @async
     * @returns {Promise<Array<Object>>} Table metadata list.
     */
    async getPublicTables() {
        return await schemaRepository.getPublicTables();
    }

    /**
     * Fetch metadata for all public views and materialized views.
     *
     * @async
     * @returns {Promise<Array<Object>>} View metadata list.
     */
    async getPublicViews() {
        return await schemaRepository.getPublicViews();
    }

    /**
     * Fetch all public-schema foreign-key relationships.
     *
     * @async
     * @returns {Promise<Array<Object>>} Foreign-key relationship list.
     */
    async getPublicRelationships() {
        return await schemaRepository.getPublicRelationships();
    }
}

module.exports = new SchemaService();
