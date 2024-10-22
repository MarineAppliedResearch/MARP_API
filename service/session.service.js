const sessionRepository  = require('../repository/session.repository');

class SessionService {

    constructor() {}

    async getSessions() {
        return await sessionRepository.getSessions();
    }

    async  getProjectIDFromSessionID(session_id){
        return await sessionRepository.getProjectIDFromSessionID(session_id); 
    }

    async getTypeFromSessionID(session_id){
        return await sessionRepository.getTypeFromSessionID(session_id);  
    }

    async getSessionsByProjectID(project_id){
        return await sessionRepository.getSessionsByProjectID(project_id);
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

    async getSessionIDsWithProjectAndType(project_id, type){
        return await sessionRepository.getSessionIDsWithProjectAndType(project_id, type);
    }

    async getSessionsGroupedByUserAndDate(startDate, endDate){
        return await sessionRepository.getSessionsGroupedByUserAndDate(startDate, endDate);
    }

}


module.exports = new SessionService();