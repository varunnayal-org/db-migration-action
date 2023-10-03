const core = require('@actions/core');
const fs = require('fs');
const { runMigrations, buildMigrationConfig } = require('./migration');
const { buildOctokit, isPREvent, getMatchingTeams, getPRInfo, updateComment, addLabel } = require('./github');
const { getEnv } = require('./util');

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

function buildExecutionMarkdown(event) {
  return `[execution](${event.repository.html_url}/actions/runs/${process.env.GITHUB_RUN_ID})`;
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const migrationURL = getEnv('MIGRATION_DB_URL');
  const migrationDir = getEnv('MIGRATION_DIR');
  const approvalTeams = getEnv('APPROVAL_TEAMS');
  const prBaseBranchName = getEnv('PR_BASE_BRANCH');
  const octokit = buildOctokit();

  if (!isPREvent(event)) {
    console.debug('Not a pull request event');
    return;
  }

  const commentBody = event.comment.body.trim();
  let dryRun = true;
  if (commentBody == '/migrate approved') {
    dryRun = false;
  } else if (commentBody == '/migrate dry-run') {
    dryRun = true;
  } else {
    console.debug('ignoring comment');
    return;
  }
  const msgPrefix = `${dryRun ? '[DryRun]' : ''}Migrations`;

  const organization = event.organization.login; // for orgs, this and repoOwner are same
  const repoOwner = event.repository.owner.login;
  const repoName = event.repository.name;
  const prNumber = event.issue.number;
  const commentOwner = event.comment.user.login;
  const commentID = event.comment.id;

  console.debug(`Fetching PR info for ${repoOwner}/${repoName}#${prNumber}`);
  const prInfo = await getPRInfo(octokit, repoOwner, repoName, prNumber);

  const errMsg = validatePR(prInfo, prBaseBranchName, commentOwner, dryRun);
  if (errMsg) {
    console.error(errMsg);
    await updateComment(
      octokit,
      repoOwner,
      repoName,
      commentID,
      `${commentBody}\r\n\r\n**${msgPrefix} failed** (${buildExecutionMarkdown(event)}): ${errMsg}`
    );
    return;
  }

  console.debug(`Fetching teams for user ${commentOwner}`);
  const matchingTeams = await getMatchingTeams(octokit, commentOwner, organization, approvalTeams);

  if (matchingTeams.length === 0) {
    console.error(`User ${commentOwner} is not a member of any of the required teams: ${approvalTeams}`);
    return;
  }

  const migrationConfig = buildMigrationConfig(migrationURL, migrationDir, dryRun);
  const migratedFileList = await runMigrations(migrationConfig);

  let updatedCommentMsg = `${commentBody}\r\n\r\n**${msgPrefix}`;
  if (migratedFileList.length === 0) {
    updatedCommentMsg = `${updatedCommentMsg} Nothing to run** ${new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Calcutta',
    })}`;
  } else {
    updatedCommentMsg = `${updatedCommentMsg} Successful** (${buildExecutionMarkdown(
      event
    )}) at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Calcutta' })}\r\nFiles:\r\n- ${migratedFileList.join(
      '\r\n- '
    )}`;
  }

  // Update comment and add label
  await Promise.all([
    updateComment(octokit, repoOwner, repoName, commentID, updatedCommentMsg),
    migratedFileList.length > 0 // && dryRun === false
      ? addLabel(octokit, repoOwner, repoName, prNumber, 'db-migration')
      : Promise.resolve(true),
  ]);

  await updateComment(octokit, repoOwner, repoName, commentID, updatedCommentMsg);

  // wait for 5 seconds
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

main();
