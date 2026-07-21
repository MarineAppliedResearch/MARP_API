// generate-erd.js (in project root)
const path = require('path');
const fs = require('fs');
const sequelizeErd = require('sequelize-erd');
const db = require('./model');

(async () => {
  const sequelize = db.sequelize;

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
