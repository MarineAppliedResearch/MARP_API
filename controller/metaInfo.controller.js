/**
 * Controller layer for metaInfo API endpoints.
 *
 * Delegates incoming requests to the metaInfo service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview MetaInfo request delegation.
 * @author Isaac Travers
 * @module controller/metaInfo
 */

const metaInfoService  = require('../service/metaInfo.service');
const logger = require('../logger/api.logger');

/**
 * Handles metaInfo HTTP request delegation.
 *
 * @class MetaInfoController
 */
class MetaInfoController {

    /**
     * Fetch the configured database name metadata record.
     *
     * @async
     * @returns {Promise<Array<Object>>} A single-element array containing
     * `{ name: <dbName> }` on success, `[{ name: "NO DB Name Found" }]`
     * when the metaInfo table has no rows, or an empty array if the
     * underlying query fails. Callers can distinguish "no metadata row"
     * from "query failed" (a non-empty placeholder array vs. a true empty
     * array), but not "row exists with an empty name" from other cases.
     */
    async getDBName() {
        logger.info('Controller: getDBName');
        return await metaInfoService.getDBName();
    }
}
module.exports = new MetaInfoController();