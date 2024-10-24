const observationRepository  = require('../repository/observation.repository');

class ObservationService {

    constructor() {}

    async getObservations() {
        return await observationRepository.getObservations();
    }

    async getLastVideoInfo(session_id){
        return await observationRepository.getLastVideoInfo(session_id);    
    }

    async updateObservationWithCount(session_id, obsID, count){
        return await observationRepository.updateObservationWithCount(session_id, obsID, count); 
    }

    async updateObservationWithSize(session_id, obsID, size){
        return await observationRepository.updateObservationWithSize(session_id, obsID, size); 
    }

    async getObservationsBySessionID(session_id) {
        return await observationRepository.getObservationsBySessionID(session_id);
    }

    async createObservation(observation) {
        return await observationRepository.createObservation(observation);
    }

    async updateObservation(observation) {
        return await observationRepository.updateObservation(observation);
    }

    async deleteObservation(observationId) {
        return await observationRepository.deleteObservation(observationId);
    }

    async getMaxPobsID(project_id, type) {
        return await observationRepository.getMaxPobsID(project_id, type);
    }

    async getUserDashboardData(startDate, endDate){
        return await observationRepository.getUserDashboardData(startDate, endDate);
    }

    async getObservationsGroupedByUserAndDate(){
        return await observationRepository.getObservationsGroupedByUserAndDate();
    }

    async getProjectTimeByDateAndUser(startDate, endDate){
        return await observationRepository.getProjectTimeByDateAndUser(startDate, endDate);
    }

}

module.exports = new ObservationService();