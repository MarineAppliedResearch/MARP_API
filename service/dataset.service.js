const datasetRepository  = require('../repository/dataset.repository');

class DatasetService {

    constructor() {}


     async getDatasets() {
            return await datasetRepository.getDatasets();
        }
    
    async createDataset(dataset){
        return await datasetRepository.createDataset(dataset);
    }

    

}

module.exports = new DatasetService();