const fs = require('fs');
const migrate = require('node-pg-migrate').default;
const path = require('path');

const { createTempDir, removeDir } = require('./util');

function buildMigrationConfig(databaseURL, migrationsDir, directory, dryRun = false) {
  return {
    databaseUrl: databaseURL,
    dir: migrationsDir,
    migrationsTable: directory,
    direction: 'up',
    checkOrder: true,
    dryRun,
  };
}

async function runMigrationFromList(migrationConfigList) {
  const migrationAvailable = false;
  let errMsg = null;
  let migratedFileList = [];
  for (const idx in migrationConfigList) {
    const migrationConfig = migrationConfigList[idx];
    try {
      const migratedFiles = await runMigrations(migrationConfig);
      if (migratedFiles.length > 0) {
        migratedFileList.push(migratedFiles);
        migrationAvailable = true;
      } else {
        migratedFileList.push([]);
      }
    } catch (ex) {
      migratedFileList.push([]);
      if (errMsg === null) {
        errMsg = `Dir:${migrationConfig.directory} ${ex.message}`;
      } else {
        errMsg = `${errMsg}\r\nDir:${migrationConfig.directory} ${ex.message}`;
      }
    }
  }
  return {
    migrationAvailable,
    migratedFileList,
    errMsg,
  };
}

async function ensureSQLFilesInMigrationDir(sourceDir, destinationDir) {
  // Read files in source directory
  console.debug(`Reading from: ${sourceDir}`);
  const files = fs.readdirSync(sourceDir);

  // Filter only SQL files
  const sqlFiles = files.filter((file) => path.extname(file) === '.sql');

  console.debug('SQL Files: ', sqlFiles);
  // Copy files to destination dir
  for (const file of sqlFiles) {
    const filePath = path.join(sourceDir, file);
    fs.copyFileSync(filePath, path.join(destinationDir, file));
  }
}

async function runMigrations(migrationConfig) {
  let migrationJsDir;
  try {
    console.log('MigrationConfig: ', migrationConfig);
    // setup sql -> js for node-pg-migrate
    migrationJsDir = await createTempDir('migrations-js');
    await ensureSQLFilesInMigrationDir(migrationConfig.dir, migrationJsDir);
    migrationConfig.dir = migrationJsDir;

    // migrate
    // output: [{path:'/path/to/12312.sql', name: '12312', timestamp: 20230921102752}, ...]
    const response = await migrate(migrationConfig);

    return response.map((file) => `${file.name}.sql`);
  } /* catch (error) {
    console.error('Failed to run migrations:', error);
  } */ finally {
    await removeDir(migrationJsDir);
  }
}

module.exports = { buildMigrationConfig, runMigrationFromList, runMigrations };
