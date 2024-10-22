const sessionService  = require('../service/session.service');
const logger = require('../logger/api.logger');

class SessionController {

    async getSessions() {
        logger.info('Controller: getSessions');
        return await sessionService.getSessions();
    }

    async getProjectIDFromSessionID(session_id){
        logger.info('Controller: getProjectIDFromSessionID');
        return await sessionService.getProjectIDFromSessionID(session_id); 
    }

    async getTypeFromSessionID(session_id){
        logger.info('Controller: getTypeFromSessionID');
        return await sessionService.getTypeFromSessionID(session_id); 
    }

    async getTypeFromSessionID(session_id){
        logger.info('Controller: getTypeFromSessionID');
        return await sessionService.getTypeFromSessionID(session_id); 
    }

    async getSessionsByProjectID(project_id){
        logger.info('Controller: getSessionsByProjectID');
        return await sessionService.getSessionsByProjectID(project_id); 
    }

    async getSessionsByUserIdAndProjectId(userID, projectID) {
        logger.info('Controller: getSessionsByUserIdAndProjectId');
        return await sessionService.getSessionsByUserIdAndProjectId(userID, projectID);
    }

    async createSession(session) {
        logger.info('Controller: createSession', session);
        return await sessionService.createSession(session);
    }

    async createSessionAndProjectandProcessor( processorName, projectName, line, dive, lineID, type){
        logger.info('Controller: createSessionAndProjectandProcessor', processorName+":"+projectName+":"+line+":"+dive+":"+lineID+":"+type);
        return await sessionService.createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type);
    }

    async updateSession(session) {
        logger.info('Controller: updateSession', session);
        return await sessionService.updateSession(session);
    }

    async deleteSession(sessionId) {
        logger.info('Controller: deleteSession', sessionId);
        return await sessionService.deleteSession(sessionId);
    }

    async getSessionIDsWithProjectAndType(project_id, type){
        logger.info('Controller: getSessionIDsWithProjectAndType', project_id + ' ' + type);
        return await sessionService.getSessionIDsWithProjectAndType(project_id, type);
    }


    async getSessionsGroupedByUserAndDate(){
        logger.info('Controller: getSessionsGroupedByUserAndDate');
        return await sessionService.getSessionsGroupedByUserAndDate();
    }
}
module.exports = new SessionController();