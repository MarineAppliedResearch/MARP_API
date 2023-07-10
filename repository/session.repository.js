const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');
const userController = require('../controller/user.controller'); 
const projectController = require('../controller/project.controller');
const observationController = require('../controller/observation.controller');



class SessionRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/


    }

    async getSessions() {
        
        try {
            const sessions = await this.db.sessions.findAll({ include: ["user"] });
            console.log('sessions:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async  getProjectIDFromSessionID(session_id){
        try {
            // Join Project to session
            const sessions = await this.db.sessions.findOne({
                 where: {
                    session_id: session_id
                }
              });
            console.log('sessionsWithProject:::', sessions);
            return sessions.project_id;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async getTypeFromSessionID(session_id){
        try {
            // Join Project to session
            const sessions = await this.db.sessions.findOne({
                 where: {
                    session_id: session_id
                }
              });
            console.log('sessionsWithProject:::', sessions);
            return sessions.type;
        } catch (err) {
            console.log(err);
            return [];
        }
    }


    async getSessionsByProjectID(project_id){
        try {
            // Join Project to session
            const sessions = await this.db.sessions.findAll({
                include: [{
                    model: this.db.projects, as: "project",
                    required: true
                 }],
                 where: {
                    project_id: project_id
                }
              });
            console.log('sessionsWithProject:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    // THIS LOOKS LIKE WE ARE NOT LOOKING FOR USERID AND PROJECTID LIKE WE ARE SUPPOSED TO
    async getSessionsByUserIdAndProjectId(userID, projectID) {
        
        try {

            // First we need to get a list of 

            // Join Project to session, and session to user
            const sessions = await this.db.sessions.findAll({
                include: [{
                    model: this.db.users, as: "user",
                    required: true
                 },{
                    model: this.db.projects, as: "project",
                    required: true
                 }],
                 where: {
                    user_id: userID,
                    project_id: projectID
                }
              });
            console.log('projects:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async createSession(session) {
        let data = {};
        try {
            session.createdate = new Date().toISOString();
            data = await this.db.sessions.create(session);
        } catch(err) {
            logger.error('Error::' + err);
            return err;
        }
        return data;
    }

    /** checks if we have a processor of processor Name returns processorID, if not create processor, and return it
     *  then checks if we have a project of projectName and returns projectID, if not create a project, and return it
     *  then checks if we have a session with this processorname, project name, line, dive, lineid and type.
     *  If not, create the session, always return the sessions id.
     * 
     *  Data Sceme    |Project|1/1 --------0/M|session|0/M ----- 1/1|user|
     */
    async createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type){
        let data = {};
        let user = {};
        let project = {};

        try {
            // Get this user by name, if it exists
            user = await userController.getUserByName(processorName);

            // check if the user exists, if it does not exist, create it
            if(user == undefined || user.length <= 0){
                // Create user here
                user = await userController.createUserByName(processorName);
            } 

            if(user.length >= 1) user = user[0];

            // Get this project by name, if it exists
            project = await projectController.getProjectByName(projectName);

            // Check if this project exists, if it doesn't, create it
            if(project.length <= 0){
                project = await projectController.createProjectByName(projectName);
            }

            if(project.length >= 1) project = project[0];

            let userID = -1;

            if(user[0] == undefined || user[0].user_id == undefined){
                userID = user.user_id;
            }else{
                userID = user[0].user_id;
            }

            let projectID = -1;

            if(project[0] == undefined || project[0].project_id == undefined){
                projectID = project.project_id;
            }else{
                projectID = project[0].project_id;
            }
            

            // Now we have all the info to build a session object. lets build one
            let session = {
                "user_id": userID,
                "project_id": projectID,
                "dive": dive,
                "line": line,
                "lineId": lineID,
                "type": type
              };

            // We'll try to find this session, if it exists in the db, we'll return that
            var currentSession = await this.db.sessions.findAll( {
                where: {
                    user_id: session.user_id,
                    project_id: session.project_id,
                    dive: session.dive,
                    line: session.line,
                    type: session.type
                }
            });

            // Check if our query has found an existing session.
            if(currentSession.length >= 1){
                // We have found a current session. unwrap it
                data = currentSession[0];
            }else{
                // We have not found a current session. create a new one.
                session.createdate = new Date().toISOString();
                data = await this.db.sessions.create(session);
            }

            
           
        } catch(err) {
            // If an error occurs, then user didn't exist.
            logger.error('Error::' + err);
            return err;
        }
        return data;
    }

    async updateSession(session) {
        let data = {};
        try {
            session.updateddate = new Date().toISOString();
            data = await this.db.sessions.update({...session}, {
                where: {
                    session_id: session.session_id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    async deleteSession(sessionId) {
        let data = {};
        try {
            data = await this.db.sessions.destroy({
                where: {
                    session_id: sessionId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

    async getSessionIDsWithProjectAndType(project_id, type){
        try {
            const session_ids = await this.db.sessions.findAll({
                 attributes: ['session_id'],
                 where: {
                    type: type,
                    project_id: project_id
                }
              });
            return session_ids;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

}

module.exports = new SessionRepository();