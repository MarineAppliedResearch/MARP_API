const observationRepository  = require('../repository/observation.repository');

class ObservationService {

    constructor() {}

    async getObservations() {
        return await observationRepository.getObservations();
    }

    async getLastVideoInfo(session_id){
        return await observationRepository.getLastVideoInfo(session_id);    
    }

    async getMaxObservationFromVideo(video_source){
            return await observationRepository.getMaxObservationFromVideo(video_source);
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

    async getObservationsByVideo(videoName){
        return await observationRepository.getObservationsByVideo(videoName);
    }


    async getVideoSummariesByProject(project_id){
        return await observationRepository.getVideoSummariesByProject(project_id);
    }

    /**
     * Returns all observations associated with video videoName that have a comname in comnameList
     * @param {string} req.query.videoName - The name of the video
     * @param {string[]} req.query.comnameList - An array of comname strings to filter observations
     */
    async getObservationsByVideoAndComnames(videoName, comnameList){
        return await observationRepository.getObservationsByVideoAndComnames(videoName, comnameList);
    }

    /**
     * Returns all observations associated with video videoName that have a comname in comnameList
     * @param {string} videoName - The name of the video
     * @param {string[]} projectName - An array of comname strings to filter observations
     */
    async getObservationsByVideoAndProject(videoName, projectName){
        return await observationRepository.getObservationsByVideoAndProject(videoName, projectName);
    }

    /**
     * Returns all observations that have associated keyframes and a comname in comnameList
     * @param {string[]} comnameList - An array of comname strings to filter observations
     */
    async getObservationsWithKeyframesByComnames(comnameList){
        return await observationRepository.getObservationsWithKeyframesByComnames(comnameList);
    }

    /**
     * Retrieves all distinct comnames from observations that have associated keyframes.
     * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
     */
    async getDistinctComnamesWithKeyframes(){
        return await observationRepository.getDistinctComnamesWithKeyframes();
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