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

module.exports = {
  createTempDir,
  removeDir,
};
