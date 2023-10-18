const fs = require('fs');
const { runMigrationFromList, buildMigrationConfigList } = require('./migration');
const GHClient = require('./github');

const { getEnv } = require('./util');
const AWSClient = require('./aws');
const JiraClient = require('./jira');
const path = require('path');

const awsClient = new AWSClient();

function validatePR(prInfo, prBaseBranchName, commentOwner, dryRun) {
  if (prInfo.baseBranch !== prBaseBranchName) {
    return `Base branch should be ${prBaseBranchName}`;
  } else if (prInfo.author === commentOwner && dryRun === false) {
    return `PR author @${prInfo.author} cannot approve their own PR`;
  } else if (!prInfo.isOpen) {
    return `PR is in ${prInfo.state} state`;
  } else if (prInfo.isDraft) {
    return `PR is in draft state`;
  }
}

function buildExecutionMarkdown(htmlURL) {
  return `[execution](${htmlURL}/actions/runs/${process.env.GITHUB_RUN_ID})`;
}

function buildConfig() {
  const config = require(process.env.MIGRATION_CONFIG_FILE || path.join(process.cwd(), './db.migration.json'));
  if (!config.base_directory) {
    config.base_directory = 'migrations';
  }

  if (!config.tokens) {
    config.tokens = tokens;
  }
  if (!config.tokens.github_token) {
    config.tokens.github_token = 'GH_TOKEN';
  }
  if (!config.tokens.jira_token) {
    config.tokens.jira_token = 'JIRA_TOKEN';
  }
  if (!config.tokens.jira_user) {
    config.tokens.jira_user = 'JIRA_USER';
  }

  if (!config.jira) {
    throw new Error('jira config is missing');
  }
  if (!config.jira.issue_type) {
    config.jira.issue_type = 'Story';
  }
  if (!config.jira.ticket_label) {
    config.jira.ticket_label = 'db-migration';
  }

  if (!config.base_directory) {
    config.base_directory = 'migrations';
  }

  config.databases.map((dbConfig) => {
    if (!dbConfig.directory) {
      dbConfig.directory = '.';
    }
    if (!dbConfig.migration_table) {
      dbConfig.migration_table = 'migrations';
    }
  });
  console.log('Config: ', config);

  return config;
}

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const prBaseBranchName = getEnv('PR_BASE_BRANCH');
const config = buildConfig();

async function buildData({
  actionOrigin,
  organization,
  repoOwner,
  repoName,
  prNumber,
  commentBody,
  commentOwner,
  awsSecrets,
}) {
  const result = {
    msgPrefix: 'Migrations',
    dryRun: false,
    ghClient: new GHClient(organization, repoOwner, repoName, getEnv('REPO_TOKEN')),
    awsClient: null, // not required here
    jiraClient: new JiraClient({
      repoOwner,
      repoName,
      apiToken: getEnv(config.tokens.jira_token, awsSecrets),
      apiUser: getEnv(config.tokens.jira_user, awsSecrets),
      jiraDomain: config.jira.domain,
      project: config.jira.project,
      issueType: config.jira.issue_type,
      ticketLabel: config.jira.ticket_label,
      statusIDInitial: config.jira.status_id_initial,
      statusIDCompleted: config.jira.status_id_completed,
      customFieldPRLink: config.jira.custom_field_pr_link,
    }),

    migrationConfigList: [],
    migrationAvailable: false,
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

  const ghClient = result.ghClient;

  commentBody = commentBody.trim();
  if (commentBody == '/migrate approved') {
    result.dryRun = false;
  } else if (commentBody == '/migrate dry-run') {
    result.msgPrefix = '[DryRun]Migrations';
    result.dryRun = true;
  } else {
    result.errMsg.invalidComment = 'ignoring comment';
    result.errorMessage = result.errMsg.invalidComment;
    return result;
  }

  if (result.dryRun === true) {
    result.msgPrefix = '[DryRun]Migrations';
  }

  console.log(`Fetching PR info for ${repoOwner}/${repoName}#${prNumber}`);

  const prInfo = await ghClient.getPRInfo(prNumber);

  const errMsg = validatePR(prInfo, prBaseBranchName, commentOwner, result.dryRun);
  if (errMsg) {
    result.errMsg.invalidPR = errMsg;
    result.errorMessage = result.errMsg.invalidPR;
    return result;
  }

  if (actionOrigin === 'github') {
    console.debug(`Fetching teams for user ${commentOwner}`);
    const matchingTeams = await ghClient.getMatchingTeams(commentOwner, getEnv('APPROVAL_TEAMS'));

    if (matchingTeams.length === 0) {
      result.errMsg.invalidTeam = `User ${commentOwner} is not a member of any of the required teams: ${config.teams}`;
      result.errorMessage = result.errMsg.invalidTeam;
      return result;
    }
  }

  result.migrationConfigList = await buildMigrationConfigList(config, awsSecrets);

  const {
    migrationAvailable,
    migratedFileList,
    errMsg: migrationErrMsg,
  } = await runMigrationFromList(result.migrationConfigList);

  result.migratedFileList = migratedFileList;
  result.migrationAvailable = migrationAvailable;
  if (migrationErrMsg) {
    result.errMsg.invalidDryRun = migrationErrMsg;
    result.errorMessage = migrationErrMsg;
    return result;
  } else if (migrationAvailable === false) {
    result.errMsg.noFilesToRun = 'No migrations available';
    result.errorMessage = result.errMsg.noFilesToRun;
    return result;
  }

  return result;
}

function buildJiraDescription(organization, repoName, prNumber, fileListForComment) {
  return `[PR ${organization}/${repoName}#${prNumber}|https://github.com/${organization}/${repoName}/pull/${prNumber}]
${fileListForComment}
`;
}

function dt() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Calcutta',
  });
}

