const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class SpeciesRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
        
    }

    
    async getSpecies() {
        
        try {
            const species = await this.db.species.findAll();
            console.log('species:::', species);
            return species;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

}

module.exports = new SpeciesRepository();