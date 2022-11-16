const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class UserRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        /*
        this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });
        */
    }

    
    async getUsers() {
        
        try {
            const users = await this.db.users.findAll();
            console.log('users:::', users);
            return users;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async getUserByName(userName) {
        
        try {
            const users = await this.db.users.findAll({
                where: {
                  name: userName
                }
              });
            console.log('users:::', users);
            return users;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async createUser(user) {
        let data = {};
        try {
            user.createdate = new Date().toISOString();
            data = await this.db.users.create(user);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    /**
     * Creates a new user given a username.
     * If the username is identical to an old one, it will return error.
     * @param {} userName 
     */
    async createUserByName(userName){
        let data = {};
        let user =  {
                "name": userName
             }
        
        try{
            user.createdate = new Date().toISOString();
            data = await this.db.users.create(user);
        }catch(err){
            logger.error('Error::' + err);
        }

        return data;
    }

    async updateUsers(user) {
        let data = {};
        try {
            user.updateddate = new Date().toISOString();
            data = await this.db.users.update({...user}, {
                where: {
                    id: user.id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    async deleteUser(userId) {
        let data = {};
        try {
            data = await this.db.users.destroy({
                where: {
                    id: userId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

}

module.exports = new UserRepository();