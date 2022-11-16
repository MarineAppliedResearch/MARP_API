const userRepository  = require('../repository/user.repository');

class UserService {

    constructor() {}

    async getUsers() {
        return await userRepository.getUsers();
    }

    async getUserByName(userName) {
        return await userRepository.getUserByName(userName);
    }

    async createUser(user) {
        return await userRepository.createUser(user);
    }

    async createUserByName(userName){
        return await userRepository.createUserByName(userName);
    }

    async updateUser(user) {
        return await userRepository.updateUser(user);
    }

    async deleteUser(userId) {
        return await userRepository.deleteUsers(userId);
    }

}

module.exports = new UserService();