const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class DatasetRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
        
    }

    
    async getDatasets() {
        
        try {
            const datasets = await this.db.datasets.findAll();
            console.log('datasets:::', datasets);
            return datasets;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async createDataset(datasetData) {
        /**
         * Creates a new dataset record in the database.
         * Mirrors the same structure and style as getDatasets().
         *
         * Parameters:
         *   datasetData (object) - dataset info, e.g.:
         *     {
         *       name: "FishTraining2025",
         *       location: "datasets/FishTraining2025",
         *       description: "Dataset built from 12 species",
         *       num_samples: 2000,
         *       num_classes: 12,
         *       source: "manual",
         *       notes: ""
         *     }
         *
         * Returns:
         *   (object) The created dataset record, or null on error.
         */
        try {
            const newDataset = await this.db.datasets.create(datasetData);
            console.log('Created dataset:', newDataset.toJSON());
            return newDataset;
        } catch (err) {
            console.error('Error in createDataset():', err);
            return null;
        }
    }


}

module.exports = new DatasetRepository();