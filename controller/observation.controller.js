const observationService  = require('../service/observation.service');
const logger = require('../logger/api.logger');

class ObservationController {

    async getObservations() {
        logger.info('Controller: getObservations')
        return await observationService.getObservations();
    }

    async createObservation(observation) {
        logger.info('Controller: createObservation', observation);
        return await observationService.createObservation(observation);
    }

    async updateObservation(observation) {
        logger.info('Controller: updateObservation', observation);
        return await observationService.updateObservation(observation);
    }

    async deleteObservation(observationId) {
        logger.info('Controller: deleteObservation', observationId);
        return await observationService.deleteObservation(observationId);
    }
}
module.exports = new ObservationController();