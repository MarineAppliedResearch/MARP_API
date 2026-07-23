/**
 * Repository module for task database operations.
 *
 * This file contains Sequelize queries used to retrieve, create, update,
 * and delete task records.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview Task database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/task
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
 * Repository for task database operations.
 *
 * @class TaskRepository
 */
class TaskRepository {

    db = {};

    constructor() {
        this.db = db;
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    /**
     * Fetch every task record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero tasks and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All task records. Returns an
     * empty array when none exist or when the database query fails.
     */
    async getTasks() {

        try {
            const tasks = await this.db.tasks.findAll();
            console.log('tasks:::', tasks);
            return tasks;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Create a new task record.
     *
     * Stamps `createdate` with the current timestamp before insert.
     *
     * Database errors are logged (not re-thrown) and `data` is left as the
     * empty object it was initialized to, so a failed insert resolves to
     * `{}` rather than throwing or returning a distinguishable error value.
     *
     * @async
     * @param {Object} task - Task fields to insert (name, description, createdby, etc.). Mutated in place to add `createdate`.
     * @returns {Promise<Object>} The created task record, or an empty
     * object if the insert failed.
     */
    async createTask(task) {
        let data = {};
        try {
            task.createdate = new Date().toISOString();
            data = await this.db.tasks.create(task);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Fetch a single task record by id.
     *
     * Unlike the other methods on this class, a database failure here is
     * logged and re-thrown rather than swallowed to `{}`, so callers must
     * catch/handle a rejected promise. A "not found" result, by contrast,
     * resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} taskId - ID of the task to fetch.
     * @returns {Promise<Object|null>} The matching task record, or null if
     * not found. Rejects if the underlying query fails.
     */
    async getTaskById(taskId) {
        try {
            const task = await this.db.tasks.findByPk(taskId);
            return task || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Update an existing task record.
     *
     * Stamps `updateddate` with the current timestamp before update.
     *
     * Database errors are logged (not re-thrown) and `data` is left as the
     * empty object it was initialized to, so a failed update resolves to
     * `{}` rather than throwing or returning a distinguishable error value.
     *
     * @async
     * @param {Object} task - Task fields to update, including the `id` of the record to modify. Mutated in place to add `updateddate`.
     * @returns {Promise<Object>} The Sequelize update result (an array
     * whose first element is the number of affected rows), or an empty
     * object if the update failed.
     */
    async updateTask(task) {
        let data = {};
        try {
            task.updateddate = new Date().toISOString();
            data = await this.db.tasks.update({...task}, {
                where: {
                    id: task.id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Delete a task record by id.
     *
     * Database errors are logged (not re-thrown) and `data` is left as the
     * empty object it was initialized to, so a failed delete resolves to
     * `{}` rather than throwing or returning a distinguishable error value.
     *
     * Note: the `return {status: ...}` statement below the initial
     * `return data;` is unreachable dead code, and it also references a
     * `data.deletedCount` property that Sequelize's `destroy()` never
     * produces (it resolves to a plain number of destroyed rows, not an
     * object with a `deletedCount` field). This method always returns
     * `data` (the destroy count, or `{}` on error).
     *
     * @async
     * @param {Object} taskId - Identifier of the task to delete.
     * @returns {Promise<Object>} The number of rows destroyed (as returned
     * by Sequelize), or an empty object if the delete failed.
     */
    async deleteTask(taskId) {
        let data = {};
        try {
            data = await this.db.tasks.destroy({
                where: {
                    id: taskId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

}

module.exports = new TaskRepository();