async function fromJira(event, awsSecrets) {}

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
async function fromGithub(event, awsSecrets) {
  const organization = event.organization.login; // for orgs, this and repoOwner are same
  const repoOwner = event.repository.owner.login;
  const repoName = event.repository.name;
  const prAPIUrl = event.issue.pull_request.url;
  const prNumber = event.issue.number;
  const commentID = event.comment.id;

  awsClient.setOrg(organization, repoName);

  const result = await buildData({
    actionOrigin: 'github',
    organization,
    repoOwner,
    repoName,
    prNumber,
    commentBody: event.comment.body,
    commentOwner: event.comment.user.login,
    awsSecrets,
  });
  result.awsClient = awsClient;

  console.log('Result: ', result);
  const commentBuilder = getUpdatedComment(event.comment.body, result.msgPrefix);

  const ghClient = result.ghClient;
  if (result.errorMessage) {
    if (result.errMsg.invalidComment === null) {
      console.error(result.errorMessage);
      await ghClient.updateComment(commentID, commentBuilder('failed', result.errorMessage));
      throw new Error(result.errorMessage);
    }
    console.debug(result.errorMessage);
    return;
  }

  // migration files are available. Ensure we have a ticket handy
  const { alreadyExists, issue: jiraIssue } = result.jiraClient.ensureJiraTicket(
    prNumber,
    buildJiraDescription(organization, repoName, prNumber, getFileListingForComment(result.migratedFileList)),
    null,
    prAPIUrl
  );

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

  const fileListForComment = getFileListingForComment(migrationFileListByDirectory);
  updatedCommentMsg = `${updatedCommentMsg}\r\n${fileListForComment}`;

  // Update comment and add label
  await Promise.all([
    ghClient.updateComment(commentID, updatedCommentMsg),
    alreadyExists === true
      ? result.jiraClient.addComment(
          jiraIssue.id,
          buildJiraDescription(organization, repoName, prNumber, updatedCommentMsg)
        )
      : Promise.resolve(true),
    result.migrationAvailable === true // && dryRun === false
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

async function main() {
  console.log(event.action);

  console.log(event);

  const secretKeys = config.databases.reduce(
    (acc, db) => {
      acc.push(db.url_path);
      return acc;
    },
    [config.tokens.github_token, config.tokens.jira_token, config.tokens.jira_user]
  );
  const awsSecrets = await awsClient.getSecrets(config.aws_secret_provider.path, secretKeys);
  console.log(awsSecrets);
  return;

  if (event.action !== 'jira_issue_comment_created') {
    await fromGithub(event, awsSecrets);
  } else {
    await fromJira(event, awsSecrets);
  }
}

main().catch(console.error.bind(console));
