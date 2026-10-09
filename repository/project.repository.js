/**
 * Repository module for project database operations.
 *
 * This file contains Sequelize queries used to retrieve, create, update,
 * and delete project records, including project lookups scoped to a
 * particular user via the sessions/users associations.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * @fileoverview Project database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/project
 */

const db = require('../model');
const logger = require('../logger/api.logger');


/**
 * Repository for project database operations.
 *
 * @class ProjectRepository
 */
class ProjectRepository {

    db = {};

    constructor() {
        this.db = db;
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    /**
     * Fetch every project record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero projects and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All project records. Returns an
     * empty array when none exist or when the database query fails.
     */
    async getProjects() {

        try {
            const projects = await this.db.projects.findAll();
            //console.log('projects:::', projects);
            return projects;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Fetch every project that has at least one session belonging to a
     * given user.
     *
     * Joins `projects` to `sessions` (as `session`), and `sessions` to
     * `users` (as `user`), filtering on `user_id`. Both joins are
     * `required: true` (inner joins), so a project is only returned if it
     * has a session owned by the matching user.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between "user has no
     * sessions/projects" and "the database query failed" from the return
     * value alone.
     *
     * @async
     * @param {string|number} userID - Identifier of the user whose projects should be returned.
     * @returns {Promise<Array<Object>>} Matching project records. Returns
     * an empty array when none match or when the database query fails.
     */
    async getProjectsByUserID(userID) {

        try {

            // First we need to get a list of

            // Join Project to session, and session to user
            const projects = await this.db.projects.findAll({
                include: [{
                    model: this.db.sessions, as: "session",
                    required: true,
                    include: [{
                        model: this.db.users, as: "user",
                        required: true,
                        where: {user_id: userID}
                       }]
                 }]
              });
            //console.log('projects:::', projects);
            return projects;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Returns a project based on its name.
     *
     * Database errors are logged, but unlike most other methods in this
     * codebase the failure is NOT converted to `[]` or `null` — the caught
     * `err` object itself is returned. As a result, a failed query resolves
     * to an `Error` instance rather than an array, and callers that assume
     * an array (e.g. iterating or checking `.length`) will misbehave on
     * failure.
     *
     * @async
     * @param {*} projectName - Exact project name to match.
     * @returns {Promise<Array<Object>|Error>} Matching project record(s) as
     * an array (findAll), an empty array if none match, or the caught
     * `Error` object if the query fails.
     */
    async getProjectByName(projectName){
        try {

            // First we need to get a list of

            // Join Project to session, and session to user
            const projects = await this.db.projects.findAll({
                where: {name: projectName}
              });
            //console.log('projects:::', projects);
            return projects;
        } catch (err) {
            console.log(err);
            return err;
        }
    }

    /*

    {
        include: [
            {
            model: Team, 
                include: [
                    Folder
                ]  
            }
        ]
    }


    {
                include: [{
                  model: User,
                  where: {year_birth: 1984}
                 }]
              }

*/

    

    /**
     * Fetch a single project record by its project_id.
     *
     * Unlike most methods on this class, a database failure here is logged
     * and re-thrown rather than swallowed to a fallback value, so callers
     * must catch/handle a rejected promise. A "not found" result, by
     * contrast, resolves to `null` rather than throwing.
     *
     * @async
     * @param {number|string} projectId - project_id of the project to fetch.
     * @returns {Promise<Object|null>} The matching project record, or null
     * if not found. Rejects if the underlying query fails.
     */
    async getProjectById(projectId) {
        try {
            const project = await this.db.projects.findByPk(projectId);
            return project || null;
        } catch (err) {
            logger.error('Error::' + err);
            throw err;
        }
    }

    /**
     * Insert a new project record.
     *
     * Stamps the supplied object with a `createdate` field before
     * insertion. Note that `createdate` is not declared as a column on the
     * Projects model (model/project.model.js only declares `project_id`
     * and `name`, with `timestamps: true` managing `createdAt`/`updatedAt`
     * automatically), so Sequelize silently ignores this field — it is not
     * actually persisted.
     *
     * Database errors are logged and swallowed: on failure this resolves to
     * the initial empty object (`{}`) rather than rejecting, so callers
     * cannot distinguish a failed insert from one that legitimately
     * returned no data without inspecting the result's fields.
     *
     * @async
     * @param {Object} project - Fields for the new project record; only `name` corresponds to a persisted column.
     * @returns {Promise<Object>} The created project record, or `{}` if the
     * insert failed.
     */
    async createProject(project) {
        let data = {};
        try {
            project.createdate = new Date().toISOString();
            data = await this.db.projects.create(project);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Creates a new project given a name, will not create the project if it already exists.
     *
     * In practice "will not create if it already exists" is enforced
     * indirectly: there is no explicit existence check here, only the
     * unique constraint on `projects.name` (`projects_name_key`), whose
     * violation is caught below and swallowed. On failure this resolves to
     * the initial empty object (`{}`) rather than rejecting or surfacing an
     * error, so callers cannot tell "name already existed" apart from any
     * other insert failure. As with {@link ProjectRepository#createProject},
     * the `createdate` field set here is not a declared column and is
     * silently dropped by Sequelize.
     *
     * @async
     * @param {*} projectName - Name to assign to the new project record.
     * @returns {Promise<Object>} The created project record, or `{}` if the
     * insert failed (e.g. the name already exists).
     */
    async createProjectByName(projectName){
        let data = {};
        let project = {"name": projectName};

        try {
            project.createdate = new Date().toISOString();
            data = await this.db.projects.create(project);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Update an existing project record identified by `project.project_id`.
     *
     * Stamps the supplied object with an `updateddate` field before
     * writing; like `createdate` in {@link ProjectRepository#createProject},
     * this field is not declared on the Projects model, so Sequelize
     * silently ignores it and it is not actually persisted.
     *
     * Database errors are logged and swallowed: on failure this resolves to
     * the initial empty object (`{}`) rather than rejecting.
     *
     * @async
     * @param {Object} project - Fields to update; `project.project_id` selects the row via the WHERE clause and the remaining fields (plus the ignored `updateddate`) are passed to Sequelize's `update()`.
     * @returns {Promise<Object>} Sequelize's update result (typically `[affectedCount]`), or `{}` if the update failed.
     */
    async updateProject(project) {
        let data = {};
        try {
            project.updateddate = new Date().toISOString();
            data = await this.db.projects.update({...project}, {
                where: {
                    project_id: project.project_id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Delete a project record by `project_id`.
     *
     * Database errors are logged and swallowed: on failure this resolves to
     * the initial empty object (`{}`) rather than rejecting.
     *
     * NOTE: the final `return {status: ...}` statement below is unreachable
     * dead code (it follows an unconditional `return data;`) and, even if
     * reached, would be incorrect: `data` from
     * `this.db.projects.destroy()` is a plain number (the deleted row
     * count), which has no `.deletedCount` property. This mirrors the same
     * dead-code pattern in repository/user.repository.js#deleteUser.
     *
     * @async
     * @param {string|number} projectId - Identifier of the project to delete.
     * @returns {Promise<number|Object>} The number of rows deleted (from
     * Sequelize's `destroy()`), or `{}` if the delete failed.
     */
    async deleteProject(projectId) {
        let data = {};
        try {
            data = await this.db.projects.destroy({
                where: {
                    project_id: projectId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

}

module.exports = new ProjectRepository();