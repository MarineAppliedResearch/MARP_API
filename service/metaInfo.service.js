/**
 * Service layer for metaInfo operations.
 *
 * Coordinates between the metaInfo controller and the metaInfo repository.
 * This layer currently passes the call through directly; additional
 * business logic (validation, coordination across repositories, etc.)
 * should be added here rather than in the controller or repository.
 *
 * @fileoverview MetaInfo service operations.
 * @author Isaac Travers
 * @module service/metaInfo
 */

const metaInfoRepository  = require('../repository/metaInfo.repository');

/**
 * Coordinates metaInfo operations between the controller and repository
 * layers.
 *
 * @class MetaInfoService
 */
class MetaInfoService {

    constructor() {}

    /**
     * Fetch the configured database name metadata record.
     *
     * @async
     * @returns {Promise<Array<Object>>} A single-element array containing
     * `{ name: <dbName> }` on success, `[{ name: "NO DB Name Found" }]`
     * when the metaInfo table has no rows, or an empty array if the
     * underlying query fails.
     */
    async getDBName() {
        return await metaInfoRepository.getDBName();
    }
}

module.exports = new MetaInfoService();