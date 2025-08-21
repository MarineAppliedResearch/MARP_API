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

    async getObservationsByVideo(videoName){
        logger.info('Controller: getObservationsByVideo', videoName);
        return await observationService.getObservationsByVideo(videoName);
    }

    /**
     * Returns all observations associated with video videoName that have a comname in comnameList
     * @param {string} req.query.videoName - The name of the video
     * @param {string[]} req.query.comnameList - An array of comname strings to filter observations
     */
    async getObservationsByVideoAndComnames(videoName, comnameList){
        return await observationService.getObservationsByVideoAndComnames(videoName, comnameList);
    }

    /**
     * Returns all observations that have associated keyframes and a comname in comnameList
     * @param {string[]} comnameList - An array of comname strings to filter observations
     */
    async getObservationsWithKeyframesByComnames(comnameList){
        return await observationService.getObservationsWithKeyframesByComnames(comnameList);
    }

    /**
     * Retrieves all distinct comnames from observations that have associated keyframes.
     * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
     */
    async getDistinctComnamesWithKeyframes(){
        return await observationService.getDistinctComnamesWithKeyframes();
    }

    async getUserDashboardData(startDate, endDate){
        logger.info('Controller: getUserDashboardData');
        return await observationService.getUserDashboardData(startDate, endDate);
    }

    async getObservationsGroupedByUserAndDate(){
        logger.info('Controller: getObservationsGroupedByUserAndDate');
        return await observationService.getObservationsGroupedByUserAndDate();
    }

    async getProjectTimeByDateAndUser(startDate, endDate){
        logger.info('Controller: getProjectTimeByDateAndUser');
        return await observationService.getProjectTimeByDateAndUser(startDate, endDate);
    }
}
module.exports = new ObservationController();