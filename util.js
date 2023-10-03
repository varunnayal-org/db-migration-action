const fs = require('fs');

async function createTempDir(dirName) {
  const tempDir = `${process.env.RUNNER_TEMP}/${dirName}`;
  fs.mkdirSync(tempDir);
  return tempDir;
}

async function removeDir(dirName) {
  if (dirName) {
    fs.rmSync(dirName, { recursive: true });
  }
}

function getEnv(envName) {
  const value = process.env[envName];
  if (typeof value === 'undefined') {
    throw new Error(`Environment variable ${envName} is not set`);
  }
  return value;
}

module.exports = {
  createTempDir,
  removeDir,
  getEnv,
};
