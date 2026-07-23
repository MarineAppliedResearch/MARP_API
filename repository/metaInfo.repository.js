/**
 * Repository module for metaInfo database operations.
 *
 * This file contains Sequelize queries used to retrieve miscellaneous named
 * metadata records, such as the configured database display name.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview MetaInfo database queries.
 * @author Isaac Travers
 * @module repository/metaInfo
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
 * Repository for metaInfo database operations.
 *
 * @class MetaInfoRepository
 */
class MetaInfoRepository {

    db = {};

    constructor() {
        this.db = db;
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }


    /**
     * Fetch the configured database name metadata record.
     *
     * Reads all rows from the `metaInfo` table and uses the first row's
     * `name` column as the database name. If the table has no rows, a
     * placeholder `"NO DB Name Found"` name is returned instead (a
     * successful-but-empty result, not an error).
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers can tell "no metadata row exists" (a non-empty
     * placeholder array) apart from "the database query failed" (a true
     * empty array), but cannot otherwise distinguish query failure from
     * any other falsy outcome.
     *
     * @async
     * @returns {Promise<Array<Object>>} A single-element array containing
     * `{ name: <dbName> }` on success, `[{ name: "NO DB Name Found" }]`
     * when no rows exist, or an empty array when the database query
     * fails.
     */
    async getDBName() {

        try {
            const dbName = await this.db.metaInfo.findAll();
            var returnName = "";
            if(dbName.length >= 1){
                //returnName = dbName[0].name;
                returnName = [{"name": dbName[0].name}]
            }else{
                //there is no name returning.
                //returnName = "NO DB Name Found";
                returnName = [{"name": "NO DB Name Found"}]
            }

            console.log('dbName:::', dbName);
            return returnName;
        } catch (err) {
            console.log(err);
            return [];
        }
    }
}

module.exports = new MetaInfoRepository();