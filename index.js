const fs = require('fs');
const { runMigrations, buildMigrationConfig } = require('./migration');
const GHClient = require('./github');

const { getEnv } = require('./util');
const Client = require('./aws');
const path = require('path');

function validatePR(prInfo, prBaseBranchName, commentOwner, dryRun) {
  if (prInfo.baseBranch !== prBaseBranchName) {
    return `Base branch should be **${prBaseBranchName}**`;
  } else if (prInfo.author === commentOwner && dryRun === false) {
    return `PR author @${prInfo.author} cannot approve their own PR`;
  } else if (!prInfo.isOpen) {
    return `PR is in **${prInfo.state}** state`;
  } else if (prInfo.isDraft) {
    return `PR is in **draft** state`;
  }
}

function buildExecutionMarkdown(htmlURL) {
  return `[execution](${htmlURL}/actions/runs/${process.env.GITHUB_RUN_ID})`;
}

function buildConfig() {
  const config = require(getEnv('MIGRATION_CONFIG_FILE'));
  if (!config.base_directory) {
    config.base_directory = 'migrations';
  }
  return config;
}

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const prBaseBranchName = getEnv('PR_BASE_BRANCH');
const config = buildConfig();

async function buildData({ actionOrigin, organization, repoOwner, repoName, prNumber, commentBody, commentOwner }) {
  const result = {
    msgPrefix: 'Migrations',
    dryRun: false,
    invalidComment: false,
    ghClient: null,
    awsClient: null,

    migrationConfigList: [],
    migratedFileList: [],

    errorMessage: null,
    errMsg: {
      invalidComment: null,
      invalidPR: null,
      invalidTeam: null,
      noFilesToRun: null,
      invalidDryRun: null,
    },
  };

  commentBody = commentBody.trim();
  if (commentBody == '/migrate approved') {
    result.dryRun = false;
  } else if (commentBody == '/migrate dry-run') {
    result.dryRun = true;
  } else {
    console.debug('ignoring comment');
    result.errMsg.invalidComment = 'ignoring comment';
    result.errorMessage = result.errMsg.invalidComment;
    return;
  }

  if (result.dryRun === true) {
    result.msgPrefix = '[DryRun]Migrations';
  }

  const ghClient = new GHClient(organization, repoOwner, repoName, getEnv('REPO_TOKEN'));
  result.ghClient = ghClient;

  console.log(`Fetching PR info for ${repoOwner}/${repoName}#${prNumber}`);
  const prInfo = await ghClient.getPRInfo(prNumber);

  const errMsg = validatePR(prInfo, prBaseBranchName, commentOwner, dryRun);
  if (errMsg) {
    result.errMsg.invalidPR = errMsg;
    result.errorMessage = result.errMsg.invalidPR;
    console.error(errMsg);
    return;
  }

  if (actionOrigin === 'github') {
    console.debug(`Fetching teams for user ${commentOwner}`);
    const matchingTeams = await ghClient.getMatchingTeams(commentOwner, getEnv('APPROVAL_TEAMS'));

    if (matchingTeams.length === 0) {
      result.errMsg.invalidTeam = `User ${commentOwner} is not a member of any of the required teams: ${config.teams}`;
      console.error(result.errMsg.invalidTeam);
      result.errorMessage = result.errMsg.invalidTeam;
      return;
    }
  }

  const awsClient = new Client(organization, repoName);
  result.awsClient = awsClient;

  const secretKeys = config.databases.map((db) => db.url_path);
  const secretValues = await awsClient.getSecrets(secretKeys);

  result.migrationConfigList = config.databases.map((db) => {
    const { directory, url_path } = db;
    if (!directory) {
      db.directory = 'migrations';
    }
    return buildMigrationConfig(
      secretValues[url_path],
      directory,
      path.join(config.base_directory, db.directory),
      true
    );
  });

  const {
    migrationAvailable,
    migratedFileList,
    errMsg: migrationErrMsg,
  } = await runMigrationFromList(result.migrationConfigList);

  result.migratedFileList = migratedFileList;
  if (migrationErrMsg) {
    result.errMsg.invalidDryRun = migrationErrMsg;
    console.error(migrationErrMsg);
    result.errorMessage = migrationErrMsg;
    return;
  } else if (migrationAvailable === false) {
    result.errMsg.noFilesToRun = 'No migrations available';
    console.debug(result.errMsg.noFilesToRun);
    result.errorMessage = result.errMsg.noFilesToRun;
    return;
  }

  return result;
}

