//This is the config for sequelize-cli, which performs migrations and seeding, but is not the config for the main api app. that is in db.config.js

module.exports = {
  "development": {
    "username": "mare_user",
    "password": "mare_user_pass",
    "database": "mare_development3",
    "host": "192.168.1.201",
    "dialect": "postgres"
  },
  "test": {
    "username": "mare_user",
    "password": "mare_user_pass",
    "database": "mare_development",
    "host": "192.168.1.201",
    "dialect": "postgres"
  },
  "production": {
    "username": "root",
    "password": null,
    "database": "database_production",
    "host": "127.0.0.1",
    "dialect": "postgres"
  }
}
