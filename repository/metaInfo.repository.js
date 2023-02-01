const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class MetaInfoRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }


    async getDBName() {
        
        try {
            const dbName = await this.db.metaInfo.findAll();
            var returnName = "";
            if(dbName.length >= 1){
                //returnName = dbName[0].name;
                returnName = [{"name": dbName[0].name}]
            }else{
                //there is no name returning.
                //returnName = "NO DB Name Found";
                returnName = [{"name": "NO DB Name Found"}]
            }
            
            console.log('dbName:::', dbName);
            return returnName;
        } catch (err) {
            console.log(err);
            return [];
        }
    }
}

module.exports = new MetaInfoRepository();