function dt() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Calcutta',
  });
}

async function fromJira(event) {}

/**
 * - Get PR info
 * - Validate PR
 * - Get matching teams for comment owner
 * - Run migrations, if required
 * - Update comment
 * - Add Label if required
 *
 * @param {*} event
 * @returns
 */
async function fromGithub(event) {
  const organization = event.organization.login; // for orgs, this and repoOwner are same
  const repoOwner = event.repository.owner.login;
  const repoName = event.repository.name;
  const prNumber = event.issue.number;
  const commentID = event.comment.id;

  buildData({
    actionOrigin,
    commentBody: event.comment.body,
    commentOwner: event.comment.user.login,
  });

  const result = await buildData({
    actionOrigin: 'github',
    organization,
    repoOwner,
    repoName,
    prNumber,
    commentBody: event.comment.body,
    commentOwner: event.comment.user.login,
  });
  const commentBuilder = getUpdatedComment(event.comment.body, result.msgPrefix);

  if (result.errorMessage) {
    await ghClient.updateComment(commentID, commentBuilder('failed', result.errorMessage));
    return;
  }

  let updatedCommentMsg = null;
  let migrationFileListByDirectory = result.migratedFileList;

  // Run migrations
  if (result.dryRun === false) {
    const migrationConfigList = result.migrationConfigList.map((migrationConfig) => {
      migrationConfig.dryRun = false;
      return migrationConfig;
    });
    const { errMsg: migrationErrMsg, migratedFileList } = await runMigrationFromList(migrationConfigList);

    if (migrationErrMsg) {
      console.error(migrationErrMsg);
      updatedCommentMsg = commentBuilder('failed', result.errorMessage);
    }

    migrationFileListByDirectory = migratedFileList;
  } else {
    updatedCommentMsg = commentBuilder('successful');
    updatedCommentMsg = `${updatedCommentMsg} successful** ${dt()} (${buildExecutionMarkdown(
      event.repository.html_url
    )})`;
  }

  if (updatedCommentMsg === null) {
    updatedCommentMsg = commentBuilder('successful');
  }

  updatedCommentMsg = `${updatedCommentMsg}\r\n${getFileListingForComment(migrationFileListByDirectory)}`;

  // Update comment and add label
  await Promise.all([
    ghClient.updateComment(commentID, updatedCommentMsg),
    migratedFileList.length > 0 // && dryRun === false
      ? ghClient.addLabel(prNumber, 'db-migration')
      : Promise.resolve(true),
  ]);
}

function getUpdatedComment(commentBody, msgPrefix) {
  return (boldText, msg) => {
    let returnMsg = `${commentBody}\r\n\r\n**${msgPrefix} ${boldText}** ${dt()} (${buildExecutionMarkdown(
      event.repository.html_url
    )})`;
    if (msg) {
      returnMsg = `${returnMsg}: ${msg}`;
    }
    return returnMsg;
  };
}

/**
 * ```text
 *  Directory: '.'
 *    Files:
 *      - a.sql
 *      - b.sql
 *  Directory: 'a'
 *    Files:
 *      - a.sql
 *      - b.sql
 * ```
 *
 * @param {*} migrationFileListByDirectory
 * @returns
 */
function getFileListingForComment(migrationFileListByDirectory) {
  return migrationFileListByDirectory
    .reduce((acc, fileList, idx) => {
      acc.push(`Directory: '${config.databases[idx].directory}'`);
      if (fileList.length === 0) {
        acc.push(`  Files: NA`);
        return acc;
      }
      acc.push(`  Files:`);
      fileList.forEach((file) => {
        acc.push(`    - ${file}`);
      });
      return acc;
    }, [])
    .join('\r\n');
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

async function main() {
  if (event.action !== 'jira_issue_comment_created') {
    await fromGithub(event);
  } else {
    await fromJira(event);
  }
}

main().catch(console.error.bind(console));
