const path = require('path');
const fs = require('fs');
const sequelizeErd = require('sequelize-erd');
const db = require('./model');

(async () => {
  const sequelize = db.sequelize;

  const baseOptions = {
    source: sequelize,
    engine: 'dot',
    color: 'dimgray',
    arrowSize: 1.8,
    lineWidth: 1.0,
    arrowShapes: {
      BelongsToMany: ['crow', 'crow'],
      BelongsTo: ['none', 'tee'],
      HasMany: ['tee', 'crow'],
      HasOne: ['tee', 'none'],
    },
  };

  const diagrams = [
    {
      fileName: 'erd.svg',
      options: {},
    },
    {
      fileName: 'erd-core.svg',
      options: {
        include: 'users,projects,sessions,observations,keyframes',
      },
    },
    {
      fileName: 'erd-ml.svg',
      options: {
        include: 'ml_models,species,model_species,datasets,dataset_observations,training_runs,hyperparameters,epochs,metrics_summary,metrics_curves,artifacts',
      },
    },
  ];

  for (const diagram of diagrams) {
    const svg = await sequelizeErd({
      ...baseOptions,
      ...diagram.options,
    });

    const outPath = path.join(process.cwd(), diagram.fileName);
    fs.writeFileSync(outPath, svg);
    console.log(`[generate-erd] ERD written to ${outPath}`);
  }
})();
