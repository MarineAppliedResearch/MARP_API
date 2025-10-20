const datasetRepository  = require('../repository/dataset.repository');

class DatasetService {

    constructor() {}


     async getDatasets() {
            return await datasetRepository.getDatasets();
        }

    async getDatasetById(datasetID) {
            return await datasetRepository.getDatasetById(datasetID);
    }
    
    async createDataset(dataset){
        return await datasetRepository.createDataset(dataset);
    }

    async createDatasetObservation(dataset_observation){
        return await datasetRepository.createDatasetObservation(dataset_observation);
    }

    async bulkCreateDatasetObservations(dataset_observation){
        return await datasetRepository.bulkCreateDatasetObservations(dataset_observation);
    }

    async getMl_models() {
        return await datasetRepository.getMl_models();
    }

    async createModel(mlmodel){
        return await datasetRepository.createModel(mlmodel);
    }
    
    async updateModel(mlID, newData){
        return await datasetRepository.updateModel(mlID, newData);
    }

    async createTrainingRun(training_run){
        return await datasetRepository.createTrainingRun(training_run);
    }

    async updateTrainingRun(id, training_run){
        return await datasetRepository.updateTrainingRun(id, training_run);
    }   
    
    async createEpoch(epoch){
        return await datasetRepository.createEpoch(epoch);
    }

    async updateEpoch(id, epoch){
        return await datasetRepository.updateEpoch(id, epoch);
    }

    async createMetricsSummary(metrics_summary){
        return await datasetRepository.createMetricsSummary(metrics_summary);
    }

    async createMetricsCurve(metrics_curve){
        return await datasetRepository.createMetricsCurve(metrics_curve);
    }    

    async bulkCreateMetricsCurves(req, res){
        return await datasetRepository.bulkCreateMetricsCurves(req.body);
    }

}

module.exports = new DatasetService();