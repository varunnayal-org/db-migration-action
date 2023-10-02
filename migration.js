const fs = require('fs');
const migrate = require('node-pg-migrate').default;
const path = require('path');

const { createTempDir, removeDir } = require('./util');

function buildMigrationConfig(databaseURL, migrationsDir) {
  return {
    databaseUrl: databaseURL,
    dir: migrationsDir,
    migrationsTable: process.env.MIGRATIONS_TABLE || 'migrations',
    direction: 'up',
    checkOrder: true,
    dryRun: true,
  };
}

async function copySqlMigrationToJS(sourceDir, destinationDir) {
  // Read files in source directory
  console.debug(`Reading from: ${sourceDir}`);
  const files = fs.readdirSync(sourceDir);

  // Filter only SQL files
  const sqlFiles = files.filter((file) => path.extname(file) === '.sql');

  for (const file of sqlFiles) {
    const filePath = path.join(sourceDir, file);

    // Create JS content
    const baseName = path.basename(file, '.sql');
    const jsFileName = `${baseName}.js`;
    const jsFilePath = path.join(destinationDir, jsFileName);

    const jsContent = `
const path = require('path');
const fs = require('fs');

const sql = fs.readFileSync(path.join(__dirname, '${filePath}'), 'utf8');

module.exports = {
    up: (pgm) => {
        pgm.sql(sql);
    },
};
`;

    // Write the JS content to the file
    fs.writeFileSync(jsFilePath, jsContent);
  }
}

async function runMigrations(migrationConfig) {
  let migrationJsDir;
  try {
    // setup sql -> js for node-pg-migrate
    migrationJsDir = await createTempDir('migrations-js');
    await copySqlMigrationToJS(migrationConfig.dir, migrationJsDir);

    // migrate
    await migrate(migrationConfig);

    console.log('Migrations run successfully');
  } catch (error) {
    console.error('Failed to run migrations:', error);
  } finally {
    removeDir(migrationJsDir);
  }
}

module.exports = { buildMigrationConfig, runMigrations };
