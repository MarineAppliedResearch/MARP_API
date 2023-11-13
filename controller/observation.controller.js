const observationService  = require('../service/observation.service');
const logger = require('../logger/api.logger');

class ObservationController {

    async getObservations() {
        logger.info('Controller: getObservations');
        return await observationService.getObservations();
    }


    async getLastVideoInfo(session_id){
        logger.info('Controller: getLastVideoInfo');
        return await observationService.getLastVideoInfo(session_id);
    }

    async updateObservationWithCount(session_id, obsID, count){
        logger.info('Controller: updateObservationWithCount');
        return await observationService.updateObservationWithCount(session_id, obsID, count);
    }

    async updateObservationWithSize(session_id, obsID, size){
        logger.info('Controller: updateObservationWithSize');
        return await observationService.updateObservationWithSize(session_id, obsID, size);
    }

    async getObservationsBySessionID(session_id) {
        logger.info('Controller: getObservations');
        return await observationService.getObservationsBySessionID(session_id);
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

    async getMaxPobsID(project_id, type){
        logger.info('Controller: getMaxPobsID', project_id+' '+type);
        return await observationService.getMaxPobsID(project_id, type);
    }
}
module.exports = new ObservationController();