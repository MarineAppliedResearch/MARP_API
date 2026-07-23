/**
 * Controller layer for task API endpoints.
 *
 * Delegates incoming requests to the task service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview Task request delegation.
 * @author Isaac Travers
 * @module controller/task
 */

const taskService  = require('../service/task.service');
const logger = require('../logger/api.logger');

/**
 * Handles task HTTP request delegation.
 *
 * @class TodoController
 */
class TodoController {

    /**
     * Fetch every task record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All task records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getTasks() {
        logger.info('Controller: getTasks')
        return await taskService.getTasks();
    }

    /**
     * Create a new task record.
     *
     * @async
     * @param {Object} task - Task fields to insert (name, description, createdby, etc.), taken from `req.body.task` by the caller in server.js.
     * @returns {Promise<Object>} The created task record, or an empty
     * object if the insert failed. A failed insert resolves rather than
     * throwing, so callers cannot distinguish success from failure by
     * catching an error.
     */
    async createTask(task) {
        logger.info('Controller: createTask', task);
        return await taskService.createTask(task);
    }

    /**
     * Update an existing task record.
     *
     * @async
     * @param {Object} task - Task fields to update, including the `id` of the record to modify, taken from `req.body.task` by the caller in server.js.
     * @returns {Promise<Object>} The Sequelize update result (typically an
     * affected-row count), or an empty object if the update failed. A
     * failed update resolves rather than throwing.
     */
    async updateTask(task) {
        logger.info('Controller: updateTask', task);
        return await taskService.updateTask(task);
    }

    /**
     * Delete a task record by id.
     *
     * @async
     * @param {Object} taskId - Identifier of the task to delete, taken from `req.params.id` by the caller in server.js.
     * @returns {Promise<Object>} The number of rows destroyed (as returned
     * by Sequelize), or an empty object if the delete failed. A failed
     * delete resolves rather than throwing.
     */
    async deleteTask(taskId) {
        logger.info('Controller: deleteTask', taskId);
        return await taskService.deleteTask(taskId);
    }
}
module.exports = new TodoController();