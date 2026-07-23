/**
 * Repository module for user database operations.
 *
 * This file contains Sequelize queries used to retrieve, create, update,
 * and delete user records.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview User database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/user
 */

const db = require('../model');
const logger = require('../logger/api.logger');


/**
 * Repository for user database operations.
 *
 * @class UserRepository
 */
class UserRepository {

    db = {};

    constructor() {
        this.db = db;
        // For Development

        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/

    }

    /**
     * Fetch every user record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero users and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All user records. Returns an empty
     * array when none exist or when the database query fails.
     */
    async getUsers() {

        try {
            const users = await this.db.users.findAll();
            console.log('users:::', users);
            return users;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch user record(s) matching an exact display name.
     *
     * Unlike species.repository.js#getSpeciesByComname, the comparison here
     * is an exact-match `WHERE name = ...` (no `LOWER()` normalization), so
     * lookups are case-sensitive.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between "no user matched" and "the
     * database query failed" from the return value alone.
     *
     * @async
     * @param {string} userName - Exact display name to match.
     * @returns {Promise<Array<Object>>} Matching user records. Returns an
     * empty array when none match or when the database query fails.
     */
    async getUserByName(userName) {

        try {
            const users = await this.db.users.findAll({
                where: {
                  name: userName
                }
              });
            console.log('users:::', users);
            return users;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Insert a new user record.
     *
     * Stamps the supplied object with a `createdate` field before
     * insertion. Note that `createdate` is not declared as a column on the
     * Users model (model/user.model.js only declares `user_id` and `name`,
     * with `timestamps: true` managing `createdAt`/`updatedAt`
     * automatically), so Sequelize silently ignores this field — it is not
     * actually persisted.
     *
     * Database errors are logged and swallowed: on failure this resolves to
     * the initial empty object (`{}`) rather than rejecting, so callers
     * cannot distinguish a failed insert from one that legitimately
     * returned no data without inspecting the result's fields.
     *
     * @async
     * @param {Object} user - Fields for the new user record; only `name` corresponds to a persisted column.
     * @returns {Promise<Object>} The created user record, or `{}` if the
     * insert failed.
     */
    async createUser(user) {
        let data = {};
        try {
            user.createdate = new Date().toISOString();
            data = await this.db.users.create(user);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Creates a new user given a username.
     * If the username is identical to an old one, it will return error.
     *
     * Database errors — including a unique-constraint violation on a
     * duplicate `name` (see `users_name_key` in model/user.model.js) — are
     * logged and swallowed: on failure this resolves to the initial empty
     * object (`{}`) rather than rejecting, so the "will return error"
     * behavior described above is not an actual thrown error or `{ error }`
     * payload; callers must infer failure from an empty/incomplete result.
     * As with {@link UserRepository#createUser}, the `createdate` field set
     * here is not a declared column and is silently dropped by Sequelize.
     *
     * @async
     * @param {string} userName - Name to assign to the new user record.
     * @returns {Promise<Object>} The created user record, or `{}` if the
     * insert failed (e.g. the name already exists).
     */
    async createUserByName(userName){
        let data = {};
        let user =  {
                "name": userName
             }

        try{
            user.createdate = new Date().toISOString();
            data = await this.db.users.create(user);
        }catch(err){
            logger.error('Error::' + err);
        }

        return data;
    }

    /**
     * Update an existing user record identified by `user.user_id`.
     *
     * Stamps the supplied object with an `updateddate` field before
     * writing; like `createdate` in {@link UserRepository#createUser}, this
     * field is not declared on the Users model, so Sequelize silently
     * ignores it and it is not actually persisted.
     *
     * Database errors are logged and swallowed: on failure this resolves to
     * the initial empty object (`{}`) rather than rejecting.
     *
     * @async
     * @param {Object} user - Fields to update; `user.user_id` selects the row via the WHERE clause and the remaining fields (plus the ignored `updateddate`) are passed to Sequelize's `update()`.
     * @returns {Promise<Object>} Sequelize's update result (typically `[affectedCount]`), or `{}` if the update failed.
     */
    async updateUsers(user) {
        let data = {};
        try {
            user.updateddate = new Date().toISOString();
            data = await this.db.users.update({...user}, {
                where: {
                    user_id: user.user_id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Delete a user record by `user_id`.
     *
     * Database errors are logged and swallowed: on failure this resolves to
     * the initial empty object (`{}`) rather than rejecting.
     *
     * NOTE: the final `return {status: ...}` statement below is unreachable
     * dead code (it follows an unconditional `return data;`) and, even if
     * reached, would be incorrect: `data` from
     * `this.db.users.destroy()` is a plain number (the deleted row count),
     * which has no `.deletedCount` property.
     *
     * @async
     * @param {string|number} userId - Identifier of the user to delete.
     * @returns {Promise<number|Object>} The number of rows deleted (from
     * Sequelize's `destroy()`), or `{}` if the delete failed.
     */
    async deleteUser(userId) {
        let data = {};
        try {
            data = await this.db.users.destroy({
                where: {
                    user_id: userId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

    /**
     * Fetch a single user record by id.
     *
     * Unlike most methods on this class, a database failure here is logged
     * and re-thrown rather than swallowed to a fallback value, so callers
     * must catch/handle a rejected promise. A "not found" result, by
     * contrast, resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} userId - ID of the user to fetch.
     * @returns {Promise<Object|null>} The matching user record, or null if
     * not found. Rejects if the underlying query fails.
     */
    async getUserById(userId) {
        try {
            const user = await this.db.users.findByPk(userId);
            return user || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Fetch a user's display name by id.
     *
     * Database errors are logged, but unlike the other methods in this
     * class the failure is not converted to a safe fallback: `userName`
     * remains its initial value (`''` on a DB error, or `null` if the query
     * succeeds but no row matches `user_id`), and the final
     * `userName.dataValues.name` access is outside the try/catch. In both
     * of those cases this throws (`Cannot read properties of undefined/null
     * ('dataValues')`), so the returned promise rejects instead of
     * resolving to a safe default.
     *
     * @async
     * @param {string|number} userID - Identifier of the user whose name should be returned.
     * @returns {Promise<string>} The user's name, only when a matching
     * record is found and the query succeeds; otherwise the promise
     * rejects (see above).
     */
    async getUserNameByID(userID){
        let userName = "";

        try{
            userName = await this.db.users.findOne({
                where: {
                  user_id: userID
                }
              });
        }catch(error){
            logger.error('Error::' + error);
        }

        return userName.dataValues.name;
    }

}

module.exports = new UserRepository();