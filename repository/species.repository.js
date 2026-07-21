const db = require('../model');
const logger = require('../logger/api.logger');


class SpeciesRepository {

    db = {};

    constructor() {
        this.db = db;
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


    /**
     * Fetch a single species record by its common name (case-insensitive).
     * Returns null if not found.
     */
    async getSpeciesByComname(req, res) {
        try {
            const comname = req.params.comname;
            const species = await this.db.species.findOne({
            where: this.db.Sequelize.where(
                this.db.Sequelize.fn('LOWER', this.db.Sequelize.col('comname')),
                comname.toLowerCase()
            ),
            });

            return species;
        } catch (err) {
            console.error('Error in getSpeciesByComname:', err);
            return null;
        }
    }

    /**
     * Creates a new model_species record.
     * @param {Object} record - Data to insert (model_id, species_id, etc.)
     */
    async createModelSpecies(record) {
        try {
            const newRecord = await this.db.model_species.create(record);
            console.log('model_species record created:', newRecord.id);
            return newRecord;
        } catch (err) {
            console.error('Error in createModelSpecies:', err);
            return { error: 'Database insert failed' };
        }
    }
    

}

module.exports = new SpeciesRepository();