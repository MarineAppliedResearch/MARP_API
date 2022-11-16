const userService  = require('../service/user.service');
const logger = require('../logger/api.logger');

class UserController {

    async getUsers() {
        logger.info('Controller: getUsers')
        return await userService.getUsers();
    }

    async getUserByName(userName){
        logger.info('Controller: getUserIDByName');
        return await userService.getUserByName(userName); 
    }

    async createUser(user) {
        logger.info('Controller: createUser', user);
        return await userService.createUser(user);
    }

    async createUserByName(userName){
        logger.info('Controller: createUserByName', userName);
        return await userService.createUserByName(userName);
    }

    async updateUser(user) {
        logger.info('Controller: updateUser', user);
        return await userService.updateUser(user);
    }

    async deleteUser(user_id) {
        logger.info('Controller: deleteUser', user_id);
        return await userService.deleteUser(user_id);
    }
}
module.exports = new UserController();