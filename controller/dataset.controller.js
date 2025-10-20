const datasetService  = require('../service/dataset.service');
const logger = require('../logger/api.logger');

class DatasetController {

    async getDatasets() {
        logger.info('Controller: getDatasets')
        return await datasetService.getDatasets();
    }

    async getDatasetById(datasetID) {
        logger.info('Controller: getDatasetById')
        return await datasetService.getDatasetById(datasetID);
    }

    

    async createDataset(dataset){
        logger.info('Controller: createDataset: ' + dataset)
        return await datasetService.createDataset(dataset);
    }

    async createDatasetObservation(dataset_observation){
        logger.info('Controller: createdataset_observation: ' + dataset_observation)
        return await datasetService.createDatasetObservation(dataset_observation);
    }

    async bulkCreateDatasetObservations(dataset_observation_array){
        logger.info('Controller: create dataset_observation_array: ')
        return await datasetService.bulkCreateDatasetObservations(dataset_observation_array);
    }

    async getMl_models() {
        logger.info('Controller: getMl_models')
        return await datasetService.getMl_models();
    }

    async createModel(mlmodel){
        logger.info('Controller: createModel: ')
        return await datasetService.createModel(mlmodel);
    }

    async updateModel(mlID, newData){
        logger.info('Controller: updateModel: ')
        return await datasetService.updateModel(mlID, newData);
    }


    async createTrainingRun(training_run){
        logger.info('Controller: createTrainingRun: ')
        return await datasetService.createTrainingRun(training_run);
    }

    async updateTrainingRun(id, training_run){
        logger.info('Controller: updateTrainingRun: ')
        return await datasetService.updateTrainingRun(id, training_run);
    }

    async createEpoch(epoch){
        logger.info('Controller: createEpoch: ')
        return await datasetService.createEpoch(epoch);
    }

    async updateEpoch(id, epoch){
        logger.info('Controller: updateEpoch: ')
        return await datasetService.updateEpoch(id, epoch);
    }


    async createMetricsSummary(metrics_summary){
        logger.info('Controller: createMetricsSummary: ')
        return await datasetService.createMetricsSummary(metrics_summary);
    }

    async createMetricsCurve(metrics_curve){
        logger.info('Controller: createMetricsCurve: ')
        return await datasetService.createMetricsCurve(metrics_curve);
    }

    async bulkCreateMetricsCurves(req, res){
        logger.info('Controller: bulkCreateMetricsCurves: ')
        return await datasetService.bulkCreateMetricsCurves(req, res);
    }

    

   




    
}
module.exports = new DatasetController();