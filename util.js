const fs = require('fs');

async function cleanDir(dirName) {
  try {
    fs.rmSync(dirName, { recursive: true });
  } catch (ex) {
    if (ex.code !== 'ENOENT') {
      throw ex;
    }
  }
}

async function createTempDir(dirName) {
  fs.mkdirSync(dirName, { recursive: true });
  return dirName;
}

async function removeDir(dirName) {
  console.log('Removing Dir: ', dirName);
  if (dirName) {
    fs.rmSync(dirName, { recursive: true });
  }
}

function getEnv(envName, fromState = process.env) {
  const value = fromState[envName];
  if (typeof value === 'undefined') {
    throw new Error(`Environment variable ${envName} is not set`);
  }
  return value;
}

module.exports = {
  createTempDir,
  removeDir,
  cleanDir,
  getEnv,
};
