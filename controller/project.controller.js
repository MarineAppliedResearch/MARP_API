/**
 * Controller layer for project API endpoints.
 *
 * Delegates incoming requests to the project service and logs each call.
 * Controllers in this codebase should contain request delegation and
 * logging only; database access belongs in the repository and broader
 * business logic belongs in the service layer.
 *
 * @fileoverview Project request delegation.
 * @author Isaac Travers
 * @module controller/project
 */

const projectService  = require('../service/project.service');
const logger = require('../logger/api.logger');

/**
 * Handles project HTTP request delegation.
 *
 * @class ProjectController
 */
class ProjectController {

    /**
     * Fetch every project record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All project records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getProjects() {
        logger.info('Controller: getProjects')
        return await projectService.getProjects();
    }

    /**
     * Fetch every project that has at least one session belonging to a
     * given user.
     *
     * @async
     * @param {string|number} userID - Identifier of the user whose projects should be returned; the server.js route (`GET /api/projects/user/:userID`) supplies this from `req.params.userID`.
     * @returns {Promise<Array<Object>>} Matching project records (joined
     * through `sessions` to `users`). Resolves to an empty array when the
     * user has no sessions/projects or the underlying query fails.
     */
    async getProjectsByUserID(userID) {
        logger.info('Controller: getProjectsByUserID')
        return await projectService.getProjectsByUserID(userID);
    }

    /**
     * Fetch project record(s) by exact project name.
     *
     * @async
     * @param {string} projectName - Name of the project to look up; the server.js route (`GET /api/project/getProjectByName/:projectName`) supplies this from `req.params.projectName`. Note the log message below reads "getProjectsByName" (plural), which does not match this method's actual (singular) name.
     * @returns {Promise<Array<Object>|Error>} Matching project record(s).
     * Resolves to an empty array when no project has that name; CAUTION —
     * on a database failure the underlying repository call resolves with
     * the caught `Error` object itself rather than `[]` or `null`, so a
     * failure here can surface as a non-array value passed straight to
     * `res.json()` in server.js.
     */
    async getProjectByName(projectName){
        logger.info('Controller: getProjectsByName')
        return await projectService.getProjectByName(projectName);
    }

    /**
     * Create a new project record.
     *
     * @async
     * @param {Object} project - Fields for the new project record (see the Project schema); the server.js route (`POST /api/project`) supplies this from `req.body.project`.
     * @returns {Promise<Object>} The created project record, or `{}` if the
     * insert failed. A failed insert resolves rather than throwing, so
     * callers cannot distinguish failure from a genuinely empty result
     * without inspecting the returned object's fields.
     */
    async createProject(project) {
        logger.info('Controller: createProject', project);
        return await projectService.createProject(project);
    }

    /**
     * Create a new project record given only a name.
     *
     * @async
     * @param {string} projectName - Name to assign to the new project; the server.js route (`POST /api/project/createProjectByName/:projectName`) supplies this from `req.params.projectName`.
     * @returns {Promise<Object>} The created project record, or `{}` if the
     * insert failed (e.g. the name already exists and violates the unique
     * constraint on `projects.name`).
     */
    async createProjectByName(projectName){
        logger.info('Controller: createProjectByName', projectName);
        return await projectService.createProjectByName(projectName);
    }

    /**
     * Update an existing project record.
     *
     * @async
     * @param {Object} project - Fields to update, including `project_id` identifying which row to update; the server.js route (`PUT /api/project`) supplies this from `req.body.project`.
     * @returns {Promise<Object>} Sequelize's update result (typically
     * `[affectedCount]`), or `{}` if the update failed. A failed update
     * resolves rather than throwing.
     */
    async updateProject(project) {
        logger.info('Controller: updateProject', project);
        return await projectService.updateProject(project);
    }

    /**
     * Delete a project record by id.
     *
     * @async
     * @param {string|number} projectId - Identifier of the project to delete; the server.js route (`DELETE /api/project/:id`) supplies this from `req.params.id`.
     * @returns {Promise<number|Object>} The number of rows deleted, or `{}`
     * if the delete failed. A failed delete resolves rather than throwing.
     */
    async deleteProject(projectId) {
        logger.info('Controller: deleteProject', projectId);
        return await projectService.deleteProject(projectId);
    }
}
module.exports = new ProjectController();