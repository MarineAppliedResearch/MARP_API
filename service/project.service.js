/**
 * Service layer for project operations.
 *
 * Coordinates between the project controller and the project repository.
 * This layer currently passes most calls through directly; additional
 * business logic (validation, coordination across repositories, etc.)
 * should be added here rather than in the controller or repository.
 *
 * @fileoverview Project service operations.
 * @author Isaac Travers
 * @module service/project
 */

const projectRepository  = require('../repository/project.repository');

/**
 * Coordinates project operations between the controller and repository
 * layers.
 *
 * @class ProjectService
 */
class ProjectService {

    constructor() {}

    /**
     * Fetch every project record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All project records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getProjects() {
        return await projectRepository.getProjects();
    }

    /**
     * Fetch every project that has at least one session belonging to a
     * given user.
     *
     * @async
     * @param {string|number} userID - Identifier of the user whose projects should be returned.
     * @returns {Promise<Array<Object>>} Matching project records. Resolves
     * to an empty array when the user has no sessions/projects or the
     * underlying query fails.
     */
    async getProjectsByUserID(userID) {
        return await projectRepository.getProjectsByUserID(userID);
    }

    /**
     * Fetch project record(s) by exact project name.
     *
     * @async
     * @param {string} projectName - Name of the project to look up.
     * @returns {Promise<Array<Object>|Error>} Matching project record(s).
     * Resolves to an empty array when no project has that name; CAUTION —
     * on a database failure the underlying repository call resolves with
     * the caught `Error` object itself rather than `[]` or `null`.
     */
    async getProjectByName(projectName){
        return await projectRepository.getProjectByName(projectName);
    }

    /**
     * Fetch a single project record by its project_id.
     *
     * @async
     * @param {number|string} projectId - project_id of the project to fetch.
     * @returns {Promise<Object|null>} The matching project record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getProjectById(projectId) {
        return await projectRepository.getProjectById(projectId);
    }

    /**
     * Create a new project record.
     *
     * @async
     * @param {Object} project - Fields for the new project record (see the Project schema).
     * @returns {Promise<Object>} The created project record, or `{}` if the
     * insert failed. A failed insert resolves rather than throwing.
     */
    async createProject(project) {
        return await projectRepository.createProject(project);
    }

    /**
     * Create a new project record given only a name.
     *
     * @async
     * @param {string} projectName - Name to assign to the new project.
     * @returns {Promise<Object>} The created project record, or `{}` if the
     * insert failed (e.g. the name already exists and violates the unique
     * constraint on `projects.name`).
     */
    async createProjectByName(projectName){
        return await projectRepository.createProjectByName(projectName);
    }

    /**
     * Update an existing project record.
     *
     * @async
     * @param {Object} project - Fields to update, including `project_id` identifying which row to update.
     * @returns {Promise<Object>} Sequelize's update result (typically
     * `[affectedCount]`), or `{}` if the update failed. A failed update
     * resolves rather than throwing.
     */
    async updateProject(project) {
        return await projectRepository.updateProject(project);
    }

    /**
     * Delete a project record by id.
     *
     * @async
     * @param {string|number} projectId - Identifier of the project to delete.
     * @returns {Promise<number|Object>} The number of rows deleted, or `{}`
     * if the delete failed. A failed delete resolves rather than throwing.
     */
    async deleteProject(projectId) {
        return await projectRepository.deleteProject(projectId);
    }

}

module.exports = new ProjectService();