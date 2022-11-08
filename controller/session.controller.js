const sessionService  = require('../service/session.service');
const logger = require('../logger/api.logger');

class SessionController {

    async getSessions() {
        logger.info('Controller: getSessions')
        return await sessionService.getSessions();
    }

    async createSession(session) {
        logger.info('Controller: createSession', session);
        return await sessionService.createSession(session);
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