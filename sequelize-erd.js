// generate-erd.js (in project root)
const path = require('path');
const fs = require('fs');
const sequelizeErd = require('sequelize-erd');

// 1) Reuse your existing DB bootstrap
const { connect } = require('./config/db.config'); // 👈 now './config/...'

(async () => {
  const db = connect();
  const sequelize = db.sequelize ?? db;

  // 2) Load models and associations
  let models;
  try {
    const initModels = require('./model/init-models'); // 👈 now './model/...'
    models = initModels(sequelize);
  } catch (e) {
    console.warn('[generate-erd] Could not load init-models.js, falling back to manual requires:', e.message);

    const { DataTypes } = require('sequelize');
    const users = require('./model/users')(sequelize, DataTypes);
    const projects = require('./model/projects')(sequelize, DataTypes);
    const sessions = require('./model/sessions')(sequelize, DataTypes);
    const observations = require('./model/observations')(sequelize, DataTypes);
    const keyframes = require('./model/keyframes')(sequelize, DataTypes);

    models = { users, projects, sessions, observations, keyframes };
    Object.values(models).forEach(m => {
      if (typeof m.associate === 'function') {
        m.associate(models);
      }
    });
  }

// 3) Generate the ERD
const svg = await sequelizeErd({
  source: sequelize,
  engine: 'dot',          // tidy top→down layout
  color: 'dimgray',
  arrowSize: 1.8,
  lineWidth: 1.0,
  arrowShapes: {
    BelongsToMany: ['crow', 'crow'],
    BelongsTo:     ['inv',  'crow'],
    HasMany:       ['none', 'crow'],
    HasOne:        ['dot',  'dot'],
  },
  include: 'users,projects,sessions,observations,keyframes', // ← string, not array
});
  const outPath = path.join(process.cwd(), 'erd.svg');
  fs.writeFileSync(outPath, svg);
  console.log(`[generate-erd] ERD written to ${outPath}`);
})();
