const sessionRepository  = require('../repository/session.repository');

class SessionService {

    constructor() {}

    async getSessions() {
        return await sessionRepository.getSessions();
    }

    async createSession(session) {
        return await sessionRepository.createSession(session);
    }

    async updateSession(session) {
        return await sessionRepository.updateSession(session);
    }

    async deleteSession(sessionId) {
        return await sessionRepository.deleteSession(sessionId);
    }

}


module.exports = new SessionService();