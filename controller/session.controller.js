const sessionService  = require('../service/session.service');
const logger = require('../logger/api.logger');

class SessionController {

    async getSessions() {
        logger.info('Controller: getSessions')
        return await sessionService.getSessions();
    }

   

    async getSessionsByUserIdAndProjectId(userID, projectID) {
        logger.info('Controller: getSessionsByUserIdAndProjectId')
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
}
module.exports = new SessionController();