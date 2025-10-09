const datasetService  = require('../service/dataset.service');
const logger = require('../logger/api.logger');

class DatasetController {

    async getDatasets() {
        logger.info('Controller: getDatasets')
        return await datasetService.getDatasets();
    }

    async createDataset(dataset){
        logger.info('Controller: createDataset: ' + dataset)
        return await datasetService.createDataset(dataset);
    }

    
}
module.exports = new DatasetController();