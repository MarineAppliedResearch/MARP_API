const observationRepository  = require('../repository/observation.repository');

class ObservationService {

    constructor() {}

    async getObservations() {
        return await observationRepository.getObservations();
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

}

module.exports = new ObservationService();