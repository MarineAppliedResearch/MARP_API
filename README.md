# MARE_API
MARE Data Access API

npm run dev

start with process manager: pm2 start server.js

Environmental Variables in Linux must be set to be the
same as the variables in .env, which works for the windows environment.


DB Migrations:

To Migrate and unmigrate:
npx sequelize-cli db:migrate

and we can undo ALL migrations with:

npx sequelize-cli db:migrate:undo:all

if we want to undo a specific migration we can use:

npx sequelize-cli db:migrate:undo --name 20180704124934-create-branch.js

Create a new Migration:
 npx sequelize-cli migration:create --name remove_Capital_tableFrom_metainfo

 Step 1: generate a seed file
npx sequelize-cli seed:generate --name seed_country_table

Execute it with: npx sequelize-cli db:seed:all

Like with a migration undo seeds with
npx sequelize-cli db:seed:undo `
Or up untill a specific seed like
npx sequelize-cli db:seed:undo — seed XXXXXX-seed_country_table.js



