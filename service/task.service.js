/**
 * Service layer for task operations.
 *
 * Coordinates between the task controller and the task repository. This
 * layer currently passes all calls through directly; additional business
 * logic (validation, coordination across repositories, etc.) should be
 * added here rather than in the controller or repository.
 *
 * @fileoverview Task service operations.
 * @author Isaac Travers
 * @module service/task
 */

const taskRepository  = require('../repository/task.repository');

/**
 * Coordinates task operations between the controller and repository
 * layers.
 *
 * @class TaskService
 */
class TaskService {

    constructor() {}

    /**
     * Fetch every task record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All task records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getTasks() {
        return await taskRepository.getTasks();
    }

    /**
     * Create a new task record.
     *
     * @async
     * @param {Object} task - Task fields to insert (name, description, createdby, etc.).
     * @returns {Promise<Object>} The created task record, or an empty
     * object if the insert failed. A failed insert resolves rather than
     * throwing.
     */
    async createTask(task) {
        return await taskRepository.createTask(task);
    }

    /**
     * Fetch a single task record by id.
     *
     * @async
     * @param {number|string} taskId - ID of the task to fetch.
     * @returns {Promise<Object|null>} The matching task record, or null if
     * not found. Rejects if the underlying query fails.
     */
    async getTaskById(taskId) {
        return await taskRepository.getTaskById(taskId);
    }

    /**
     * Update an existing task record.
     *
     * @async
     * @param {Object} task - Task fields to update, including the `id` of the record to modify.
     * @returns {Promise<Object>} The Sequelize update result (typically an
     * affected-row count), or an empty object if the update failed. A
     * failed update resolves rather than throwing.
     */
    async updateTask(task) {
        return await taskRepository.updateTask(task);
    }

    /**
     * Delete a task record by id.
     *
     * @async
     * @param {Object} taskId - Identifier of the task to delete.
     * @returns {Promise<Object>} The number of rows destroyed (as returned
     * by Sequelize), or an empty object if the delete failed. A failed
     * delete resolves rather than throwing.
     */
    async deleteTask(taskId) {
        return await taskRepository.deleteTask(taskId);
    }

}

module.exports = new TaskService();