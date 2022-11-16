const sessionRepository  = require('../repository/session.repository');

class SessionService {

    constructor() {}

    async getSessions() {
        return await sessionRepository.getSessions();
    }

    async getSessionsByUserIdAndProjectId(userID, projectID) {
        return await sessionRepository.getSessionsByUserIdAndProjectId(userID, projectID);
    }

    async createSession(session) {
        return await sessionRepository.createSession(session);
    }

    async createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type){
        return await sessionRepository.createSessionAndProjectandProcessor(processorName, projectName, line, dive, lineID, type);
    }

    async updateSession(session) {
        return await sessionRepository.updateSession(session);
    }

    async deleteSession(sessionId) {
        return await sessionRepository.deleteSession(sessionId);
    }

}


module.exports = new SessionService();