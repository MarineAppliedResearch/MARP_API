const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class ProjectRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    async getProjects() {
        
        try {
            const projects = await this.db.projects.findAll();
            console.log('projects:::', projects);
            return projects;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

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
                        where: {id: userID}
                       }] 
                 }]
              });
            console.log('projects:::', projects);
            return projects;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Returns a project based on its name.
     * @param {*} projectName 
     * @returns 
     */
    async getProjectByName(projectName){
        try {

            // First we need to get a list of 

            // Join Project to session, and session to user
            const projects = await this.db.projects.findAll({
                where: {name: projectName}
              });
            console.log('projects:::', projects);
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
     * @param {*} projectName 
     * @returns 
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

    async updateProject(project) {
        let data = {};
        try {
            project.updateddate = new Date().toISOString();
            data = await this.db.projects.update({...project}, {
                where: {
                    id: project.id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    async deleteProject(projectId) {
        let data = {};
        try {
            data = await this.db.projects.destroy({
                where: {
                    id: projectId
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